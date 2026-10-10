import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "../../server/app";
import { MemoryStore } from "../../server/store";
import { encodeInputs } from "../../src/game/courseRun";
import { LevelLoader } from "../../src/levels/loader";
import { loadExtra } from "../helpers";
import { courseLevels, playCourse, playRace, solutionSteer, solve } from "../helpers/course";

let server: Server;
let base = "";

beforeAll(async () => {
  const handler = createHandler({
    store: new MemoryStore(),
    course: async () => courseLevels,
    loadLevel: (json) => LevelLoader.load(json),
  });
  server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (body: unknown) =>
  fetch(`${base}/api/scores/campaign`, { method: "POST", body: JSON.stringify(body) });

describe("score server (P15)", () => {
  const solo = playCourse(courseLevels, 1, solve);
  const duo = playCourse(courseLevels, 2, solve);

  it("accepts a verified run with the score the server re-earned, once", async () => {
    const r = await post({ initials: "mel!", player: 0, recording: solo.recording });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ score: solo.scores[0], race: 6, index: 0 });
    expect(body.table[0]).toMatchObject({ initials: "MEL", score: solo.scores[0], players: 1 });
    const again = await (
      await post({ initials: "XYZ", player: 0, recording: solo.recording })
    ).json();
    expect(again.table).toHaveLength(1);
  });

  it("stores both players of a 2P run, and only players with points", async () => {
    expect((await post({ initials: "AAA", player: 0, recording: duo.recording })).status).toBe(200);
    const p2 = await post({ initials: "BBB", player: 1, recording: duo.recording });
    if (duo.scores[1]! > 0) expect(p2.status).toBe(200);
    else expect(p2.status).toBe(422);
    const table = (await (await fetch(`${base}/api/scores/campaign`)).json()).table;
    expect(table.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects tampered and malformed submissions", async () => {
    const tampered = {
      ...solo.recording,
      races: solo.recording.races.map((r, i) =>
        i === 0 ? { ...r, inputs: [encodeInputs([0, 0])] } : r,
      ),
    };
    expect((await post({ initials: "BAD", player: 0, recording: tampered })).status).toBe(422);
    expect((await post({ initials: "BAD", player: 1, recording: solo.recording })).status).toBe(
      400,
    );
    expect((await post({ initials: "BAD" })).status).toBe(400);
    const notJson = await fetch(`${base}/api/scores/campaign`, { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});

describe("race-time boards (P17)", () => {
  const level = loadExtra("puddle-hop");
  const other = loadExtra("ice-rink-blues");
  const key = level.stamp.contentHash.slice(7);
  const fast = playRace(level, solutionSteer(level));
  // A slower run: wait a second before following the solution.
  const steer = solutionSteer(level);
  const slow = playRace(level, (t) => (t < 120 ? [0, 0] : steer(t - 120)));
  const send = (body: unknown, k = key) =>
    fetch(`${base}/api/boards/${k}`, { method: "POST", body: JSON.stringify(body) });

  it("asks for the course once, then ranks verified times fastest first", async () => {
    const first = await send({ initials: "slo", race: slow.race });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ needLevel: true });
    const up = await send({ initials: "slo", race: slow.race, level });
    expect(up.status).toBe(200);
    expect(await up.json()).toMatchObject({ ticks: slow.player.finishTick, index: 0 });
    const r = await send({ initials: "fst", race: fast.race });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ ticks: fast.player.finishTick, index: 0 });
    expect(body.table.map((e: { initials: string }) => e.initials)).toEqual(["FST", "SLO"]);
    const table = (await (await fetch(`${base}/api/boards/${key}`)).json()).table;
    expect(table).toHaveLength(2);
    const otherKey = other.stamp.contentHash.slice(7);
    const best = await (await fetch(`${base}/api/boards?h=${key},${otherKey}`)).json();
    expect(Object.keys(best.best)).toEqual([key]);
    expect(best.best[key]).toMatchObject({ initials: "FST", ticks: fast.player.finishTick });
  });

  it("rejects runs that never finish, edited courses and courses under another board", async () => {
    const idle = playRace(level, () => [0, 0]);
    expect((await send({ initials: "BAD", race: idle.race })).status).toBe(422);
    const otherKey = other.stamp.contentHash.slice(7);
    const run = playRace(other, solutionSteer(other));
    const edited = { ...other, name: "Easy Street" };
    expect((await send({ initials: "BAD", race: run.race, level: edited }, otherKey)).status).toBe(
      422,
    );
    const wrong = await send({ initials: "BAD", race: run.race, level }, otherKey);
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).error).toBe("the course does not match its board");
    expect((await send({ initials: "BAD", race: run.race })).status).toBe(400);
    expect((await fetch(`${base}/api/boards/xyz`)).status).toBe(404);
    expect((await fetch(`${base}/api/boards?h=xyz`)).status).toBe(400);
  });
});
