// Generator v3 extreme tiers (T16): Insane and Nightmare seed batches, solved by the beam search,
// stamped with its replay, inside D36 and the CPU budget, in their metric ranges and fair (L25–L30).
import { describe, expect, it } from "vitest";
import type { Difficulty } from "../../src/level/generate/generate";
import { TIERS } from "../../src/level/generate/generate";
import type { CourseMetrics } from "../../src/level/generate/metrics";
import {
  GEN_BUDGET_MS,
  generateLevel,
  MAX_SEARCH_ATTEMPTS,
  timingFor,
  WORST_BUDGET_FACTOR,
} from "../../src/level/generate/pipeline";
import { TICK_HZ } from "../../src/sim/constants";
import { checkCourse, checkFairness, meansAboveFloors, metricsInRange } from "./genChecks";

const SEEDS: Partial<Record<Difficulty, number>> = { insane: 8, nightmare: 6 };

describe("extreme timing", () => {
  it("par adds a steering allowance (a slowed run) and stays well under the limit", () => {
    const fast = timingFor("insane", 30 * TICK_HZ, 0)!;
    const steered = timingFor("insane", 30 * TICK_HZ, 100)!;
    expect(steered.par).toBeGreaterThan(fast.par + 8);
    expect(steered.par).toBeLessThanOrEqual(steered.timeLimit * 0.8);
    const long = timingFor("nightmare", 50 * TICK_HZ, 400)!;
    expect(long.par).toBeLessThanOrEqual(79);
    expect(long.timeLimit).toBe(99);
  });
});

for (const [difficulty, n] of Object.entries(SEEDS) as [Difficulty, number][]) {
  describe(`${difficulty}: ${n} seeds`, () => {
    it("every seed is search-solved, stamped, within limits, budget and metric ranges, and fair", async () => {
      const tier = TIERS[difficulty];
      const all: CourseMetrics[] = [];
      let cpu = 0;
      let worst = 0;
      for (let s = 1; s <= n; s++) {
        const seed = s * 7919;
        const label = `${difficulty} seed ${seed}`;
        const c0 = process.cpuUsage();
        const r = await generateLevel({ seed, difficulty });
        const c = process.cpuUsage(c0);
        const ms = (c.user + c.system) / 1000;
        cpu += ms;
        worst = Math.max(worst, ms);
        expect(r.ok, `${label}: ${r.ok ? "" : r.failures.join(" | ")}`).toBe(true);
        if (!r.ok) continue;
        expect(r.attempts).toBeLessThanOrEqual(MAX_SEARCH_ATTEMPTS);
        await checkCourse(difficulty, r, label);
        metricsInRange(difficulty, r.metrics, label);
        expect(r.metrics.robustness, `${label} robustness`).toBeGreaterThanOrEqual(tier.minRobust);
        expect(r.metrics.minWidth).toBeGreaterThan(0);
        checkFairness(r.level, label, 4 * tier.checkpointEvery + 4);
        all.push(r.metrics);
      }
      meansAboveFloors(difficulty, all);
      expect(cpu / n).toBeLessThan(GEN_BUDGET_MS[difficulty]);
      expect(worst).toBeLessThan(GEN_BUDGET_MS[difficulty] * WORST_BUDGET_FACTOR);
    }, 600_000);
  });
}
