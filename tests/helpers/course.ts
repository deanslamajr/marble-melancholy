// Plays the six-race course headlessly, the way GameController does, and records it (P15).
import {
  courseRaceSim,
  RaceRecorder,
  stepRace,
  type CourseRecording,
} from "../../src/game/courseRun";
import { GameSession } from "../../src/game/session";
import { decodeRuns } from "../../src/level/solution/replay";
import type { CompiledLevel } from "../../src/level/types";
import { LeaveBehindRule } from "../../src/render/camera";
import { COUNTDOWN_TICKS } from "../../src/sim/constants";
import { dequantize } from "../../src/sim/quantize";
import type { InputFrame } from "../../src/sim/types";
import { loadCore, manifest } from "./index";

export type Steer = (race: number, tick: number, player: number) => [number, number];

/** Plays a course the way GameController does and records it. */
export function playCourse(levels: CompiledLevel[], players: 1 | 2, steer: Steer) {
  const session = new GameSession("course", players, levels);
  const recording: CourseRecording = { version: 1, players, races: [] };
  for (;;) {
    const sim = courseRaceSim(session);
    const rec = new RaceRecorder(players);
    const leaveBehind = new LeaveBehindRule();
    let tail = -1;
    for (let t = 0; tail !== 0; t++) {
      const inputs: InputFrame[] = [];
      for (let p = 0; p < players; p++) inputs.push(dequantize(...steer(session.raceIndex, t, p)));
      stepRace(sim, leaveBehind, inputs);
      rec.push(inputs);
      const over = sim.players.every((p) => p.marble.status === "finished" || p.eliminated);
      if (over && tail < 0) tail = 90; // the game keeps stepping through the result delay
      if (tail > 0) tail--;
    }
    session.recordRace(sim);
    recording.races.push(rec.finish(session.level.stamp.contentHash));
    if (session.allOut() || !session.hasNext()) break;
    session.advance();
  }
  return { recording, scores: [...session.scores], reached: [...session.reached] };
}

export const courseLevels = manifest().course.map((id) => loadCore(id));
const solutions = courseLevels.map((l) => decodeRuns(l.solution.runs));
/** Player 0 follows each race's embedded solution after the countdown; others stay still. */
export const solve: Steer = (race, t, p) =>
  p === 0 && t >= COUNTDOWN_TICKS ? (solutions[race]![t - COUNTDOWN_TICKS] ?? [0, 0]) : [0, 0];
