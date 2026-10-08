// Procedural courses (Task: generate on demand): deterministic per seed, always stamped and
// solvable through the normal pipeline, inside the D36 limits and a generation time budget.
import { describe, expect, it } from "vitest";
import { parseSource } from "../../src/level/parse";
import { compileLevel } from "../../src/level/compile";
import {
  attemptSeed,
  DIFFICULTIES,
  generatedId,
  generateSource,
  TIERS,
  type Difficulty,
  type LayoutShape,
  type SegmentKind,
} from "../../src/level/generate/generate";
import type { CourseMetrics } from "../../src/level/generate/metrics";
import {
  GEN_BUDGET_MS,
  generateLevel,
  MAX_ATTEMPTS,
  MAX_SEARCH_ATTEMPTS,
  timingFor,
  WORST_BUDGET_FACTOR,
} from "../../src/level/generate/pipeline";
import { TICK_HZ } from "../../src/sim/constants";
import { checkCourse, meansAboveFloors, metricsInRange } from "./genChecks";

/** Seeds per tier; the search tiers cost far more per seed (Insane and Nightmare: generate-extreme). */
const SEEDS: Partial<Record<Difficulty, number>> = { easy: 50, medium: 50, hard: 10, expert: 10 };

describe("generator determinism", () => {
  it("the same seed and difficulty give the same source and the same stamped level", async () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateSource({ seed: 12345, difficulty });
      const b = generateSource({ seed: 12345, difficulty });
      expect(a).toEqual(b);
    }
    for (const difficulty of ["easy", "hard", "insane"] as const) {
      const la = await generateLevel({ seed: 12345, difficulty });
      const lb = await generateLevel({ seed: 12345, difficulty });
      expect(la.ok && lb.ok).toBe(true);
      if (la.ok && lb.ok) {
        expect(la.sourceText).toBe(lb.sourceText);
        expect(la.level).toEqual(lb.level);
      }
    }
  });

  it("different seeds give different courses", () => {
    const a = generateSource({ seed: 1, difficulty: "medium" }).source.layers.heights;
    const b = generateSource({ seed: 2, difficulty: "medium" }).source.layers.heights;
    expect(a).not.toBe(b);
  });

  it("ids encode difficulty and seed; a theme option is honoured", () => {
    const g = generateSource({ seed: 99, difficulty: "hard", theme: "skyways" });
    expect(g.source.id).toBe(generatedId("hard", 99));
    expect(g.source.id).toBe("gen-v3-hard-99");
    expect(g.source.theme).toBe("skyways");
    expect(g.source.music).toBe("m4-skyways");
    expect(attemptSeed(99, 0)).toBe(99);
    expect(attemptSeed(99, 1)).not.toBe(99);
  });

  it("the written YAML recompiles to the identical stamped level", async () => {
    const r = await generateLevel({ seed: 4242, difficulty: "medium" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = parseSource(r.sourceText);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const again = await compileLevel(p.source, {
      sourceText: r.sourceText,
      layerLines: p.layerLines,
    });
    expect(again.ok && "level" in again && again.level).toEqual(r.level);
  });
});

describe("timing", () => {
  it("par and limit come from the solution time and stay inside D36", () => {
    const t = timingFor("medium", 20 * TICK_HZ)!;
    expect(t.par).toBeGreaterThanOrEqual(20);
    expect(t.timeLimit).toBeGreaterThan(t.par);
    expect(t.timeLimit).toBeLessThanOrEqual(99);
    expect(timingFor("easy", 90 * TICK_HZ)).toBeNull();
  });
});

describe("retries", () => {
  it("gives a clear error when every attempt fails", async () => {
    const r = await generateLevel({ seed: 5, difficulty: "easy", maxAttempts: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not generate a solvable easy course from seed 5/);
  });
});

/**
 * Expected rates over the 50 seeds (T15). `forked` is the share of courses with at least one
 * fork or shortcut; `switchback` the share with two or more turns; `risky` the share whose
 * embedded solution takes every risky line; `kinds` the mean distinct segment kinds per course.
 */
const RATES: Partial<
  Record<
    Difficulty,
    {
      forked: number;
      forks: number;
      switchback: number;
      turns: number;
      risky: number;
      kinds: number;
    }
  >
> = {
  easy: { forked: 0.15, forks: 0.15, switchback: 0.8, turns: 2.5, risky: 0.15, kinds: 5 },
  medium: { forked: 0.65, forks: 0.65, switchback: 0.9, turns: 3, risky: 0.65, kinds: 6.5 },
  hard: { forked: 0.95, forks: 1.2, switchback: 0.95, turns: 4, risky: 0.9, kinds: 8 },
  expert: { forked: 0.95, forks: 1.4, switchback: 0.95, turns: 4.5, risky: 0.6, kinds: 9 },
};

for (const [difficulty, n] of Object.entries(SEEDS) as [Difficulty, number][]) {
  describe(`${difficulty}: ${n} seeds`, () => {
    it("every seed yields a valid, solvable, stamped level within limits, budget and metric ranges", async () => {
      const kinds = new Set<SegmentKind>();
      const shapes = new Map<LayoutShape, number>();
      const search = TIERS[difficulty].solver === "search";
      const all: CourseMetrics[] = [];
      let cpu = 0;
      let worst = 0;
      let forked = 0;
      let forks = 0;
      let switchbacks = 0;
      let turns = 0;
      let risky = 0;
      let distinct = 0;
      for (let s = 1; s <= n; s++) {
        const seed = s * 7919;
        const c0 = process.cpuUsage();
        const r = await generateLevel({ seed, difficulty });
        const c = process.cpuUsage(c0);
        const ms = (c.user + c.system) / 1000;
        cpu += ms;
        worst = Math.max(worst, ms);
        expect(r.ok, `seed ${seed}: ${r.ok ? "" : r.failures.join(" | ")}`).toBe(true);
        if (!r.ok) continue;
        expect(r.attempts).toBeLessThanOrEqual(search ? MAX_SEARCH_ATTEMPTS : MAX_ATTEMPTS);
        r.segments.forEach((k) => kinds.add(k));
        await checkCourse(difficulty, r, `${difficulty} seed ${seed}`);
        metricsInRange(difficulty, r.metrics, `${difficulty} seed ${seed}`);
        all.push(r.metrics);

        const s2 = r.stats;
        shapes.set(s2.shape, (shapes.get(s2.shape) ?? 0) + 1);
        if (s2.forks > 0) forked++;
        forks += s2.forks;
        if (s2.turns >= 2) switchbacks++;
        turns += s2.turns;
        if (r.line === "risky") risky++;
        distinct += s2.distinctKinds;
      }
      meansAboveFloors(difficulty, all);
      expect(cpu / n).toBeLessThan(GEN_BUDGET_MS[difficulty]);
      expect(worst).toBeLessThan(GEN_BUDGET_MS[difficulty] * WORST_BUDGET_FACTOR);

      // Variety metric: kinds across seeds, distinct kinds per course, turns, layout-shape
      // histogram (no single shape dominates and none is the old straight strip).
      const want = RATES[difficulty]!;
      expect(kinds.size).toBeGreaterThanOrEqual(14);
      expect(distinct / n).toBeGreaterThanOrEqual(want.kinds);
      expect(forked / n).toBeGreaterThanOrEqual(want.forked);
      expect(forks / n).toBeGreaterThanOrEqual(want.forks);
      expect(switchbacks / n).toBeGreaterThanOrEqual(want.switchback);
      expect(turns / n).toBeGreaterThanOrEqual(want.turns);
      expect(risky / n).toBeGreaterThanOrEqual(want.risky);
      expect(shapes.get("straight") ?? 0).toBe(0);
      expect(shapes.size).toBeGreaterThanOrEqual(search ? 2 : 3);
      expect(Math.max(...shapes.values()) / n).toBeLessThanOrEqual(search ? 0.8 : 0.6);
    }, 600_000);
  });
}
