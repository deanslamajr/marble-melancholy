// Storage for the score server (P15). PgStore runs against Cloud SQL; MemoryStore serves tests and
// local runs without a database.
import type pg from "pg";
import type { CourseRecording, RaceRecording } from "../src/game/courseRun";
import type { TimeEntry } from "../src/net/boards";
import type { HighScoreEntry } from "../src/storage/highscores";

export interface NewCampaignScore {
  initials: string;
  score: number;
  race: number;
  players: 1 | 2;
  player: number;
  complete: boolean;
  runHash: string;
  recording: CourseRecording;
  build: string | null;
}

export interface NewRaceTime {
  /** The course's content hash ("sha256:…"); it names the board (P17). */
  contentHash: string;
  initials: string;
  ticks: number;
  runHash: string;
  recording: RaceRecording;
  build: string | null;
}

export interface Store {
  init(): Promise<void>;
  ping(): Promise<boolean>;
  topCampaign(limit: number): Promise<HighScoreEntry[]>;
  /** Stores the score unless this run and player were stored before. Returns the 0-based place
   * of the stored entry in the top `limit`, or -1 when it falls outside. */
  addCampaign(s: NewCampaignScore, limit: number): Promise<{ index: number; duplicate: boolean }>;
  /** A stored course's JSON text, or null. */
  getLevel(contentHash: string): Promise<string | null>;
  /** Stores a course once; later calls for the same hash do nothing. */
  putLevel(contentHash: string, name: string, json: string): Promise<void>;
  /** Fastest first; ties keep the earlier entry ahead. */
  topTimes(contentHash: string, limit: number): Promise<TimeEntry[]>;
  /** The fastest entry of each listed board that has one. */
  bestTimes(contentHashes: readonly string[]): Promise<Record<string, TimeEntry>>;
  /** Stores the time unless this run was stored before; returns its place like addCampaign. */
  addTime(t: NewRaceTime, limit: number): Promise<{ index: number; duplicate: boolean }>;
}

interface Row extends HighScoreEntry {
  id: number;
  runHash: string;
  player: number;
}

/** Highest score first; ties keep the earlier entry ahead. */
function byRank(a: Row, b: Row): number {
  return b.score - a.score || a.id - b.id;
}

interface TimeRow extends TimeEntry {
  id: number;
  contentHash: string;
  runHash: string;
}

/** Fastest first; ties keep the earlier entry ahead. */
function byTime(a: TimeRow, b: TimeRow): number {
  return a.ticks - b.ticks || a.id - b.id;
}

function toTime(r: TimeEntry): TimeEntry {
  return { initials: r.initials, ticks: r.ticks, date: r.date };
}

export class MemoryStore implements Store {
  private rows: Row[] = [];
  private nextId = 1;
  private readonly levels = new Map<string, string>();
  private times: TimeRow[] = [];

  async init(): Promise<void> {}

  async ping(): Promise<boolean> {
    return true;
  }

  async topCampaign(limit: number): Promise<HighScoreEntry[]> {
    return [...this.rows].sort(byRank).slice(0, limit).map(toEntry);
  }

  async addCampaign(s: NewCampaignScore, limit: number) {
    const dup = this.rows.find((r) => r.runHash === s.runHash && r.player === s.player);
    const row = dup ?? {
      id: this.nextId++,
      runHash: s.runHash,
      player: s.player,
      initials: s.initials,
      score: s.score,
      race: s.race,
      players: s.players,
      date: new Date().toISOString(),
    };
    if (!dup) this.rows.push(row);
    const top = [...this.rows].sort(byRank).slice(0, limit);
    return { index: top.indexOf(row), duplicate: dup !== undefined };
  }

  async getLevel(contentHash: string): Promise<string | null> {
    return this.levels.get(contentHash) ?? null;
  }

  async putLevel(contentHash: string, _name: string, json: string): Promise<void> {
    if (!this.levels.has(contentHash)) this.levels.set(contentHash, json);
  }

  private board(contentHash: string): TimeRow[] {
    return this.times.filter((r) => r.contentHash === contentHash).sort(byTime);
  }

  async topTimes(contentHash: string, limit: number): Promise<TimeEntry[]> {
    return this.board(contentHash).slice(0, limit).map(toTime);
  }

  async bestTimes(contentHashes: readonly string[]): Promise<Record<string, TimeEntry>> {
    const out: Record<string, TimeEntry> = {};
    for (const h of contentHashes) {
      const best = this.board(h)[0];
      if (best) out[h] = toTime(best);
    }
    return out;
  }

  async addTime(t: NewRaceTime, limit: number) {
    if (!this.levels.has(t.contentHash)) throw new Error("unknown course");
    const dup = this.times.find((r) => r.runHash === t.runHash);
    const row = dup ?? {
      id: this.nextId++,
      contentHash: t.contentHash,
      runHash: t.runHash,
      initials: t.initials,
      ticks: t.ticks,
      date: new Date().toISOString(),
    };
    if (!dup) this.times.push(row);
    const top = this.board(t.contentHash).slice(0, limit);
    return { index: top.indexOf(row), duplicate: dup !== undefined };
  }
}

function toEntry(r: HighScoreEntry): HighScoreEntry {
  return { initials: r.initials, score: r.score, race: r.race, players: r.players, date: r.date };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaign_scores (
  id BIGSERIAL PRIMARY KEY,
  initials TEXT NOT NULL CHECK (initials ~ '^[A-Z]{3}$'),
  score INTEGER NOT NULL CHECK (score >= 0),
  race SMALLINT NOT NULL,
  players SMALLINT NOT NULL,
  player SMALLINT NOT NULL,
  complete BOOLEAN NOT NULL,
  run_hash TEXT NOT NULL,
  recording JSONB NOT NULL,
  build TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_hash, player)
);
CREATE INDEX IF NOT EXISTS campaign_scores_rank ON campaign_scores (score DESC, id ASC);
CREATE TABLE IF NOT EXISTS levels (
  content_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS race_times (
  id BIGSERIAL PRIMARY KEY,
  content_hash TEXT NOT NULL REFERENCES levels (content_hash),
  initials TEXT NOT NULL CHECK (initials ~ '^[A-Z]{3}$'),
  ticks INTEGER NOT NULL CHECK (ticks > 0),
  run_hash TEXT NOT NULL UNIQUE,
  recording JSONB NOT NULL,
  build TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS race_times_rank ON race_times (content_hash, ticks ASC, id ASC);
`;

function timeEntry(x: { initials: string; ticks: number; created_at: Date | string }): TimeEntry {
  return { initials: x.initials, ticks: x.ticks, date: new Date(x.created_at).toISOString() };
}

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async topCampaign(limit: number): Promise<HighScoreEntry[]> {
    const r = await this.pool.query(
      `SELECT initials, score, race, players, created_at FROM campaign_scores
       ORDER BY score DESC, id ASC LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => ({
      initials: x.initials,
      score: x.score,
      race: x.race,
      players: x.players,
      date: new Date(x.created_at).toISOString(),
    }));
  }

  async addCampaign(s: NewCampaignScore, limit: number) {
    const ins = await this.pool.query(
      `INSERT INTO campaign_scores
         (initials, score, race, players, player, complete, run_hash, recording, build)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (run_hash, player) DO NOTHING RETURNING id`,
      [
        s.initials,
        s.score,
        s.race,
        s.players,
        s.player,
        s.complete,
        s.runHash,
        JSON.stringify(s.recording),
        s.build,
      ],
    );
    const duplicate = ins.rowCount === 0;
    const id = duplicate
      ? (
          await this.pool.query(
            "SELECT id FROM campaign_scores WHERE run_hash = $1 AND player = $2",
            [s.runHash, s.player],
          )
        ).rows[0]?.id
      : ins.rows[0].id;
    const top = await this.pool.query(
      "SELECT id FROM campaign_scores ORDER BY score DESC, id ASC LIMIT $1",
      [limit],
    );
    return { index: top.rows.findIndex((x) => String(x.id) === String(id)), duplicate };
  }

  async getLevel(contentHash: string): Promise<string | null> {
    const r = await this.pool.query("SELECT level_json FROM levels WHERE content_hash = $1", [
      contentHash,
    ]);
    return r.rows[0]?.level_json ?? null;
  }

  async putLevel(contentHash: string, name: string, json: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO levels (content_hash, name, level_json) VALUES ($1, $2, $3)
       ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, name, json],
    );
  }

  async topTimes(contentHash: string, limit: number): Promise<TimeEntry[]> {
    const r = await this.pool.query(
      `SELECT initials, ticks, created_at FROM race_times WHERE content_hash = $1
       ORDER BY ticks ASC, id ASC LIMIT $2`,
      [contentHash, limit],
    );
    return r.rows.map(timeEntry);
  }

  async bestTimes(contentHashes: readonly string[]): Promise<Record<string, TimeEntry>> {
    if (contentHashes.length === 0) return {};
    const r = await this.pool.query(
      `SELECT DISTINCT ON (content_hash) content_hash, initials, ticks, created_at
       FROM race_times WHERE content_hash = ANY($1)
       ORDER BY content_hash, ticks ASC, id ASC`,
      [contentHashes],
    );
    const out: Record<string, TimeEntry> = {};
    for (const x of r.rows) out[x.content_hash] = timeEntry(x);
    return out;
  }

  async addTime(t: NewRaceTime, limit: number) {
    const ins = await this.pool.query(
      `INSERT INTO race_times (content_hash, initials, ticks, run_hash, recording, build)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_hash) DO NOTHING RETURNING id`,
      [t.contentHash, t.initials, t.ticks, t.runHash, JSON.stringify(t.recording), t.build],
    );
    const duplicate = ins.rowCount === 0;
    const id = duplicate
      ? (await this.pool.query("SELECT id FROM race_times WHERE run_hash = $1", [t.runHash]))
          .rows[0]?.id
      : ins.rows[0].id;
    const top = await this.pool.query(
      `SELECT id FROM race_times WHERE content_hash = $1 ORDER BY ticks ASC, id ASC LIMIT $2`,
      [t.contentHash, limit],
    );
    return { index: top.rows.findIndex((x) => String(x.id) === String(id)), duplicate };
  }
}
