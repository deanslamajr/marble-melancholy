import { describe, expect, it } from "vitest";
import {
  courseRaceSim,
  decodeInputs,
  encodeInputs,
  RaceRecorder,
  stepRace,
  verifyCourseRun,
  type CourseRecording,
} from "../../src/game/courseRun";
import { GameSession } from "../../src/game/session";
import { decodeRuns } from "../../src/level/solution/replay";
import type { CompiledLevel } from "../../src/level/types";
import { LeaveBehindRule } from "../../src/render/camera";
import { COUNTDOWN_TICKS } from "../../src/sim/constants";
import { dequantize } from "../../src/sim/quantize";
import type { InputFrame } from "../../src/sim/types";
import { loadCore, manifest } from "../helpers";

type Steer = (race: number, tick: number, player: number) => [number, number];

/** Plays a course the way GameController does and records it. */
function playCourse(levels: CompiledLevel[], players: 1 | 2, steer: Steer) {
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

const levels = manifest().course.map((id) => loadCore(id));
const solutions = levels.map((l) => decodeRuns(l.solution.runs));
/** Player 0 follows each race's embedded solution after the countdown; others stay still. */
const solve: Steer = (race, t, p) =>
  p === 0 && t >= COUNTDOWN_TICKS ? (solutions[race]![t - COUNTDOWN_TICKS] ?? [0, 0]) : [0, 0];

describe("course recordings (P15)", () => {
  it("round-trips quantized inputs, including runs longer than 255 ticks", () => {
    const pairs: number[] = [];
    for (let i = 0; i < 700; i++) pairs.push(127, 0);
    pairs.push(-89, -89, 0, -127, 3, 4);
    const back = decodeInputs(encodeInputs(pairs), 703);
    expect(Array.from(back!)).toEqual(pairs);
    expect(decodeInputs(encodeInputs(pairs), 702)).toBeNull();
    expect(decodeInputs("not base64!", 10)).toBeNull();
  });

  it("a solved 1P course replays to exactly the scores it earned", () => {
    const run = playCourse(levels, 1, solve);
    expect(run.recording.races).toHaveLength(levels.length);
    const v = verifyCourseRun(levels, run.recording);
    expect(v).toEqual({ ok: true, scores: run.scores, reached: run.reached, complete: true });
    expect(run.scores[0]).toBeGreaterThan(0);
  });

  it("a 2P run where player 2 never moves replays to the same scores", () => {
    const run = playCourse(levels, 2, solve);
    const v = verifyCourseRun(levels, run.recording);
    expect(v).toEqual({ ok: true, scores: run.scores, reached: run.reached, complete: true });
  });

  it("an idle player's game over after race 1 verifies as an incomplete run", () => {
    const run = playCourse(levels, 1, () => [0, 0]);
    expect(run.recording.races).toHaveLength(1);
    const v = verifyCourseRun(levels, run.recording);
    expect(v).toMatchObject({ ok: true, complete: false, scores: run.scores });
  });

  it("rejects tampered, truncated and foreign recordings", () => {
    const run = playCourse(levels, 1, solve);
    const rec = run.recording;
    const swapped: CourseRecording = {
      ...rec,
      races: rec.races.map((r, i) => (i === 0 ? { ...r, inputs: [encodeInputs([0, 0])] } : r)),
    };
    expect(verifyCourseRun(levels, swapped).ok).toBe(false);
    expect(verifyCourseRun(levels, { ...rec, races: rec.races.slice(0, 3) })).toEqual({
      ok: false,
      error: "the run stops before it ends",
    });
    const foreign = { ...rec, races: [{ ...rec.races[0]!, contentHash: "sha256:00" }] };
    expect(verifyCourseRun(levels, foreign)).toEqual({
      ok: false,
      error: "race 1 is not the current course",
    });
    const cut = { ...rec, races: [{ ...rec.races[0]!, ticks: COUNTDOWN_TICKS + 10 }] };
    expect(verifyCourseRun(levels, cut).ok).toBe(false);
  });
});
