// Storage for the score server (P15). PgStore runs against Cloud SQL; MemoryStore serves tests and
// local runs without a database.
import type pg from "pg";
import type { CourseRecording } from "../src/game/courseRun";
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

export interface Store {
  init(): Promise<void>;
  ping(): Promise<boolean>;
  topCampaign(limit: number): Promise<HighScoreEntry[]>;
  /** Stores the score unless this run and player were stored before. Returns the 0-based place
   * of the stored entry in the top `limit`, or -1 when it falls outside. */
  addCampaign(s: NewCampaignScore, limit: number): Promise<{ index: number; duplicate: boolean }>;
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

export class MemoryStore implements Store {
  private rows: Row[] = [];
  private nextId = 1;

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
`;

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
}
