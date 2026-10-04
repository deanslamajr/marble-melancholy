// One play-through: which races, how many players, carried scores and timers (§7.9).
import type { CompiledLevel } from "../level/types";
import { TICK_HZ } from "../sim/constants";
import type { RaceSim } from "../sim/race";
import { nextStartTicks } from "./scoring";

export type SessionMode = "course" | "custom";

export class GameSession {
  raceIndex = 0;
  readonly scores: number[];
  /** Players that timed out in an earlier race (2P) and sit out the rest. */
  readonly sittingOut: boolean[];
  /** Furthest race number (1-based) each player reached. */
  readonly reached: number[];
  private carryTicks: number[];
  private prevFinished: boolean[];
  private prevTimeBonus = 0;
  /** Start timers used for the race in progress. */
  currentStartTicks: number[] = [];

  constructor(
    readonly mode: SessionMode,
    readonly players: 1 | 2,
    readonly levels: readonly CompiledLevel[],
  ) {
    this.scores = Array.from({ length: players }, () => 0);
    this.sittingOut = Array.from({ length: players }, () => false);
    this.reached = Array.from({ length: players }, () => 1);
    this.carryTicks = Array.from({ length: players }, () => 0);
    this.prevFinished = Array.from({ length: players }, () => false);
  }

  get level(): CompiledLevel {
    return this.levels[this.raceIndex]!;
  }

  get raceNumber(): number {
    return this.level.course?.slot ?? this.raceIndex + 1;
  }

  hasNext(): boolean {
    return this.mode === "course" && this.raceIndex + 1 < this.levels.length;
  }

  startTicks(): number[] {
    const limit = this.level.timing.timeLimit;
    this.currentStartTicks =
      this.raceIndex === 0
        ? this.scores.map(() => limit * TICK_HZ)
        : this.scores.map((_, p) =>
            nextStartTicks(limit, this.carryTicks[p]!, this.prevFinished[p]!, this.prevTimeBonus),
          );
    return this.currentStartTicks;
  }

  /** Record the end of the current race from the sim's final state. */
  recordRace(sim: RaceSim): void {
    for (const p of sim.players) {
      this.scores[p.index] = p.score;
      const finished = p.marble.status === "finished";
      this.prevFinished[p.index] = finished;
      this.carryTicks[p.index] = p.timeTicks;
      if (p.eliminated && !finished) this.sittingOut[p.index] = true;
    }
    this.prevTimeBonus = this.level.timing.timeBonus;
  }

  allOut(): boolean {
    return this.sittingOut.every(Boolean);
  }

  advance(): void {
    this.raceIndex++;
    for (let p = 0; p < this.players; p++) {
      if (!this.sittingOut[p]) this.reached[p] = this.raceNumber;
    }
  }
}
