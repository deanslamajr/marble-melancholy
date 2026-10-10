import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "../../server/app";
import { MemoryStore } from "../../server/store";
import { encodeInputs } from "../../src/game/courseRun";
import { courseLevels, playCourse, solve } from "../helpers/course";

let server: Server;
let base = "";

beforeAll(async () => {
  const handler = createHandler({ store: new MemoryStore(), course: async () => courseLevels });
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
