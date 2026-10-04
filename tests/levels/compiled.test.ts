// Every committed level verifies; tampering is caught with the right code (§5.4–§5.6, §6.6).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyCompiled } from "../../src/level/verify";
import { computeStamp } from "../../src/level/stamp";
import { BUILDER_NAME, BUILDER_VERSION } from "../../src/level/version";
import { TICK_HZ } from "../../src/sim/constants";
import type { CompiledLevel } from "../../src/level/types";
import { COMPILED, loadCore, loadFixture, manifest, readJson } from "../helpers";

const all = (): Array<[string, CompiledLevel]> => [
  ...manifest().course.map((id) => [id, loadCore(id)] as [string, CompiledLevel]),
  ...manifest().fixtures.map((id) => [id, loadFixture(id)] as [string, CompiledLevel]),
];

async function codes(json: unknown, replay = true): Promise<string[]> {
  const r = await verifyCompiled(json, { replay });
  return r.diagnostics.map((d) => d.code);
}

/** Re-stamp a modified level so only the change under test can fail. */
async function restamp(level: CompiledLevel): Promise<CompiledLevel> {
  const { stamp: _s, ...rest } = level;
  return { ...rest, stamp: await computeStamp(rest, "tampered") } as CompiledLevel;
}

describe("committed compiled levels", () => {
  it("the manifest lists the six races in slot order and every fixture", () => {
    const m = manifest();
    expect(m.format).toBe("mm-manifest/1");
    expect(m.course).toEqual([
      "practice",
      "beginner",
      "intermediate",
      "aerial",
      "silly",
      "ultimate",
    ]);
    expect(m.fixtures.length).toBeGreaterThanOrEqual(15);
    expect(m.course.map((id) => loadCore(id).course?.slot)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  for (const [id, level] of all()) {
    it(`${id} verifies with its embedded replay`, async () => {
      const r = await verifyCompiled(level, { replay: true });
      expect(r.diagnostics).toEqual([]);
      expect(r.ok).toBe(true);
      expect(level.stamp.builder).toBe(BUILDER_NAME);
      expect(level.stamp.version).toBe(BUILDER_VERSION);
      expect(level.solution.ticks).toBeLessThan(level.timing.timeLimit * TICK_HZ);
      expect(level.solution.ticks / TICK_HZ).toBeLessThanOrEqual(level.timing.timeLimit);
    });
  }
});

describe("tamper detection", () => {
  const base = () => structuredClone(loadCore("practice"));

  it("E021 for a wrong or missing format", async () => {
    expect(await codes({ ...base(), format: "mm-level/9" })).toEqual(["E021"]);
    expect(await codes({})).toEqual(["E021"]);
    expect(await codes(null)).toEqual(["E021"]);
  });

  it("E020 for a missing stamp", async () => {
    const l = base() as Partial<CompiledLevel>;
    delete l.stamp;
    expect(await codes(l)).toEqual(["E020"]);
  });

  it("E020 when any content changes after stamping", async () => {
    const edits: Array<(l: CompiledLevel) => void> = [
      (l) => (l.timing.timeLimit += 1),
      (l) => (l.cells.heights[0] = 5),
      (l) => (l.name = "Hacked"),
      (l) =>
        (l.solution.stateHash = l.solution.stateHash.replace(/./, (c) => (c === "0" ? "1" : "0"))),
    ];
    for (const edit of edits) {
      const l = base();
      edit(l);
      expect(await codes(l, false)).toEqual(["E020"]);
    }
  });

  it("E020 for a foreign builder name or unsupported version", async () => {
    const a = base();
    (a.stamp as { builder: string }).builder = "someone-else";
    expect(await codes(a, false)).toEqual(["E020"]);
    const b = base();
    b.stamp.version = "0.0.1";
    expect(await codes(b, false)).toEqual(["E020"]);
  });

  it("E026 for schema violations", async () => {
    const a = base() as unknown as Record<string, unknown>;
    a.grid = { width: "wide", height: 3 };
    expect(await codes(a)).toContain("E026");
    const b = await restamp({ ...base(), cells: { ...base().cells, heights: [1, 2, 3] } });
    expect(await codes(b)).toEqual(["E026"]);
    const c = await restamp({ ...base(), solution: { ...base().solution, runs: [1, 2] } });
    expect(await codes(c)).toEqual(["E026"]);
  });

  it("E024 when a correctly stamped replay no longer matches its hash", async () => {
    const l = base();
    l.solution.stateHash = l.solution.stateHash.replace(/./, (c) => (c === "0" ? "1" : "0"));
    expect(await codes(await restamp(l))).toEqual(["E024"]);
  });

  it("E019 when a correctly stamped replay no longer reaches the goal", async () => {
    const l = base();
    l.solution.runs = [60, 0, 0];
    expect(await codes(await restamp(l))).toEqual(["E019"]);
  });
});

describe("§5.6 worked example: fx-ramp-gap", () => {
  const l = readJson<CompiledLevel>(join(COMPILED, "fixtures", "fx-ramp-gap.level.json"));
  const W = 8;
  const at = (arr: readonly number[], x: number, y: number) => arr[y * W + x];

  it("cells", () => {
    expect(l.cells.heights).toHaveLength(112);
    // §5.6 says "36 non-void cells"; the grid it lists has 8×6 + 3×6 = 66.
    expect(l.cells.heights.filter((h) => h >= 0)).toHaveLength(66);
    expect(l.cells.slopes.filter((s) => s === 3)).toHaveLength(24);
    expect(l.cells.surfaces.every((s) => s === 0)).toBe(true);
    expect(at(l.cells.walls, 1, 1)).toBe(9);
    expect(at(l.cells.walls, 2, 1)).toBe(1);
    expect(at(l.cells.walls, 6, 1)).toBe(3);
    expect(at(l.cells.walls, 1, 5)).toBe(8);
    expect(at(l.cells.walls, 6, 5)).toBe(2);
    expect(at(l.cells.walls, 1, 12)).toBe(12);
    expect(at(l.cells.walls, 3, 12)).toBe(4);
    expect(at(l.cells.walls, 6, 12)).toBe(6);
    expect(at(l.cells.heights, 0, 0)).toBe(-1);
    expect(at(l.cells.heights, 3, 9)).toBe(-1);
  });

  it("progress: goal 0, start 1000, void −1", () => {
    expect(at(l.cells.progress, 3, 11)).toBe(0);
    expect(at(l.cells.progress, 3, 2)).toBe(1000);
    expect(at(l.cells.progress, 3, 9)).toBe(-1);
    expect(at(l.cells.progress, 0, 0)).toBe(-1);
  });

  it("level fields and solution", () => {
    expect(l.goal.radius).toBe(0.8);
    expect(l.checkpoints).toEqual([]);
    expect(l.entities).toEqual([]);
    expect(l.timing).toEqual({ timeLimit: 15, par: 6, timeBonus: 5 });
    expect(l.solution.deaths).toBe(0);
    // §5.6 estimates ≈300–450 ticks; the binding rule is reaching the goal before tick 1800.
    expect(l.solution.ticks).toBeGreaterThan(TICK_HZ);
    expect(l.solution.ticks).toBeLessThan(1800);
  });
});
