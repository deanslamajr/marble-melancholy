// Client for the shared best-time boards of single races (P17). A board is named by its course's
// content hash, so every copy of a course (shipped, generated from the same seed, or imported)
// shares one board. Every call degrades to null when the API is unreachable.
import type { RaceRecording } from "../game/courseRun";
import type { CompiledLevel } from "../level/types";
import { call } from "./api";

export interface TimeEntry {
  initials: string;
  ticks: number;
  /** ISO timestamp. */
  date: string;
}

export const BOARD_SIZE = 10;
/** Uploading a course and replaying the run takes longer than a table read. */
const SUBMIT_TIMEOUT_MS = 30_000;

/** The board's URL key: the hex digits of a "sha256:…" content hash, or null. */
export function boardKey(contentHash: string): string | null {
  const m = /^sha256:([0-9a-f]{64})$/.exec(contentHash);
  return m ? m[1]! : null;
}

/** A short board accepts any time; a full one only a time faster than its last entry. */
export function qualifiesTime(table: readonly TimeEntry[], ticks: number): boolean {
  if (table.length < BOARD_SIZE) return true;
  return ticks < table[BOARD_SIZE - 1]!.ticks;
}

function isEntry(r: unknown): r is TimeEntry {
  const o = r as TimeEntry | null;
  return (
    !!o &&
    typeof o.initials === "string" &&
    Number.isInteger(o.ticks) &&
    o.ticks > 0 &&
    typeof o.date === "string"
  );
}

function isTimes(v: unknown): v is TimeEntry[] {
  return Array.isArray(v) && v.every(isEntry);
}

export async function fetchBoard(contentHash: string): Promise<TimeEntry[] | null> {
  const key = boardKey(contentHash);
  if (!key) return null;
  const body = (await call(`boards/${key}`)) as { table?: unknown } | null;
  return body && isTimes(body.table) ? body.table : null;
}

/** The fastest entry of each course that has one, keyed by content hash. */
export async function fetchBestTimes(
  contentHashes: readonly string[],
): Promise<Record<string, TimeEntry> | null> {
  const keys = contentHashes.map(boardKey).filter((k): k is string => k !== null);
  if (keys.length === 0) return {};
  const body = (await call(`boards?h=${keys.join(",")}`)) as { best?: unknown } | null;
  if (!body || !body.best || typeof body.best !== "object") return null;
  const out: Record<string, TimeEntry> = {};
  for (const [k, v] of Object.entries(body.best as Record<string, unknown>)) {
    if (isEntry(v)) out[`sha256:${k}`] = v;
  }
  return out;
}

export interface TimeSubmitResult {
  ticks: number;
  /** 0-based place of the new entry in `table`, or -1. */
  index: number;
  table: TimeEntry[];
}

/**
 * Sends a finished race; the server replays it and answers with the board. The course is sent
 * only when the server does not have it yet.
 */
export async function submitTime(
  level: CompiledLevel,
  initials: string,
  race: RaceRecording,
  build: string,
): Promise<TimeSubmitResult | { error: string } | null> {
  const key = boardKey(level.stamp.contentHash);
  if (!key) return null;
  const send = (withLevel: boolean) =>
    call(
      `boards/${key}`,
      {
        method: "POST",
        body: JSON.stringify({ initials, race, build, ...(withLevel ? { level } : {}) }),
      },
      SUBMIT_TIMEOUT_MS,
    ) as Promise<(Partial<TimeSubmitResult> & { error?: unknown; needLevel?: unknown }) | null>;
  let body = await send(false);
  if (body?.needLevel === true) body = await send(true);
  if (!body) return null;
  if (typeof body.error === "string") return { error: body.error };
  if (!isTimes(body.table) || typeof body.index !== "number") return null;
  return { ticks: Number(body.ticks), index: body.index, table: body.table };
}
