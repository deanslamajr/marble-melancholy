// Source pipeline (§5, §6.5–§6.6): parse/serialize round-trip, one invalid fixture per error code,
// passability and the autopilot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUnstamped, compileLevel } from "../../src/level/compile";
import { CODES } from "../../src/level/diagnostics";
import { parseSource } from "../../src/level/parse";
import { serializeSource } from "../../src/level/serialize";
import { solveSolution } from "../../src/level/solution/solve";
import { LevelLoader, LevelLoadError } from "../../src/levels/loader";
import { extraIds } from "../../src/levels/manifest";
import { listFiles, loadCore, loadSource, SOURCES } from "../helpers";

const coreFiles = listFiles(join(SOURCES, "core"), ".level.yaml").map((f) => `core/${f}`);
const extraFiles = listFiles(join(SOURCES, "extras"), ".level.yaml").map((f) => `extras/${f}`);
const fixtureFiles = listFiles(join(SOURCES, "fixtures"), ".level.yaml").map(
  (f) => `fixtures/${f}`,
);
const invalidDir = join(SOURCES, "fixtures", "invalid");

describe("parse / serialize", () => {
  for (const rel of [...coreFiles, ...extraFiles, ...fixtureFiles]) {
    it(`${rel} round-trips through serializeSource`, () => {
      const { source } = loadSource(rel);
      const again = parseSource(serializeSource(source));
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.source).toEqual(source);
    });
  }
});

describe("invalid sources", () => {
  const files = listFiles(invalidDir, ".level.yaml");

  it("there is one fixture for every source-detectable error code", () => {
    const covered = new Set(files.map((f) => f.slice(0, 4).toUpperCase()));
    const compiledOnly = new Set(["E020", "E024", "E026"]);
    const errorCodes = Object.keys(CODES).filter((c) => c.startsWith("E") && !compiledOnly.has(c));
    for (const c of errorCodes) expect(covered, c).toContain(c);
  });

  for (const f of files) {
    const want = f.slice(0, 4).toUpperCase();
    it(`${f} reports ${want}`, async () => {
      const text = readFileSync(join(invalidDir, f), "utf8");
      const p = parseSource(text);
      let codes: string[];
      if (!p.ok) codes = p.diagnostics.map((d) => d.code);
      else {
        const r = await compileLevel(p.source, { layerLines: p.layerLines, sourceText: text });
        expect(r.ok).toBe(false);
        codes = r.ok ? [] : r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
      }
      expect(codes).toContain(want);
    });
  }
});

describe("autopilot and passability", () => {
  it("each core race's and extra course's waypoint solution reaches the goal", () => {
    expect(extraFiles.length).toBeGreaterThanOrEqual(8);
    for (const rel of [...coreFiles, ...extraFiles]) {
      const { source, text } = loadSource(rel);
      const p = parseSource(text);
      if (!p.ok) throw new Error(rel);
      const b = buildUnstamped(source, p.layerLines);
      expect(b.ok, rel).toBe(true);
      if (!b.ok || !source.solution) continue;
      const r = solveSolution(b.level, source.solution);
      expect(r.ok, rel).toBe(true);
      if (r.ok) {
        expect(r.path.length).toBeGreaterThan(0);
        expect(r.ticks).toBeLessThan(source.timing.timeLimit * 120);
      }
    }
  });

  it("a waypoint off the course reports waypoint-unreached with its index", () => {
    const { source, text } = loadSource("fixtures/fx-flat.level.yaml");
    const p = parseSource(text);
    if (!p.ok) throw new Error("parse");
    const b = buildUnstamped(source, p.layerLines);
    if (!b.ok) throw new Error("build");
    const r = solveSolution(b.level, {
      kind: "waypoints",
      points: [{ at: [source.grid.width + 40, 0] }],
      maxTicks: 1200,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["waypoint-unreached", "timeout"]).toContain(r.reason);
      expect(r.reason === "timeout" || r.waypointIndex === 0).toBe(true);
    }
  });

  it("an empty script ends without reaching the goal", () => {
    const { source, text } = loadSource("fixtures/fx-flat.level.yaml");
    const p = parseSource(text);
    if (!p.ok) throw new Error("parse");
    const b = buildUnstamped(source, p.layerLines);
    if (!b.ok) throw new Error("build");
    const r = solveSolution(b.level, { kind: "script", segments: [{ ticks: 60, dir: [0, 0] }] });
    expect(r.ok).toBe(false);
  });
});

describe("LevelLoader", () => {
  it("loads all six races by id", async () => {
    const course = await LevelLoader.loadCourse();
    expect(course.every((l) => l.course !== null)).toBe(true);
    expect(course.map((l) => l.id)).toEqual([
      "practice",
      "beginner",
      "intermediate",
      "aerial",
      "silly",
      "ultimate",
    ]);
  });

  it("loads every extra course by id, outside the six-race course", async () => {
    const ids = extraIds();
    expect(ids.length).toBeGreaterThanOrEqual(8);
    for (const id of ids) {
      const l = await LevelLoader.load(id);
      expect(l.id).toBe(id);
      expect(l.course).toBeNull();
    }
    expect((await LevelLoader.loadCourse()).map((l) => l.id)).not.toContain(ids[0]);
  });

  it("rejects unknown ids, unstamped and tampered JSON", async () => {
    await expect(LevelLoader.load("no-such-level")).rejects.toBeInstanceOf(LevelLoadError);
    const unstamped = { ...loadCore("beginner"), stamp: null };
    await expect(LevelLoader.load(unstamped)).rejects.toMatchObject({ code: "E020" });
    const tampered = structuredClone(loadCore("beginner"));
    tampered.timing.par -= 1;
    await expect(LevelLoader.load(tampered)).rejects.toMatchObject({ code: "E020" });
    const foreign = { ...loadCore("beginner"), format: "other/1" };
    await expect(LevelLoader.load(foreign)).rejects.toMatchObject({ code: "E021" });
  });
});
