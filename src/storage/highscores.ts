import { defaultStorage, readJson, writeJson } from "./settings";

export const HIGHSCORES_KEY = "marble-melancholy.highscores.v1";
export const TABLE_SIZE = 10;

export interface HighScoreEntry {
  initials: string;
  score: number;
  /** Races completed or reached, 1..6. */
  race: number;
  players: 1 | 2;
  /** ISO timestamp. */
  date: string;
}

const SEED_INITIALS = ["MEL", "GLM", "SAD", "BLU", "RNY", "SOB", "MOP", "DRZ", "SGH", "WOE"];
const SEED_DATE = "2026-01-01T00:00:00.000Z";

export function defaultTable(): HighScoreEntry[] {
  return SEED_INITIALS.map((initials, i) => ({
    initials,
    score: 20000 - i * 2000,
    race: Math.max(1, 6 - Math.floor(i / 2)),
    players: 1,
    date: SEED_DATE,
  }));
}

/** Uppercase, keep A–Z only, exactly 3 chars (padded with "A"). */
export function normalizeInitials(s: string): string {
  const letters = s
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
  return letters.padEnd(3, "A");
}

function sanitizeEntry(raw: unknown): HighScoreEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.score !== "number" || !Number.isFinite(o.score)) return null;
  const race = typeof o.race === "number" && Number.isFinite(o.race) ? Math.round(o.race) : 1;
  return {
    initials: normalizeInitials(typeof o.initials === "string" ? o.initials : ""),
    score: Math.max(0, Math.round(o.score)),
    race: Math.min(6, Math.max(1, race)),
    players: o.players === 2 ? 2 : 1,
    date: typeof o.date === "string" ? o.date : SEED_DATE,
  };
}

/** Stable descending sort, truncated to TABLE_SIZE. */
function normalizeTable(entries: HighScoreEntry[]): HighScoreEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.score - a.e.score || a.i - b.i)
    .slice(0, TABLE_SIZE)
    .map(({ e }) => e);
}

export function loadHighScores(storage: Storage = defaultStorage()): HighScoreEntry[] {
  const raw = readJson(storage, HIGHSCORES_KEY);
  if (!Array.isArray(raw)) return defaultTable();
  const entries = raw.map(sanitizeEntry).filter((e): e is HighScoreEntry => e !== null);
  if (entries.length === 0) return defaultTable();
  return normalizeTable(entries);
}

export function saveHighScores(t: HighScoreEntry[], storage: Storage = defaultStorage()): void {
  writeJson(storage, HIGHSCORES_KEY, normalizeTable(t.map((e) => ({ ...e }))));
}

/** A short table (fewer than TABLE_SIZE rows) accepts any positive score. */
export function qualifies(t: HighScoreEntry[], score: number): boolean {
  if (t.length < TABLE_SIZE) return score > 0;
  const last = t[TABLE_SIZE - 1];
  return last === undefined || score > last.score;
}

export function insertScore(
  t: HighScoreEntry[],
  e: HighScoreEntry,
): { table: HighScoreEntry[]; rank: number } {
  const table = t.map((x) => ({ ...x }));
  const entry: HighScoreEntry = { ...e, initials: normalizeInitials(e.initials) };
  if (!qualifies(table, entry.score)) return { table, rank: -1 };
  let rank = table.findIndex((x) => x.score < entry.score);
  if (rank === -1) rank = table.length;
  if (rank >= TABLE_SIZE) return { table, rank: -1 };
  table.splice(rank, 0, entry);
  return { table: table.slice(0, TABLE_SIZE), rank };
}
