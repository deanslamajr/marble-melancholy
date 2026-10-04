// Headless single-player runs: replays, autopilot, scripts (§5.5).
import { RunCursor, RunEncoder } from "../level/solution/replay";
import type { Cell, PlayableLevel } from "../level/types";
import { TICK_HZ } from "./constants";
import { dequantize } from "./quantize";
import { RaceSim } from "./race";
import type { InputFrame, PlayerState, SimEvent } from "./types";

export type InputSource = (sim: RaceSim, p: PlayerState) => [number, number] | null | "abort";

export interface TickInfo {
  sim: RaceSim;
  tick: number;
  input: InputFrame;
  events: readonly SimEvent[];
}

export interface RunOptions {
  /** Hard tick limit (default timeLimit × 120). */
  maxTicks?: number;
  /** Zero-input ticks allowed after the source is exhausted before giving up (default 240). */
  extraTicks?: number;
  onTick?: (info: TickInfo) => void;
}

export type RunEnd = "goal" | "timeout" | "source-ended" | "abort";

export interface RunResult {
  end: RunEnd;
  reached: boolean;
  /** Goal tick when reached, else the last simulated tick. */
  ticks: number;
  deaths: number;
  stateHash: string;
  pos: [number, number, number];
  path: Cell[];
  deathCells: Cell[];
  runs: number[];
}

export function runInputs(level: PlayableLevel, source: InputSource, opts: RunOptions = {}): RunResult {
  const sim = new RaceSim(level, { players: 1 });
  const p = sim.players[0]!;
  const maxTicks = opts.maxTicks ?? level.timing.timeLimit * TICK_HZ;
  const extra = opts.extraTicks ?? 240;
  const enc = new RunEncoder();
  const path: Cell[] = [];
  const deathCells: Cell[] = [];
  let exhausted = 0;
  let end: RunEnd = "timeout";
  let goalTick = -1;

  const visit = (x: number, y: number) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const last = path[path.length - 1];
    if (!last || last[0] !== cx || last[1] !== cy) path.push([cx, cy]);
  };
  visit(p.marble.x, p.marble.y);

  while (sim.tick < maxTicks) {
    let q = source(sim, p);
    if (q === "abort") {
      end = "abort";
      break;
    }
    if (q === null) {
      if (exhausted >= extra) {
        end = "source-ended";
        break;
      }
      exhausted++;
      q = [0, 0];
    }
    enc.push(q[0], q[1]);
    const input = dequantize(q[0], q[1]);
    const tick = sim.tick;
    const events = sim.step([input]);
    for (const e of events) {
      if (e.t === "death") deathCells.push([Math.floor(e.x), Math.floor(e.y)]);
      if (e.t === "goal" && goalTick < 0) goalTick = e.tick;
    }
    if (p.marble.status === "alive") visit(p.marble.x, p.marble.y);
    opts.onTick?.({ sim, tick, input, events });
    if (goalTick >= 0) {
      end = "goal";
      break;
    }
    if (p.eliminated) {
      end = "timeout";
      break;
    }
  }

  const m = p.marble;
  return {
    end,
    reached: end === "goal",
    ticks: end === "goal" ? goalTick : sim.tick,
    deaths: p.deaths,
    stateHash: sim.hash(),
    pos: [m.x, m.y, m.z],
    path,
    deathCells,
    runs: enc.runs,
  };
}

/** Re-run an embedded solution replay (runs) for verification. */
export function runReplay(level: PlayableLevel, runs: readonly number[], opts: RunOptions = {}): RunResult {
  const cursor = new RunCursor(runs);
  return runInputs(level, () => cursor.next(), opts);
}
