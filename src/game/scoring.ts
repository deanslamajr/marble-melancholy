// Pure scoring and timer helpers (§7.9, D30, D31).
import type { CompiledLevel } from "../level/types";
import { TICK_HZ } from "../sim/constants";
import type { PlayerState } from "../sim/types";

export const MAX_START_TICKS = 99 * TICK_HZ;

/** Displayed whole seconds for a tick count (always rounds up, so 0.01 s shows as 1). */
export function displaySeconds(ticks: number): number {
  return Math.max(0, Math.ceil(ticks / TICK_HZ));
}

/** Thousands separators with a fixed comma so the display is the same in every locale. */
export function formatScore(n: number): string {
  const s = String(Math.max(0, Math.round(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Starting timer for the next race (D31): limit + remaining (+ bonus only if the player finished). */
export function nextStartTicks(
  nextTimeLimit: number,
  remainingTicks: number,
  finished: boolean,
  finishedTimeBonus: number,
): number {
  const bonus = finished ? finishedTimeBonus * TICK_HZ : 0;
  return Math.min(MAX_START_TICKS, nextTimeLimit * TICK_HZ + Math.max(0, remainingTicks) + bonus);
}

export interface RaceBreakdown {
  player: number;
  finished: boolean;
  eliminated: boolean;
  timeLeftSec: number;
  progress: number;
  goal: number;
  timeBonus: number;
  firstHome: number;
  raceScore: number;
  total: number;
  deaths: number;
}

export function raceBreakdown(p: PlayerState, level: CompiledLevel): RaceBreakdown {
  const finished = p.marble.status === "finished";
  const sc = level.scoring;
  const timeLeftSec = displaySeconds(p.timeTicks);
  return {
    player: p.index,
    finished,
    eliminated: p.eliminated && !finished,
    timeLeftSec,
    progress: p.progressScore,
    goal: finished ? sc.goal : 0,
    timeBonus: finished ? timeLeftSec * sc.perSecond : 0,
    firstHome: p.firstHome ? sc.firstHome : 0,
    raceScore: p.score - p.baseScore,
    total: p.score,
    deaths: p.deaths,
  };
}

/** Elapsed race time in ticks for a finished player (custom mode "TIME vs PAR"). */
export function elapsedTicks(p: PlayerState, startTicks: number): number {
  return p.finishTick >= 0 ? p.finishTick : startTicks - p.timeTicks;
}
