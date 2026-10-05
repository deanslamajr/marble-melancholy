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
  type SegmentKind,
} from "../../src/level/generate/generate";
import { generateLevel, MAX_ATTEMPTS, timingFor } from "../../src/level/generate/pipeline";
import { verifyStamp } from "../../src/level/stamp";
import { verifyCompiled } from "../../src/level/verify";
import { TICK_HZ } from "../../src/sim/constants";

const SEEDS_PER_DIFFICULTY = 50;
/** Stated budget: average generation time per course (Node, including retries and stamping). */
const AVG_BUDGET_MS = 150;
const WORST_BUDGET_MS = 1500;

describe("generator determinism", () => {
  it("the same seed and difficulty give the same source and the same stamped level", async () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateSource({ seed: 12345, difficulty });
      const b = generateSource({ seed: 12345, difficulty });
      expect(a).toEqual(b);
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
    expect(g.source.id).toBe("gen-hard-99");
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

for (const difficulty of DIFFICULTIES) {
  describe(`${difficulty}: ${SEEDS_PER_DIFFICULTY} seeds`, () => {
    it("every seed yields a valid, solvable, stamped level within limits and budget", async () => {
      const kinds = new Set<SegmentKind>();
      let total = 0;
      let worst = 0;
      for (let seed = 1; seed <= SEEDS_PER_DIFFICULTY; seed++) {
        const t0 = performance.now();
        const r = await generateLevel({ seed: seed * 7919, difficulty });
        const ms = performance.now() - t0;
        total += ms;
        worst = Math.max(worst, ms);
        expect(r.ok, `seed ${seed * 7919}: ${r.ok ? "" : r.failures.join(" | ")}`).toBe(true);
        if (!r.ok) continue;
        expect(r.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
        r.segments.forEach((k) => kinds.add(k));
        const l = r.level;
        expect(await verifyStamp(l)).toEqual({ ok: true });
        const v = await verifyCompiled(l, { replay: true });
        expect(v.diagnostics).toEqual([]);
        // D36 size limits
        expect(l.grid.width).toBeGreaterThanOrEqual(4);
        expect(l.grid.width).toBeLessThanOrEqual(128);
        expect(l.grid.height).toBeLessThanOrEqual(128);
        expect(l.cells.heights.filter((h) => h >= 0).length).toBeLessThanOrEqual(8192);
        expect(l.entities.length).toBeLessThanOrEqual(64);
        expect(l.checkpoints.length).toBeLessThanOrEqual(16);
        expect(l.timing.timeLimit).toBeGreaterThanOrEqual(5);
        expect(l.timing.timeLimit).toBeLessThanOrEqual(99);
        expect(l.timing.par).toBeLessThan(l.timing.timeLimit);
        expect(l.solution.deaths).toBe(0);
        expect(l.solution.ticks).toBeLessThanOrEqual(l.timing.par * TICK_HZ);
      }
      expect(total / SEEDS_PER_DIFFICULTY).toBeLessThan(AVG_BUDGET_MS);
      expect(worst).toBeLessThan(WORST_BUDGET_MS);
      expect(kinds.size).toBeGreaterThanOrEqual(8);
    }, 120_000);
  });
}
