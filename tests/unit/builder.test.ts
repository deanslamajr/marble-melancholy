// Builder model (§6.2): pure edit commands, undo history and import/export round-trips.
import { describe, expect, it } from "vitest";
import {
  addCheckpoint,
  addEntity,
  addWaypoint,
  brushCells,
  cellHeight,
  gridOf,
  moveEntities,
  newDraftSource,
  raiseHeight,
  removeEntities,
  resizeGrid,
  setHeight,
  setSlope,
  setSurface,
  setWall,
  waypointsOf,
} from "../../src/builder/editor/commands";
import { History } from "../../src/builder/editor/history";
import { exportCompiled, exportYaml, importText } from "../../src/builder/editor/io";
import { decompileToSource } from "../../src/level/compile";
import { defaultEntity } from "../../src/level/entities/specs";
import { parseSource } from "../../src/level/parse";
import { SLOPE, SURFACE } from "../../src/level/types";
import { loadCore, loadFixture, manifest } from "../helpers";

describe("edit commands", () => {
  const base = newDraftSource("t", "Test");

  it("the new-level draft is a 16×24 grid with a 4-wide corridor", () => {
    const g = gridOf(base);
    expect([g.w, g.h]).toEqual([16, 24]);
    expect(cellHeight(base, [6, 1])).toBe(10);
    expect(cellHeight(base, [9, 22])).toBe(10);
    expect(cellHeight(base, [5, 1])).toBe(-1);
    expect(cellHeight(base, [7, 0])).toBe(-1);
  });

  it("brushes are clipped squares", () => {
    expect(brushCells([5, 5], 1, 16, 24)).toEqual([[5, 5]]);
    expect(brushCells([5, 5], 3, 16, 24)).toHaveLength(9);
    expect(brushCells([0, 0], 5, 16, 24)).toHaveLength(9);
  });

  it("setHeight is a no-op (same object) when nothing changes", () => {
    expect(setHeight(base, [[7, 5]], 10)).toBe(base);
    const s = setHeight(base, [[7, 5]], 12);
    expect(s).not.toBe(base);
    expect(cellHeight(s, [7, 5])).toBe(12);
    expect(cellHeight(base, [7, 5])).toBe(10);
  });

  it("raise creates void cells at the fill height; lowering below 0 makes void", () => {
    let s = raiseHeight(base, [[0, 0]], 1, 4);
    expect(cellHeight(s, [0, 0])).toBe(4);
    s = setHeight(s, [[0, 0]], 0);
    s = raiseHeight(s, [[0, 0]], -1, 4);
    expect(cellHeight(s, [0, 0])).toBe(-1);
  });

  it("slope, surface and walls apply only to ground cells", () => {
    let s = setSlope(
      base,
      [
        [7, 5],
        [0, 0],
      ],
      SLOPE.S,
    );
    s = setSurface(
      s,
      [
        [7, 6],
        [0, 0],
      ],
      SURFACE.ice,
    );
    s = setWall(s, [7, 7], 4, true);
    expect(setWall(s, [0, 0], 4, true)).toBe(s);
    const g = gridOf(s);
    expect(g.slopes[5 * 16 + 7]).toBe(SLOPE.S);
    expect(g.slopes[0]).toBe(SLOPE.flat);
    expect(g.surfaces[6 * 16 + 7]).toBe(SURFACE.ice);
    expect(g.surfaces[0]).toBe(SURFACE.normal);
    expect(g.walls[7 * 16 + 7]).toBe(4);
    expect(gridOf(setWall(s, [7, 7], 4, false)).walls[7 * 16 + 7]).toBe(0);
  });

  it("entities can be added, moved and removed", () => {
    let s = addEntity(base, defaultEntity("steelie", [7, 10]));
    s = addEntity(s, defaultEntity("hoover", [8, 12]));
    expect(s.entities).toHaveLength(2);
    s = moveEntities(s, [0], 1, 2);
    expect(s.entities?.[0]).toMatchObject({ type: "steelie", at: [8, 12] });
    s = removeEntities(s, [1]);
    expect((s.entities ?? []).map((e) => e.type)).toEqual(["steelie"]);
  });

  it("checkpoints and waypoints append", () => {
    let s = addCheckpoint(base, [7, 10]);
    expect(s.checkpoints).toHaveLength(1);
    s = addWaypoint(s, [7, 12]);
    expect(waypointsOf(s).map((w) => w.at)).toEqual([
      [7, 21],
      [7, 12],
    ]);
  });

  it("resize keeps the top-left and drops the rest", () => {
    const s = resizeGrid(base, 8, 8);
    expect(s.grid).toEqual({ width: 8, height: 8 });
    expect(cellHeight(s, [7, 1])).toBe(10);
    expect(cellHeight(s, [7, 7])).toBe(10);
    const big = resizeGrid(base, 20, 30);
    expect(cellHeight(big, [19, 29])).toBe(-1);
    expect(cellHeight(big, [7, 21])).toBe(10);
  });
});

describe("history", () => {
  it("undo/redo restore snapshots and a new edit clears redo", () => {
    const h = new History();
    const a = newDraftSource("t", "A");
    const b = setHeight(a, [[7, 5]], 12);
    const c = setHeight(b, [[7, 6]], 12);
    h.record(a);
    h.record(b);
    expect(h.undo(c)).toEqual(b);
    expect(h.undo(b)).toEqual(a);
    expect(h.undo(a)).toBeNull();
    expect(h.redo(a)).toEqual(b);
    h.record(b);
    expect(h.redo(b)).toBeNull();
  });

  it("a brush stroke coalesces into one undo step", () => {
    const h = new History();
    const a = newDraftSource("t", "A");
    h.beginStroke(a);
    let s = a;
    for (let y = 3; y < 10; y++) {
      const next = setHeight(s, [[7, y]], 14);
      h.record(s);
      s = next;
    }
    h.endStroke(s);
    expect(h.past).toHaveLength(1);
    expect(h.undo(s)).toEqual(a);
  });

  it("an empty stroke records nothing", () => {
    const h = new History();
    const a = newDraftSource("t", "A");
    h.beginStroke(a);
    h.endStroke(a);
    expect(h.past).toHaveLength(0);
  });
});

describe("import / export", () => {
  it("YAML export re-parses to the same source", () => {
    const src = addEntity(newDraftSource("rt", "Round Trip"), defaultEntity("muncher", [7, 9]));
    const p = parseSource(exportYaml(src));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.source).toEqual(src);
  });

  it("the new-level draft compiles and its JSON imports as a verified level", async () => {
    const r = await exportCompiled(newDraftSource("draft-ok", "Draft OK"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const imp = await importText(r.json, "draft-ok.level.json");
    expect(imp.kind).toBe("compiled");
  });

  it("decompiling a shipped race and recompiling reproduces its cells and replay", async () => {
    for (const id of [manifest().course[0]!, "fx-ramp-gap"]) {
      const level = id.startsWith("fx-") ? loadFixture(id) : loadCore(id);
      const src = decompileToSource(level);
      const r = await exportCompiled(src);
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      expect(r.level.cells).toEqual(level.cells);
      expect(r.level.entities).toEqual(level.entities);
      expect(r.level.solution.stateHash).toBe(level.solution.stateHash);
      expect(r.level.solution.ticks).toBe(level.solution.ticks);
    }
  });

  it("tampered JSON is rejected on import", async () => {
    const level = structuredClone(loadCore(manifest().course[0]!));
    level.timing.timeLimit += 1;
    const imp = await importText(JSON.stringify(level), "x.level.json");
    expect(imp.kind).toBe("error");
    expect(imp.kind === "error" && imp.diagnostics.some((d) => d.code === "E020")).toBe(true);
  });

  it("garbage is reported, not thrown", async () => {
    expect((await importText("{nope", "x.json")).kind).toBe("error");
    expect((await importText("format: wrong\n", "x.yaml")).kind).toBe("error");
  });
});
