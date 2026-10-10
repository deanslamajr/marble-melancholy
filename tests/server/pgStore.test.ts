// Runs only with TEST_DATABASE_URL, e.g. against `docker run -e POSTGRES_PASSWORD=x -p 5433:5432
// postgres:17-alpine`. The table is dropped first, so never point it at a real database.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PgStore, type NewCampaignScore } from "../../server/store";

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
    await pool.query("DROP TABLE IF EXISTS campaign_scores");
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
});
