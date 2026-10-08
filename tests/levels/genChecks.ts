// Shared per-course checks for the generator batches (T16): stamp, replay, D36 limits, grammar,
// set-piece cap, fairness, and the per-tier metric ranges (L29).
import { expect } from "vitest";
import type { Difficulty } from "../../src/level/generate/generate";
import { GENERATOR_VERSION, TIERS } from "../../src/level/generate/generate";
import type { CourseMetrics } from "../../src/level/generate/metrics";
import type { GenerateLevelResult } from "../../src/level/generate/pipeline";
import { KIND_INFO, SET_PIECES } from "../../src/level/generate/tiers";
import { verifyStamp } from "../../src/level/stamp";
import type { CompiledLevel } from "../../src/level/types";
import { verifyCompiled } from "../../src/level/verify";
import { TICK_HZ } from "../../src/sim/constants";
import { quantizeInt } from "../../src/sim/quantize";
import { runInputs, runReplay } from "../../src/sim/replayRunner";

type Ok = Extract<GenerateLevelResult, { ok: true }>;
type Range = [min: number, max: number];

/**
 * Per-tier metric ranges each course must fall in (L29), measured over the test seeds with a
 * margin. Fragility saturates near 100 % from Expert up, so the steering and geometry metrics
 * separate the top tiers.
 */
export const METRIC_RANGES: Record<
  Difficulty,
  Partial<Record<"fragility" | "dirChanges" | "offAxis" | "minWidth" | "railless", Range>>
> = {
  easy: { fragility: [0, 40], dirChanges: [0, 2], minWidth: [1, 9] },
  medium: { fragility: [0, 60], dirChanges: [0, 2.2], minWidth: [0.5, 9] },
  hard: { fragility: [0, 100], dirChanges: [2, 6], offAxis: [25, 80], minWidth: [0, 2] },
  expert: { fragility: [10, 100], dirChanges: [2, 6], offAxis: [25, 80], minWidth: [0, 1.5] },
  insane: {
    fragility: [70, 100],
    dirChanges: [2.4, 6],
    offAxis: [25, 80],
    minWidth: [0, 1.2],
    railless: [35, 100],
  },
  nightmare: {
    fragility: [80, 100],
    dirChanges: [2.2, 6],
    offAxis: [20, 80],
    minWidth: [0, 1.2],
    railless: [50, 100],
  },
};

/** Batch means each tier must reach, so the tiers stay ordered (L29). */
export const MEAN_FLOORS: Record<Difficulty, Partial<Record<keyof CourseMetrics, number>>> = {
  easy: {},
  medium: {},
  hard: { dirChanges: 2.5, fragility: 15 },
  expert: { dirChanges: 2.6, fragility: 50, railless: 25 },
  insane: { dirChanges: 2.8, fragility: 85, railless: 40, overVoid: 2, airborne: 4 },
  nightmare: { dirChanges: 2.8, fragility: 90, railless: 60, airborne: 6 },
};

export function metricsInRange(d: Difficulty, m: CourseMetrics, label: string): void {
  for (const [k, [lo, hi]] of Object.entries(METRIC_RANGES[d]) as [keyof CourseMetrics, Range][]) {
    expect(m[k], `${label} ${k}`).toBeGreaterThanOrEqual(lo);
    expect(m[k], `${label} ${k}`).toBeLessThanOrEqual(hi);
  }
}

export function meansAboveFloors(d: Difficulty, all: CourseMetrics[]): void {
  for (const [k, floor] of Object.entries(MEAN_FLOORS[d]) as [keyof CourseMetrics, number][]) {
    const mean = all.reduce((a, m) => a + m[k], 0) / all.length;
    expect(mean, `${d} mean ${k}`).toBeGreaterThanOrEqual(floor);
  }
}

/** Stamp, replay, D36 limits, timing, grammar (L19) and the set-piece cap (L30). */
export async function checkCourse(d: Difficulty, r: Ok, label: string): Promise<void> {
  const tier = TIERS[d];
  const l = r.level;
  expect(await verifyStamp(l)).toEqual({ ok: true });
  const v = await verifyCompiled(l, { replay: true });
  expect(v.diagnostics).toEqual([]);
  expect(l.grid.width).toBeGreaterThanOrEqual(4);
  expect(l.grid.width).toBeLessThanOrEqual(128);
  expect(l.grid.height).toBeGreaterThanOrEqual(4);
  expect(l.grid.height).toBeLessThanOrEqual(128);
  expect(l.cells.heights.filter((h) => h >= 0).length).toBeLessThanOrEqual(8192);
  expect(l.entities.length).toBeLessThanOrEqual(64);
  expect(l.checkpoints.length).toBeLessThanOrEqual(16);
  expect(l.timing.timeLimit).toBeGreaterThanOrEqual(5);
  expect(l.timing.timeLimit).toBeLessThanOrEqual(99);
  expect(l.timing.par).toBeLessThan(l.timing.timeLimit);
  expect(l.solution.deaths).toBe(0);
  expect(l.solution.ticks).toBeLessThanOrEqual(l.timing.par * TICK_HZ);
  expect(r.version).toBe(GENERATOR_VERSION);
  expect(r.solver).toBe(tier.solver === "search" ? "search" : "autopilot");

  const segs = r.segments;
  let chain = 0;
  const uses = new Map<string, number>();
  for (let i = 0; i < segs.length; i++) {
    const info = KIND_INFO[segs[i]!];
    if (i > 0) {
      expect(segs[i], `${label} repeats ${segs[i]}`).not.toBe(segs[i - 1]);
      const prev = KIND_INFO[segs[i - 1]!];
      if (prev.airborne && segs[i - 1] !== "fork") expect(info.hazard).toBe(false);
    }
    chain = info.precision ? chain + 1 : 0;
    expect(chain, `${label} precision chain`).toBeLessThanOrEqual(tier.maxChain);
    if (SET_PIECES.has(segs[i]!)) uses.set(segs[i]!, (uses.get(segs[i]!) ?? 0) + 1);
  }
  const setCap = tier.segments[1] >= 13 ? 2 : 1;
  for (const [k, n] of uses) expect(n, `${label} set-piece ${k}`).toBeLessThanOrEqual(setCap);
  expect(r.stats.hazards).toBeLessThanOrEqual(tier.maxHazards);
  expect(r.stats.distinctKinds).toBe(new Set(segs).size);
}

const HAZARDS = new Set(["hammer", "steelie", "muncher", "hoover"]);
/** Cells of view the camera shows ahead of the marble, conservatively. */
const VIEW = 9;

/**
 * Human fairness (L28): holding any one stick direction never finishes; every hazard is on screen
 * at least 1 s before the marble first comes within 2 cells of it; no checkpoint respawns the
 * marble within 2 cells of a hazard; checkpoints come at least every `gap` seconds of solution.
 */
export function checkFairness(l: CompiledLevel, label: string, gap: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const q = quantizeInt(
      Math.round(Math.cos(a) * 1000) / 1000,
      Math.round(Math.sin(a) * 1000) / 1000,
    );
    const res = runInputs(l, () => q, { maxTicks: l.timing.timeLimit * TICK_HZ });
    expect(res.reached, `${label} holding direction ${i * 45}° finishes`).toBe(false);
  }

  const hz = l.entities.flatMap((e) =>
    HAZARDS.has(e.type) && "at" in e ? [e.at as readonly number[]] : [],
  );
  for (const c of l.checkpoints) {
    for (const h of hz) {
      const d = Math.hypot(c.at[0] - h[0]!, c.at[1] - h[1]!);
      expect(d, `${label} checkpoint at ${c.at} next to a hazard`).toBeGreaterThan(2);
    }
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const cps: number[] = [];
  runReplay(l, l.solution.runs, {
    onTick: (info) => {
      const m = info.sim.players[0]!.marble;
      xs.push(m.x);
      ys.push(m.y);
      for (const e of info.events) if (e.t === "checkpoint") cps.push(info.tick);
    },
  });
  for (const h of hz) {
    const hx = h[0]! + 0.5;
    const hy = h[1]! + 0.5;
    const near = xs.findIndex((x, k) => Math.hypot(x - hx, ys[k]! - hy) <= 2);
    if (near <= 0) continue;
    const k = Math.max(0, near - TICK_HZ);
    const seen = Math.hypot(xs[k]! - hx, ys[k]! - hy);
    expect(seen, `${label} hazard at ${h} not visible 1 s ahead`).toBeLessThanOrEqual(VIEW);
  }
  const marks = [0, ...cps, xs.length];
  for (let i = 1; i < marks.length; i++) {
    const s = (marks[i]! - marks[i - 1]!) / TICK_HZ;
    expect(s, `${label} ${s.toFixed(1)} s without a checkpoint`).toBeLessThanOrEqual(gap);
  }
}
