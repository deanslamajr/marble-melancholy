// Attract mode: plays the embedded solution replays of the core races in turn.
import { RunCursor } from "../level/solution/replay";
import type { CompiledLevel } from "../level/types";
import { dequantize } from "../sim/quantize";
import { RaceSim } from "../sim/race";
import type { SimEvent, SimSnapshot } from "../sim/types";

/** Ticks shown after the replay ends before moving to the next race. */
const TAIL_TICKS = 180;

export class AttractRun {
  readonly sim: RaceSim;
  private readonly cursor: RunCursor;
  private tail = TAIL_TICKS;
  prev: SimSnapshot;
  cur: SimSnapshot;

  constructor(readonly level: CompiledLevel) {
    this.sim = new RaceSim(level, { players: 1 });
    this.cursor = new RunCursor(level.solution.runs);
    this.cur = this.sim.snapshot();
    this.prev = this.cur;
  }

  get done(): boolean {
    return this.tail <= 0;
  }

  step(): SimEvent[] {
    const q = this.cursor.next();
    if (!q) this.tail--;
    const input = q ? dequantize(q[0], q[1]) : { ax: 0, ay: 0 };
    const events = this.sim.step([input]);
    this.prev = this.cur;
    this.cur = this.sim.snapshot();
    return events;
  }
}

/** Cycles through levels, one AttractRun at a time. */
export class AttractReel {
  private i = 0;
  run: AttractRun | null = null;

  constructor(private readonly levels: readonly CompiledLevel[]) {}

  next(): AttractRun | null {
    if (this.levels.length === 0) return null;
    const level = this.levels[this.i % this.levels.length]!;
    this.i++;
    this.run = new AttractRun(level);
    return this.run;
  }
}
