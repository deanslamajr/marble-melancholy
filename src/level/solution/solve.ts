// solveSolution(level, spec) → Replay | failure trace (§6.4, §6.6).
import { TICK_HZ } from "../../sim/constants";
import type { HammerEntity } from "../../sim/entities/hammer";
import type { RaceSim } from "../../sim/race";
import { runInputs, type RunOptions, type RunResult } from "../../sim/replayRunner";
import type { Cell, PlayableLevel, SolutionSource } from "../types";
import { Autopilot } from "./autopilot";
import { RunCursor, type Replay } from "./replay";
import { ScriptPlayer } from "./script";

export type SolveFailReason = "timeout" | "waypoint-unreached" | "script-ended" | "replay-ended";

export type SolveResult =
  | {
      ok: true;
      replay: Replay;
      ticks: number;
      deaths: number;
      stateHash: string;
      path: Cell[];
      deathCells: Cell[];
    }
  | {
      ok: false;
      reason: SolveFailReason;
      tick: number;
      pos: [number, number, number];
      waypointIndex?: number;
      deaths: number;
      path: Cell[];
      deathCells: Cell[];
    };

export interface SolveOptions {
  onTick?: RunOptions["onTick"];
  /** Exposes the autopilot (trace output shows the current waypoint). */
  onAutopilot?: (ap: Autopilot) => void;
}

export function solveSolution(
  level: PlayableLevel,
  spec: SolutionSource,
  opts: SolveOptions = {},
): SolveResult {
  const limit = level.timing.timeLimit * TICK_HZ;
  let result: RunResult;
  let ap: Autopilot | null = null;
  switch (spec.kind) {
    case "waypoints": {
      let current: RaceSim | null = null;
      let hammers: HammerEntity[] = [];
      let hammersOf: RaceSim | null = null;
      const pilot = new Autopilot(
        spec.points,
        (x, y) => {
          if (!current) return "static";
          const g = current.terrain.groundAt(x, y, current.tick);
          return g === null ? "none" : g.carrier ? "carrier" : "static";
        },
        () => {
          if (!current) return { tick: 0, hammers: [] };
          if (hammersOf !== current) {
            hammers = current.entities.filter((e): e is HammerEntity => e.type === "hammer");
            hammersOf = current;
          }
          return { tick: current.tick, hammers };
        },
      );
      ap = pilot;
      opts.onAutopilot?.(pilot);
      const maxTicks = Math.min(spec.maxTicks ?? limit, limit);
      result = runInputs(
        level,
        (sim, p) => {
          current = sim;
          return pilot.failed ? "abort" : pilot.input(p);
        },
        {
          maxTicks,
          onTick: opts.onTick,
        },
      );
      break;
    }
    case "script": {
      const sp = new ScriptPlayer(spec.segments);
      result = runInputs(level, () => (sp.ended ? null : sp.next()), {
        maxTicks: limit,
        extraTicks: limit,
        onTick: opts.onTick,
      });
      break;
    }
    case "replay": {
      const cursor = new RunCursor(spec.runs);
      result = runInputs(level, () => cursor.next(), {
        maxTicks: limit,
        extraTicks: 240,
        onTick: opts.onTick,
      });
      break;
    }
  }
  if (result.reached) {
    return {
      ok: true,
      replay: { runs: result.runs },
      ticks: result.ticks,
      deaths: result.deaths,
      stateHash: result.stateHash,
      path: result.path,
      deathCells: result.deathCells,
    };
  }
  let reason: SolveFailReason = "timeout";
  if (result.end === "abort") reason = "waypoint-unreached";
  else if (result.end === "source-ended")
    reason = spec.kind === "replay" ? "replay-ended" : "script-ended";
  return {
    ok: false,
    reason,
    tick: result.ticks,
    pos: result.pos,
    waypointIndex: ap ? ap.i : undefined,
    deaths: result.deaths,
    path: result.path,
    deathCells: result.deathCells,
  };
}
