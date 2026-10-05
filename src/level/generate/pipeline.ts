// Generated source → the normal validate → solve → compile → stamp pipeline, with bounded retries.
// Uses compileLevel (and serializeSource for the stamp), so it belongs in lazily loaded chunks.
import { TICK_HZ } from "../../sim/constants";
import { compileLevel } from "../compile";
import { serializeSource } from "../serialize";
import type { CompiledLevel, LevelSource } from "../types";
import {
  attemptSeed,
  GENERATOR_VERSION,
  generateSource,
  type CourseStats,
  type Difficulty,
  type GenerateOptions,
  type SegmentKind,
} from "./generate";

export const MAX_ATTEMPTS = 8;
/** Longest accepted solution; longer layouts are retried so time limits stay inside 99 s. */
export const MAX_SOLUTION_SECONDS = 65;

export interface GenerateLevelOptions extends GenerateOptions {
  maxAttempts?: number;
}

export type GenerateLevelResult =
  | {
      ok: true;
      level: CompiledLevel;
      source: LevelSource;
      sourceText: string;
      attempts: number;
      layoutSeed: number;
      segments: SegmentKind[];
      stats: CourseStats;
      /** Which route the embedded solution took: every risky line, or every safe one. */
      line: "risky" | "safe";
      version: number;
    }
  | { ok: false; error: string; attempts: number; failures: string[] };

/** par = ceil(solution × factor + slack); limit = max(par + 5, ceil(par × limit)) capped at 99 (L20). */
const PAR: Record<Difficulty, { factor: number; slack: number; limit: number }> = {
  easy: { factor: 1.2, slack: 3, limit: 1.6 },
  medium: { factor: 1.12, slack: 2, limit: 1.45 },
  hard: { factor: 1.08, slack: 1, limit: 1.32 },
  expert: { factor: 1.04, slack: 0.5, limit: 1.25 },
};

/** Par and time limit from the solution time; null when the course is too long for D36 or W103. */
export function timingFor(
  difficulty: Difficulty,
  ticks: number,
): { timeLimit: number; par: number; timeBonus: number } | null {
  const sec = ticks / TICK_HZ;
  if (sec > MAX_SOLUTION_SECONDS) return null;
  const t = PAR[difficulty];
  const par = Math.ceil(sec * t.factor + t.slack);
  const timeLimit = Math.min(99, Math.max(par + 5, Math.ceil(par * t.limit)));
  if (par >= timeLimit || par > timeLimit * 0.8) return null;
  return { timeLimit, par, timeBonus: 5 };
}

/**
 * Generate, solve and stamp a course. Attempt 0 uses the seed itself; failed layouts are retried
 * with derived seeds (`attemptSeed`) up to `maxAttempts`, so a seed always maps to the same level.
 * Each layout is solved along its risky route first and falls back to the safe one (L18).
 */
export async function generateLevel(opts: GenerateLevelOptions): Promise<GenerateLevelResult> {
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  const failures: string[] = [];
  for (let attempt = 0; attempt < max; attempt++) {
    const gen = generateSource(opts, attemptSeed(opts.seed, attempt));
    if (gen.problem) {
      failures.push(gen.problem);
      continue;
    }
    for (let r = 0; r < gen.routes.length; r++) {
      const line = r === 0 && gen.routes.length > 1 ? "risky" : "safe";
      const label = gen.routes.length > 1 ? `${line} line: ` : "";
      const draftSource: LevelSource = {
        ...gen.source,
        solution: { kind: "waypoints", points: gen.routes[r]! },
      };
      const draft = await compileLevel(draftSource, { allowUnsolved: true });
      if (!draft.ok) {
        failures.push(label + draft.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
        break;
      }
      const solution = "draft" in draft ? draft.draft.solution : null;
      if (!solution) {
        const d = "draft" in draft ? draft.diagnostics[0] : undefined;
        failures.push(label + (d ? `${d.code} ${d.message}` : "no solution"));
        continue;
      }
      if (solution.deaths > 0) {
        failures.push(`${label}solution died ${solution.deaths} time(s)`);
        continue;
      }
      const timing = timingFor(opts.difficulty, solution.ticks);
      if (!timing) {
        failures.push(`${label}solution too long (${(solution.ticks / TICK_HZ).toFixed(1)} s)`);
        continue;
      }
      const source: LevelSource = { ...draftSource, timing };
      const sourceText = serializeSource(source);
      const res = await compileLevel(source, { sourceText });
      if (!res.ok || !("level" in res)) {
        const ds = res.ok ? res.diagnostics : res.diagnostics;
        failures.push(
          label + (ds.map((d) => `${d.code} ${d.message}`).join("; ") || "compile failed"),
        );
        continue;
      }
      return {
        ok: true,
        level: res.level,
        source,
        sourceText,
        attempts: attempt + 1,
        layoutSeed: gen.layoutSeed,
        segments: gen.segments,
        stats: gen.stats,
        line: line === "risky" ? "risky" : "safe",
        version: GENERATOR_VERSION,
      };
    }
  }
  return {
    ok: false,
    attempts: max,
    failures,
    error: `could not generate a solvable ${opts.difficulty} course from seed ${opts.seed >>> 0} in ${max} attempts`,
  };
}
