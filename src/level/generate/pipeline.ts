// Generated source → the normal validate → solve → compile → stamp pipeline, with bounded retries.
// Uses compileLevel (and serializeSource for the stamp), so it belongs in lazily loaded chunks.
// Hard and above solve with the beam search (L25) and embed its replay; every tier is measured
// (L27) and Hard and above must pass the fairness floor (L28) and their tier's fragility floor.
import { TICK_HZ } from "../../sim/constants";
import { compileLevel } from "../compile";
import { serializeSource } from "../serialize";
import { Guide, searchSteps, type SearchResult } from "../solution/search";
import type { CompiledLevel, LevelSource, PlayableLevel, SolutionSource } from "../types";
import {
  attemptSeed,
  GENERATOR_VERSION,
  generateSource,
  type CourseStats,
  type Difficulty,
  type GenerateOptions,
  type SegmentKind,
} from "./generate";
import type { GuidePoint } from "./layout";
import { measureCourse, type CourseMetrics } from "./metrics";
import { TIERS } from "./tiers";

export const MAX_ATTEMPTS = 8;
/** Search tiers retry fewer layouts: each failed search spends its whole tick budget. */
export const MAX_SEARCH_ATTEMPTS = 5;
/** Longest accepted solution; longer layouts are retried so time limits stay inside 99 s. */
export const MAX_SOLUTION_SECONDS = 65;

/**
 * Stated generation budget per course, average CPU time over seeds, in milliseconds (Node;
 * includes retries, solving, metrics and stamping). The same numbers apply on every machine, so
 * they leave room for hosted CI runners, which need about 1.7× the development Mac's CPU time
 * (T18). A single seed may take up to WORST_BUDGET_FACTOR× its tier budget when several layouts
 * exhaust their search budget before one solves (L25).
 */
export const GEN_BUDGET_MS: Record<Difficulty, number> = {
  easy: 500,
  medium: 600,
  hard: 5000,
  expert: 5000,
  insane: 12000,
  nightmare: 12000,
};
export const WORST_BUDGET_FACTOR = 4;

export type GeneratePhase = "layout" | "solve" | "measure" | "stamp";

export interface GenerateProgress {
  attempt: number;
  phase: GeneratePhase;
  /** 0..1 within the current phase (the solver's progress along the course). */
  progress: number;
}

export interface GenerateLevelOptions extends GenerateOptions {
  maxAttempts?: number;
  /** Called between solver slices and phases; a UI can await a repaint here. */
  onProgress?: (p: GenerateProgress) => void | Promise<void>;
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
      metrics: CourseMetrics;
      /** Which route the embedded solution took: every risky line, or every safe one. */
      line: "risky" | "safe";
      /** How the embedded solution was found. */
      solver: "search" | "autopilot";
      version: number;
      /** Why earlier attempts or routes were rejected. */
      failures: string[];
    }
  | { ok: false; error: string; attempts: number; failures: string[] };

/**
 * par = ceil((solution + steer × steering changes) × factor + slack);
 * limit = max(par + 5, ceil(par × limit)) capped at 99 (L20, L29).
 */
export function timingFor(
  difficulty: Difficulty,
  ticks: number,
  steers = 0,
): { timeLimit: number; par: number; timeBonus: number } | null {
  const sec = ticks / TICK_HZ;
  if (sec > MAX_SOLUTION_SECONDS) return null;
  const t = TIERS[difficulty].par;
  let par = Math.ceil((sec + (t.steer ?? 0) * steers) * t.factor + t.slack);
  // The steering allowance never pushes par past 80 % of the 99 s cap.
  if (t.steer) par = Math.max(Math.ceil(sec * t.factor + t.slack), Math.min(par, 79));
  const timeLimit = Math.min(99, Math.max(par + 5, Math.ceil(par * t.limit)));
  if (par >= timeLimit || par > timeLimit * 0.8) return null;
  return { timeLimit, par, timeBonus: 5 };
}

function diagText(ds: ReadonlyArray<{ code: string; message: string }>): string {
  return ds.map((d) => `${d.code} ${d.message}`).join("; ");
}

function failedBeforeFork(guides: GuidePoint[][], r: number, progress: number): boolean {
  const a = guides[r]!;
  const b = guides[r + 1]!;
  let n = 0;
  while (n < a.length && n < b.length && a[n]![0] === b[n]![0] && a[n]![1] === b[n]![1]) n++;
  if (n < 2) return false;
  return progress * new Guide(a).total < new Guide(a.slice(0, n)).total - 1;
}

/** The waypoint autopilot's solution for a draft source (v2 behaviour). */
async function autopilot(
  source: LevelSource,
): Promise<{ runs: number[]; ticks: number; deaths: number } | string> {
  const draft = await compileLevel(source, { allowUnsolved: true });
  if (!draft.ok) return diagText(draft.diagnostics);
  const solution = "draft" in draft ? draft.draft.solution : null;
  if (!solution) {
    const d = "draft" in draft ? draft.diagnostics[0] : undefined;
    return d ? `${d.code} ${d.message}` : "no solution";
  }
  return solution;
}

/**
 * Generate, solve and stamp a course. Attempt 0 uses the seed itself; failed layouts are retried
 * with derived seeds (`attemptSeed`) up to `maxAttempts`, so a seed always maps to the same level.
 * Each layout is solved along its risky route first and falls back to the safe one (L18).
 */
export async function generateLevel(opts: GenerateLevelOptions): Promise<GenerateLevelResult> {
  const tier = TIERS[opts.difficulty];
  const search = tier.solver === "search";
  const max = opts.maxAttempts ?? (search ? MAX_SEARCH_ATTEMPTS : MAX_ATTEMPTS);
  const failures: string[] = [];
  const report = async (attempt: number, phase: GeneratePhase, progress: number) => {
    if (opts.onProgress) await opts.onProgress({ attempt, phase, progress });
  };
  for (let attempt = 0; attempt < max; attempt++) {
    await report(attempt, "layout", 0);
    const gen = generateSource(opts, attemptSeed(opts.seed, attempt));
    if (gen.problem) {
      failures.push(gen.problem);
      continue;
    }
    for (let r = 0; r < gen.routes.length; r++) {
      const line = r === 0 && gen.routes.length > 1 ? "risky" : "safe";
      const label = gen.routes.length > 1 ? `${line} line: ` : "";
      const waypoints: LevelSource = {
        ...gen.source,
        solution: { kind: "waypoints", points: gen.routes[r]! },
      };
      const bare = await compileLevel(
        { ...gen.source, solution: undefined },
        { allowUnsolved: true },
      );
      if (!bare.ok || !("draft" in bare)) {
        failures.push(label + ("diagnostics" in bare ? diagText(bare.diagnostics) : "no draft"));
        break;
      }
      const level: PlayableLevel = bare.draft;

      let solution: SolutionSource | null = null;
      let runs: number[] = [];
      let ticks = 0;
      let solver: "search" | "autopilot" = "autopilot";
      if (search) {
        await report(attempt, "solve", 0);
        const it = searchSteps(level, {
          guide: gen.guides[r]!,
          beam: tier.beam,
          budget: tier.budget,
          maxTicks: MAX_SOLUTION_SECONDS * TICK_HZ,
        });
        let res: SearchResult;
        for (;;) {
          const step = it.next();
          if (step.done) {
            res = step.value;
            break;
          }
          await report(attempt, "solve", step.value.progress);
        }
        if (res.ok) {
          runs = res.runs;
          ticks = res.ticks;
          solution = { kind: "replay", runs, expectedTicks: ticks };
          solver = "search";
        } else {
          failures.push(
            `${label}search ${res.reason} at ${(res.progress * 100).toFixed(0)}% (${res.pos.map((v) => v.toFixed(1)).join(",")})`,
          );
          // The routes only differ after the first fork; failing before it dooms both.
          if (r + 1 < gen.routes.length && failedBeforeFork(gen.guides, r, res.progress)) break;
          continue;
        }
      }
      if (!solution) {
        const ap = await autopilot(waypoints);
        if (typeof ap === "string") {
          failures.push(label + ap);
          continue;
        }
        if (ap.deaths > 0) {
          failures.push(`${label}solution died ${ap.deaths} time(s)`);
          continue;
        }
        runs = ap.runs;
        ticks = ap.ticks;
        solution = waypoints.solution!;
        solver = "autopilot";
      }
      if (ticks > MAX_SOLUTION_SECONDS * TICK_HZ) {
        failures.push(`${label}solution too long (${(ticks / TICK_HZ).toFixed(1)} s)`);
        continue;
      }

      await report(attempt, "measure", 0);
      const metrics = measureCourse(level, runs, gen.layoutSeed);
      const timing = timingFor(
        opts.difficulty,
        ticks,
        Math.round(metrics.dirChanges * metrics.seconds),
      );
      if (!timing) {
        failures.push(`${label}no par fits the limit (${(ticks / TICK_HZ).toFixed(1)} s)`);
        continue;
      }
      if (metrics.robustness < tier.minRobust) {
        failures.push(`${label}unfair: worst window ${metrics.robustness}% under small noise`);
        continue;
      }
      if (metrics.fragility < tier.minFragility) {
        failures.push(`${label}too forgiving: fragility ${metrics.fragility}%`);
        continue;
      }

      await report(attempt, "stamp", 0);
      const source: LevelSource = { ...gen.source, timing, solution };
      const sourceText = serializeSource(source);
      const res = await compileLevel(source, { sourceText });
      if (!res.ok || !("level" in res)) {
        failures.push(label + (diagText(res.diagnostics) || "compile failed"));
        continue;
      }
      if (res.level.solution.deaths > 0) {
        failures.push(`${label}solution died ${res.level.solution.deaths} time(s)`);
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
        metrics,
        line: line === "risky" ? "risky" : "safe",
        solver,
        version: GENERATOR_VERSION,
        failures,
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
