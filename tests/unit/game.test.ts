// Scoring, session carry-over, FSM transitions and the hash router (§7.9, D10, D30, D31).
import { describe, expect, it } from "vitest";
import { parseRoute, routeHash, type Route } from "../../src/app/router";
import {
  MAX_START_TICKS,
  displaySeconds,
  formatScore,
  nextStartTicks,
  raceBreakdown,
} from "../../src/game/scoring";
import { GameSession } from "../../src/game/session";
import { TRANSITIONS, canTransition, simRuns, type GameState } from "../../src/game/states";
import { decodeRuns } from "../../src/level/solution/replay";
import type { CompiledLevel } from "../../src/level/types";
import { TICK_HZ } from "../../src/sim/constants";
import { dequantize } from "../../src/sim/quantize";
import { RaceSim } from "../../src/sim/race";
import { idle, loadCore, manifest } from "../helpers";

function finishWithReplay(level: CompiledLevel, opts: ConstructorParameters<typeof RaceSim>[1]) {
  const sim = new RaceSim(level, opts);
  for (const q of decodeRuns(level.solution.runs)) {
    const f = dequantize(...q);
    sim.step(Array.from({ length: opts.players }, () => f));
  }
  return sim;
}

describe("scoring helpers", () => {
  it("displaySeconds always rounds up and never goes negative", () => {
    expect(displaySeconds(0)).toBe(0);
    expect(displaySeconds(1)).toBe(1);
    expect(displaySeconds(TICK_HZ)).toBe(1);
    expect(displaySeconds(TICK_HZ + 1)).toBe(2);
    expect(displaySeconds(-50)).toBe(0);
  });

  it("formatScore uses fixed comma separators", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(999)).toBe("999");
    expect(formatScore(1000)).toBe("1,000");
    expect(formatScore(1234567)).toBe("1,234,567");
    expect(formatScore(-3)).toBe("0");
  });

  it("nextStartTicks adds the remaining time, the bonus only when finished, capped at 99 s", () => {
    expect(nextStartTicks(30, 5 * TICK_HZ, true, 10)).toBe(45 * TICK_HZ);
    expect(nextStartTicks(30, 5 * TICK_HZ, false, 10)).toBe(35 * TICK_HZ);
    expect(nextStartTicks(30, -10, false, 10)).toBe(30 * TICK_HZ);
    expect(nextStartTicks(90, 50 * TICK_HZ, true, 30)).toBe(MAX_START_TICKS);
  });

  it("a finished race's breakdown adds goal, per-second bonus and first-home", () => {
    const level = loadCore(manifest().course[0]!);
    const sim = finishWithReplay(level, { players: 1 });
    const p = sim.players[0]!;
    expect(p.marble.status).toBe("finished");
    const b = raceBreakdown(p, level);
    expect(b.finished).toBe(true);
    expect(b.goal).toBe(level.scoring.goal);
    expect(b.timeBonus).toBe(b.timeLeftSec * level.scoring.perSecond);
    expect(b.total).toBe(p.score);
    expect(b.raceScore).toBe(p.score - p.baseScore);
    expect(b.total).toBeGreaterThanOrEqual(b.goal + b.timeBonus);
  });

  it("an unfinished race earns no goal or time bonus", () => {
    const level = loadCore(manifest().course[0]!);
    const sim = new RaceSim(level, { players: 1 });
    idle(sim, TICK_HZ);
    const b = raceBreakdown(sim.players[0]!, level);
    expect(b.finished).toBe(false);
    expect(b.goal).toBe(0);
    expect(b.timeBonus).toBe(0);
  });
});

describe("game session", () => {
  const levels = manifest().course.map(loadCore);

  it("race 1 starts at the time limit; later races carry time and bonus", () => {
    const s = new GameSession("course", 1, levels);
    expect(s.startTicks()).toEqual([levels[0]!.timing.timeLimit * TICK_HZ]);
    const sim = finishWithReplay(levels[0]!, { players: 1, startTimeTicks: s.currentStartTicks });
    s.recordRace(sim);
    const left = sim.players[0]!.timeTicks;
    expect(s.hasNext()).toBe(true);
    s.advance();
    expect(s.raceIndex).toBe(1);
    expect(s.reached[0]).toBe(s.raceNumber);
    expect(s.startTicks()[0]).toBe(
      nextStartTicks(levels[1]!.timing.timeLimit, left, true, levels[0]!.timing.timeBonus),
    );
    expect(s.scores[0]).toBe(sim.players[0]!.score);
  });

  it("a timed-out 2P player sits out the rest of the course", () => {
    const s = new GameSession("course", 2, levels);
    s.startTicks();
    const sim = new RaceSim(levels[0]!, { players: 2, startTimeTicks: [TICK_HZ, TICK_HZ * 60] });
    idle2(sim, 3 * TICK_HZ);
    expect(sim.players[0]!.eliminated).toBe(true);
    s.recordRace(sim);
    expect(s.sittingOut).toEqual([true, false]);
    expect(s.allOut()).toBe(false);
    s.advance();
    expect(s.reached).toEqual([1, s.raceNumber]);
  });

  it("custom mode has no next race", () => {
    const s = new GameSession("custom", 1, [levels[0]!]);
    expect(s.hasNext()).toBe(false);
  });
});

function idle2(sim: RaceSim, ticks: number) {
  const z = dequantize(0, 0);
  for (let i = 0; i < ticks; i++) sim.step([z, z]);
}

describe("game states", () => {
  it("every transition target is a known state", () => {
    const states = Object.keys(TRANSITIONS) as GameState[];
    for (const s of states) for (const t of TRANSITIONS[s]) expect(states).toContain(t);
  });

  it("allows the main flow and blocks shortcuts", () => {
    expect(canTransition("boot", "title")).toBe(true);
    expect(canTransition("title", "playerSelect")).toBe(true);
    expect(canTransition("raceIntro", "countdown")).toBe(true);
    expect(canTransition("countdown", "racing")).toBe(true);
    expect(canTransition("racing", "raceComplete")).toBe(true);
    expect(canTransition("racing", "gameOver")).toBe(true);
    expect(canTransition("boot", "racing")).toBe(false);
    expect(canTransition("title", "racing")).toBe(false);
    expect(canTransition("gameOver", "racing")).toBe(false);
  });

  it("the sim only runs during countdown and racing", () => {
    expect(simRuns("countdown")).toBe(true);
    expect(simRuns("racing")).toBe(true);
    expect(simRuns("paused")).toBe(false);
    expect(simRuns("raceComplete")).toBe(false);
  });
});

describe("router", () => {
  const routes: Route[] = [
    { name: "title" },
    { name: "play" },
    { name: "playCustom", id: "my level/1" },
    { name: "custom" },
    { name: "scores" },
    { name: "settings" },
    { name: "builder" },
    { name: "builderDraft", draftId: "d-123" },
    { name: "extras" },
    { name: "playExtra", id: "puddle-hop" },
    { name: "generate" },
    { name: "generate", difficulty: "hard", seed: 42 },
    { name: "playGenerated", difficulty: "medium", seed: 4294967295 },
    { name: "playGenerated", difficulty: "expert", seed: 9, version: 2 },
    { name: "generate", difficulty: "expert", seed: 0, version: 1 },
  ];

  it("routeHash and parseRoute round-trip", () => {
    for (const r of routes) expect(parseRoute(routeHash(r))).toEqual(r);
  });

  it("tolerates empty, trailing-slash and unknown hashes", () => {
    expect(parseRoute("")).toEqual({ name: "title" });
    expect(parseRoute("#")).toEqual({ name: "title" });
    expect(parseRoute("#/play/")).toEqual({ name: "play" });
    expect(parseRoute("#/nowhere")).toEqual({ name: "title" });
  });

  it("generated-course URLs are shareable and malformed ones fall back to the generator", () => {
    expect(parseRoute("#/play/generated/medium/123")).toEqual({
      name: "playGenerated",
      difficulty: "medium",
      seed: 123,
    });
    expect(parseRoute("#/play/generated/HARD/7")).toEqual({
      name: "playGenerated",
      difficulty: "hard",
      seed: 7,
    });
    expect(parseRoute("#/play/generated/nightmare/7/v3")).toEqual({
      name: "playGenerated",
      difficulty: "nightmare",
      seed: 7,
      version: 3,
    });
    expect(parseRoute("#/play/generated/ludicrous/7")).toEqual({ name: "generate" });
    expect(parseRoute("#/play/generated/easy/-1")).toEqual({ name: "generate" });
    expect(parseRoute("#/play/generated/easy/4294967296")).toEqual({ name: "generate" });
    expect(parseRoute("#/generate/easy/x")).toEqual({ name: "generate" });
  });

  it("generated-course URLs accept Expert and an optional generator version", () => {
    expect(parseRoute("#/play/generated/expert/5")).toEqual({
      name: "playGenerated",
      difficulty: "expert",
      seed: 5,
    });
    expect(parseRoute("#/play/generated/hard/7/V2")).toEqual({
      name: "playGenerated",
      difficulty: "hard",
      seed: 7,
      version: 2,
    });
    expect(routeHash({ name: "playGenerated", difficulty: "easy", seed: 777 })).toBe(
      "#/play/generated/easy/777",
    );
    expect(parseRoute("#/play/generated/hard/7/v0")).toEqual({ name: "generate" });
    expect(parseRoute("#/generate/hard/7/beta")).toEqual({ name: "generate" });
  });
});
