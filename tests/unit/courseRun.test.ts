import { describe, expect, it } from "vitest";
import {
  decodeInputs,
  encodeInputs,
  verifyCourseRun,
  verifyRaceTime,
  type CourseRecording,
} from "../../src/game/courseRun";
import { elapsedTicks } from "../../src/game/scoring";
import { loadExtra } from "../helpers";
import { COUNTDOWN_TICKS } from "../../src/sim/constants";
import {
  courseLevels as levels,
  playCourse,
  playRace,
  solutionSteer,
  solve,
} from "../helpers/course";

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

describe("single-race times (P17)", () => {
  const level = loadExtra("puddle-hop");

  it("a finished race replays to the time the player saw", () => {
    const { race, player } = playRace(level, solutionSteer(level));
    expect(player.marble.status).toBe("finished");
    const v = verifyRaceTime(level, race);
    expect(v).toEqual({ ok: true, ticks: elapsedTicks(player, 0) });
    expect(player.finishTick).toBeGreaterThan(0);
  });

  it("rejects runs that never get home, belong to another course or were edited", () => {
    const idle = playRace(level, () => [0, 0]);
    expect(verifyRaceTime(level, idle.race)).toEqual({
      ok: false,
      error: "the marble never got home",
    });
    const { race } = playRace(level, solutionSteer(level));
    const other = loadExtra("ice-rink-blues");
    expect(verifyRaceTime(other, race)).toMatchObject({ ok: false });
    const cut = { ...race, ticks: race.ticks - 200 };
    expect(verifyRaceTime(level, cut)).toMatchObject({ ok: false });
  });
});
