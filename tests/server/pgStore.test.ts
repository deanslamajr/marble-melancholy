// Runs only with TEST_DATABASE_URL, e.g. against `docker run -e POSTGRES_PASSWORD=x -p 5433:5432
// postgres:17-alpine`. The table is dropped first, so never point it at a real database.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PgStore, type NewCampaignScore, type NewRaceTime } from "../../server/store";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgStore against Postgres (P15)", () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const store = new PgStore(pool);
  afterAll(() => pool.end());

  const entry = (score: number, runHash: string, player = 0): NewCampaignScore => ({
    initials: "PGT",
    score,
    race: 3,
    players: 1,
    player,
    complete: false,
    runHash,
    recording: { version: 1, players: 1, races: [] },
    build: "test",
  });

  it("creates its schema, ranks entries and ignores repeats", async () => {
    await pool.query("DROP TABLE IF EXISTS shared_courses, race_times, levels, campaign_scores");
    await store.init();
    await store.init();
    expect(await store.ping()).toBe(true);
    expect(await store.addCampaign(entry(500, "a"), 10)).toEqual({ index: 0, duplicate: false });
    expect(await store.addCampaign(entry(900, "b"), 10)).toEqual({ index: 0, duplicate: false });
    expect(await store.addCampaign(entry(700, "c"), 10)).toEqual({ index: 1, duplicate: false });
    expect(await store.addCampaign(entry(700, "c"), 10)).toEqual({ index: 1, duplicate: true });
    expect(await store.addCampaign(entry(100, "d"), 2)).toEqual({ index: -1, duplicate: false });
    const top = await store.topCampaign(10);
    expect(top.map((r) => r.score)).toEqual([900, 700, 500, 100]);
    expect(top[0]).toMatchObject({ initials: "PGT", race: 3, players: 1 });
    expect(Number.isNaN(Date.parse(top[0]!.date))).toBe(false);
  });

  it("stores each course once and ranks race times per board", async () => {
    const h = `sha256:${"a".repeat(64)}`;
    const other = `sha256:${"b".repeat(64)}`;
    const time = (ticks: number, runHash: string, contentHash = h): NewRaceTime => ({
      contentHash,
      initials: "PGT",
      ticks,
      runHash,
      recording: { contentHash, ticks: 1, inputs: [""] },
      build: "test",
    });
    expect(await store.getLevel(h)).toBeNull();
    await store.putLevel(h, "One", '{"v":1}');
    await store.putLevel(h, "One", '{"v":2}');
    expect(await store.getLevel(h)).toBe('{"v":1}');
    await store.putLevel(other, "Two", "{}");
    expect(await store.addTime(time(900, "t1"), 10)).toEqual({ index: 0, duplicate: false });
    expect(await store.addTime(time(700, "t2"), 10)).toEqual({ index: 0, duplicate: false });
    expect(await store.addTime(time(800, "t3"), 10)).toEqual({ index: 1, duplicate: false });
    expect(await store.addTime(time(800, "t3"), 10)).toEqual({ index: 1, duplicate: true });
    expect(await store.addTime(time(500, "t4", other), 10)).toEqual({
      index: 0,
      duplicate: false,
    });
    expect((await store.topTimes(h, 10)).map((e) => e.ticks)).toEqual([700, 800, 900]);
    const best = await store.bestTimes([h, other, `sha256:${"c".repeat(64)}`]);
    expect(Object.fromEntries(Object.entries(best).map(([k, e]) => [k, e.ticks]))).toEqual({
      [h]: 700,
      [other]: 500,
    });
    await expect(store.addTime(time(1, "t5", `sha256:${"c".repeat(64)}`), 10)).rejects.toThrow();
  });

  it("shares each course under one code and lists, hides and shows it (P19)", async () => {
    const h = `sha256:${"a".repeat(64)}`;
    const other = `sha256:${"b".repeat(64)}`;
    const codes = ["aaaaaaa", "aaaaaaa", "bbbbbbb"];
    const next = () => codes.shift()!;
    const first = await store.shareCourse(
      { contentHash: h, name: "One", author: "PG", par: 9 },
      next,
    );
    expect(first).toEqual({ code: "aaaaaaa", hidden: false });
    // A taken code is retried; the same course keeps its code.
    const second = await store.shareCourse(
      { contentHash: other, name: "Two", author: null, par: 12 },
      next,
    );
    expect(second).toEqual({ code: "bbbbbbb", hidden: false });
    const again = await store.shareCourse(
      { contentHash: h, name: "One", author: "PG", par: 9 },
      () => "ccccccc",
    );
    expect(again).toEqual({ code: "aaaaaaa", hidden: false });
    expect(await store.getShared("aaaaaaa")).toEqual({
      contentHash: h,
      json: '{"v":1}',
      hidden: false,
    });
    const newest = await store.listShared({ sort: "new", limit: 10, offset: 0 });
    expect(newest.map((c) => c.code)).toEqual(["bbbbbbb", "aaaaaaa"]);
    const popular = await store.listShared({ sort: "popular", limit: 10, offset: 0 });
    expect(popular[0]).toMatchObject({ code: "aaaaaaa", times: 3, best: { ticks: 700 } });
    expect(popular[1]).toMatchObject({ code: "bbbbbbb", times: 1, author: null });
    expect(await store.setHidden("aaaaaaa", true)).toBe(true);
    expect((await store.getShared("aaaaaaa"))?.hidden).toBe(true);
    expect(
      (await store.listShared({ sort: "new", limit: 10, offset: 0 })).map((c) => c.code),
    ).toEqual(["bbbbbbb"]);
    const all = await store.listShared({ sort: "new", limit: 10, offset: 0, includeHidden: true });
    expect(all.find((c) => c.code === "aaaaaaa")?.hidden).toBe(true);
    expect(await store.setHidden("zzzzzzz", true)).toBe(false);
  });
});
