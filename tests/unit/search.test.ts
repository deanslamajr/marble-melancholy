// Search solver (DECISIONS L25): exact state save/restore, guide projection, and a solve that
// needs a 1-wide rail-less rope plus waiting for a ferry.
import { describe, expect, it } from "vitest";
import { compileLevel } from "../../src/level/compile";
import { Guide, searchSolve } from "../../src/level/solution/search";
import { RunCursor } from "../../src/level/solution/replay";
import type { LevelSource, PlayableLevel } from "../../src/level/types";
import { dequantize } from "../../src/sim/quantize";
import { RaceSim } from "../../src/sim/race";
import { captureSim, restoreSim } from "../../src/sim/simState";
import { loadCore, manifest } from "../helpers";

function ropeAndFerry(): LevelSource {
  const rows: string[] = [];
  const W = 9;
  const row = (x0: number, x1: number) => {
    let s = "";
    for (let x = 0; x < W; x++) s += x >= x0 && x <= x1 ? "A" : ".";
    rows.push(s);
  };
  for (let y = 0; y < 4; y++) row(2, 6);
  for (let y = 0; y < 10; y++) row(4, 4);
  for (let y = 0; y < 4; y++) row(3, 5);
  for (let y = 0; y < 5; y++) row(9, 9);
  for (let y = 0; y < 6; y++) row(3, 5);
  return {
    format: "mm-level-source/1",
    id: "search-rope-ferry",
    name: "Rope and ferry",
    theme: "practice",
    music: "m1-first-steps",
    grid: { width: W, height: rows.length },
    layers: { heights: rows.join("\n") + "\n" },
    start: { p1: [4, 1], p2: [3, 1] },
    goal: { at: [4, 26], radius: 0.8 },
    entities: [
      {
        type: "platform",
        at: [3, 18],
        size: [2, 2],
        top: 10,
        path: [
          [3, 18],
          [3, 21],
        ],
        speed: 1.5,
        pause: 1,
        phase: 0,
      },
    ],
    timing: { timeLimit: 60, par: 40 },
  };
}

describe("sim state capture", () => {
  it("restoring a captured state replays to the identical hash", () => {
    for (const id of manifest().course.slice(0, 3)) {
      const level = loadCore(id);
      const sim = new RaceSim(level, { players: 1 });
      const cur = new RunCursor(level.solution.runs);
      const inputs: Array<[number, number]> = [];
      for (let i = 0; i < 1200; i++) inputs.push(cur.next() ?? [0, 0]);
      for (let i = 0; i < 600; i++) sim.step([dequantize(...inputs[i]!)]);
      const saved = captureSim(sim);
      for (let i = 600; i < 1200; i++) sim.step([dequantize(...inputs[i]!)]);
      const a = sim.hash();
      // Wander off with other inputs, then restore and replay the same tail.
      restoreSim(sim, saved);
      for (let i = 0; i < 300; i++) sim.step([dequantize(127, 0)]);
      restoreSim(sim, saved);
      for (let i = 600; i < 1200; i++) sim.step([dequantize(...inputs[i]!)]);
      expect(sim.hash(), id).toBe(a);
    }
  });
});

describe("guide polyline", () => {
  it("projects onto the nearest segment near the hint and reports arc length", () => {
    const g = new Guide([
      [0, 0],
      [4, 0],
      [4, 3],
    ]);
    expect(g.total).toBeCloseTo(7);
    const p = g.project(2, 0.5, 0);
    expect(p.seg).toBe(0);
    expect(p.s).toBeCloseTo(2);
    expect(Math.abs(p.lat)).toBeCloseTo(0.5);
    const q = g.project(4.2, 2, 0);
    expect(q.seg).toBe(1);
    expect(q.s).toBeCloseTo(6);
    expect(g.turnAt(1)).toBeCloseTo(Math.PI / 2, 2);
    const [x, y] = g.at(5, 0);
    expect(x).toBeCloseTo(4);
    expect(y).toBeCloseTo(1);
  });
});

describe("beam search solver", () => {
  it("crosses a rail-less rope and waits for the ferry; the replay stamps with no deaths", async () => {
    const src = ropeAndFerry();
    const draft = await compileLevel(src, { allowUnsolved: true });
    expect(draft.ok && "draft" in draft).toBe(true);
    if (!draft.ok || !("draft" in draft)) return;
    const level: PlayableLevel = draft.draft;
    const guide: Array<[number, number]> = [
      [4.5, 1.5],
      [4.5, 16.5],
      [4.5, 18.5],
      [4.5, 22.5],
      [4.5, 26.5],
    ];
    const r = searchSolve(level, { guide, budget: 400_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = await compileLevel({
      ...src,
      solution: { kind: "replay", runs: r.runs, expectedTicks: r.ticks },
    });
    expect(res.ok && "level" in res).toBe(true);
    if (res.ok && "level" in res) {
      expect(res.level.solution.deaths).toBe(0);
      expect(res.level.solution.ticks).toBe(r.ticks);
    }
  });

  it("is deterministic and respects its tick budget", () => {
    const level = loadCore(manifest().course[0]!);
    const guide: Array<[number, number]> = [
      [level.start.p1[0] + 0.5, level.start.p1[1] + 0.5],
      [level.goal.at[0] + 0.5, level.goal.at[1] + 0.5],
    ];
    const a = searchSolve(level, { guide, budget: 20_000 });
    const b = searchSolve(level, { guide, budget: 20_000 });
    expect(a).toEqual(b);
    if (!a.ok) expect(a.spent).toBeLessThan(20_000 + 12 * 10 * 20);
  });
});
