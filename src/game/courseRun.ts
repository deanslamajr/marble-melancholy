// Course races as pure functions, shared by the game and the score server (P15).
// The game records every tick's quantized input; the server replays a recording through the same
// setup and step and gets the same scores, so a submitted score must be reproducible to count.
import type { CompiledLevel } from "../level/types";
import { LeaveBehindRule } from "../render/camera";
import { TICK_HZ } from "../sim/constants";
import { dequantize } from "../sim/quantize";
import { RaceSim } from "../sim/race";
import type { InputFrame, SimEvent, SimSnapshot } from "../sim/types";
import { GameSession } from "./session";

/** Builds the sim for the session's current race, exactly as the game does. */
export function courseRaceSim(session: GameSession): RaceSim {
  return new RaceSim(session.level, {
    players: session.players,
    startTimeTicks: session.startTicks(),
    countdown: true,
    sittingOut: session.sittingOut,
    baseScores: session.scores,
  });
}

/** One sim tick plus the 2P left-behind rule (R18). */
export function stepRace(
  sim: RaceSim,
  leaveBehind: LeaveBehindRule,
  inputs: readonly InputFrame[],
): { events: SimEvent[]; snapshot: SimSnapshot } {
  const events = sim.step(inputs);
  const snapshot = sim.snapshot();
  if (sim.playerCount === 2) {
    const trailing = leaveBehind.tick(snapshot);
    if (trailing !== null) sim.leaveBehind(trailing);
  }
  return { events, snapshot };
}

export interface RaceRecording {
  /** `stamp.contentHash` of the level raced. */
  contentHash: string;
  ticks: number;
  /** Per player: run-length encoded quantized inputs, base64 (see encodeInputs). */
  inputs: string[];
}

export interface CourseRecording {
  version: 1;
  players: 1 | 2;
  races: RaceRecording[];
}

/** Collects the quantized input of every tick of one race. */
export class RaceRecorder {
  private readonly q: number[][];
  ticks = 0;

  constructor(players: number) {
    this.q = Array.from({ length: players }, () => []);
  }

  push(inputs: readonly InputFrame[]): void {
    for (let p = 0; p < this.q.length; p++) {
      const f = inputs[p]!;
      this.q[p]!.push(Math.round(f.ax * 127), Math.round(f.ay * 127));
    }
    this.ticks++;
  }

  finish(contentHash: string): RaceRecording {
    return { contentHash, ticks: this.ticks, inputs: this.q.map(encodeInputs) };
  }
}

/** Pairs of int8 axes → runs of [qx, qy, length 1..255] bytes → base64. */
export function encodeInputs(pairs: readonly number[]): string {
  const out: number[] = [];
  for (let i = 0; i < pairs.length;) {
    const x = pairs[i]!;
    const y = pairs[i + 1]!;
    let n = 1;
    while (n < 255 && pairs[i + 2 * n] === x && pairs[i + 2 * n + 1] === y) n++;
    out.push(x & 0xff, y & 0xff, n);
    i += 2 * n;
  }
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Inverse of encodeInputs; returns null for malformed data. */
export function decodeInputs(text: string, maxTicks: number): Int8Array | null {
  let bin: string;
  try {
    bin = atob(text);
  } catch {
    return null;
  }
  if (bin.length % 3 !== 0) return null;
  const out = new Int8Array(maxTicks * 2);
  let t = 0;
  for (let i = 0; i < bin.length; i += 3) {
    const x = (bin.charCodeAt(i) << 24) >> 24;
    const y = (bin.charCodeAt(i + 1) << 24) >> 24;
    const n = bin.charCodeAt(i + 2);
    if (n === 0 || t + n > maxTicks || x * x + y * y > 127 * 127) return null;
    for (let k = 0; k < n; k++, t++) {
      out[2 * t] = x;
      out[2 * t + 1] = y;
    }
  }
  return out.subarray(0, 2 * t);
}

/** Longest race a recording may claim: the 99 s timer plus generous end-of-race delays. */
export const MAX_RACE_TICKS = (99 + 12) * TICK_HZ;

/** Replays one recorded race of the session's current race; returns the sim or an error. */
export function replayRace(
  session: GameSession,
  race: RaceRecording,
  index: number,
): RaceSim | string {
  const n = index + 1;
  if (race.contentHash !== session.level.stamp.contentHash) {
    return `race ${n} is not the current course`;
  }
  if (!Number.isInteger(race.ticks) || race.ticks < 1 || race.ticks > MAX_RACE_TICKS) {
    return `race ${n} has an invalid length`;
  }
  if (race.inputs.length !== session.players) return "wrong player count";
  const streams = race.inputs.map((s) => decodeInputs(s, race.ticks));
  if (streams.some((s) => s === null || s.length !== race.ticks * 2)) {
    return `race ${n} has malformed inputs`;
  }
  const sim = courseRaceSim(session);
  const leaveBehind = new LeaveBehindRule();
  const frames: InputFrame[] = streams.map(() => ({ ax: 0, ay: 0 }));
  for (let t = 0; t < race.ticks; t++) {
    for (let p = 0; p < session.players; p++) {
      const s = streams[p]!;
      frames[p] = dequantize(s[2 * t]!, s[2 * t + 1]!);
    }
    stepRace(sim, leaveBehind, frames);
  }
  return sim;
}

export type CourseVerdict =
  | { ok: true; scores: number[]; reached: number[]; complete: boolean }
  | { ok: false; error: string };

/**
 * Replays a recording through the course and returns the scores it produces. A recording must
 * end the way the game does: every player out (game over) or the last race done.
 */
export function verifyCourseRun(
  levels: readonly CompiledLevel[],
  rec: CourseRecording,
): CourseVerdict {
  if (rec.version !== 1 || (rec.players !== 1 && rec.players !== 2)) {
    return { ok: false, error: "unsupported recording" };
  }
  if (rec.races.length < 1 || rec.races.length > levels.length) {
    return { ok: false, error: "wrong number of races" };
  }
  const session = new GameSession("course", rec.players, levels);
  for (let i = 0; i < rec.races.length; i++) {
    const sim = replayRace(session, rec.races[i]!, i);
    if (typeof sim === "string") return { ok: false, error: sim };
    const over = sim.players.every((p) => p.marble.status === "finished" || p.eliminated);
    if (!over) return { ok: false, error: `race ${i + 1} did not end` };
    session.recordRace(sim);
    const last = i === rec.races.length - 1;
    if (session.allOut() || !session.hasNext()) {
      if (!last) return { ok: false, error: "races after the end of the run" };
      return {
        ok: true,
        scores: [...session.scores],
        reached: [...session.reached],
        complete: !session.allOut(),
      };
    }
    if (last) return { ok: false, error: "the run stops before it ends" };
    session.advance();
  }
  return { ok: false, error: "unreachable" };
}
