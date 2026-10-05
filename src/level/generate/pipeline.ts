// Generated source → the normal validate → solve → compile → stamp pipeline, with bounded retries.
// Uses compileLevel (and serializeSource for the stamp), so it belongs in lazily loaded chunks.
import { TICK_HZ } from "../../sim/constants";
import { compileLevel } from "../compile";
import { serializeSource } from "../serialize";
import type { CompiledLevel, LevelSource } from "../types";
import {
  attemptSeed,
  generateSource,
  type Difficulty,
  type GenerateOptions,
  type SegmentKind,
} from "./generate";

export const MAX_ATTEMPTS = 8;
/** Longest accepted solution; longer layouts are retried so time limits stay well inside 99 s. */
export const MAX_SOLUTION_SECONDS = 55;

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
    }
  | { ok: false; error: string; attempts: number; failures: string[] };

const PAR_SLACK: Record<Difficulty, number> = { easy: 4, medium: 3, hard: 2 };
const LIMIT_FACTOR: Record<Difficulty, number> = { easy: 1.7, medium: 1.5, hard: 1.35 };

/** Par and time limit from the solution time; null when the course is too long for D36. */
export function timingFor(
  difficulty: Difficulty,
  ticks: number,
): { timeLimit: number; par: number; timeBonus: number } | null {
  const sec = ticks / TICK_HZ;
  if (sec > MAX_SOLUTION_SECONDS) return null;
  const par = Math.ceil(sec * 1.2) + PAR_SLACK[difficulty];
  const timeLimit = Math.min(99, Math.max(par + 5, Math.ceil(par * LIMIT_FACTOR[difficulty])));
  if (par >= timeLimit) return null;
  return { timeLimit, par, timeBonus: 5 };
}

/**
 * Generate, solve and stamp a course. Attempt 0 uses the seed itself; failed layouts are retried
 * with derived seeds (`attemptSeed`) up to `maxAttempts`, so a seed always maps to the same level.
 */
export async function generateLevel(opts: GenerateLevelOptions): Promise<GenerateLevelResult> {
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  const failures: string[] = [];
  for (let attempt = 0; attempt < max; attempt++) {
    const gen = generateSource(opts, attemptSeed(opts.seed, attempt));
    const draft = await compileLevel(gen.source, { allowUnsolved: true });
    if (!draft.ok) {
      failures.push(draft.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
      continue;
    }
    const solution = "draft" in draft ? draft.draft.solution : null;
    if (!solution) {
      const d = "draft" in draft ? draft.diagnostics[0] : undefined;
      failures.push(d ? `${d.code} ${d.message}` : "no solution");
      continue;
    }
    if (solution.deaths > 0) {
      failures.push(`solution died ${solution.deaths} time(s)`);
      continue;
    }
    const timing = timingFor(opts.difficulty, solution.ticks);
    if (!timing) {
      failures.push(`solution too long (${(solution.ticks / TICK_HZ).toFixed(1)} s)`);
      continue;
    }
    const source: LevelSource = { ...gen.source, timing };
    const sourceText = serializeSource(source);
    const res = await compileLevel(source, { sourceText });
    if (!res.ok || !("level" in res)) {
      const ds = res.ok ? res.diagnostics : res.diagnostics;
      failures.push(ds.map((d) => `${d.code} ${d.message}`).join("; ") || "compile failed");
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
    };
  }
  return {
    ok: false,
    attempts: max,
    failures,
    error: `could not generate a solvable ${opts.difficulty} course from seed ${opts.seed >>> 0} in ${max} attempts`,
  };
}
