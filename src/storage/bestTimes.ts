// Best finishing times for shipped extra courses (custom levels keep theirs in IndexedDB).
import { defaultStorage, readJson, writeJson } from "./settings";

export const BEST_TIMES_KEY = "marble-melancholy.besttimes.v1";

/** Level id → best finishing time in ticks; malformed entries are dropped. */
export function loadBestTimes(storage: Storage = defaultStorage()): Record<string, number> {
  const raw = readJson(storage, BEST_TIMES_KEY);
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isInteger(v) && v > 0) out[id] = v;
  }
  return out;
}

export function bestTicksFor(id: string, storage: Storage = defaultStorage()): number | null {
  return loadBestTimes(storage)[id] ?? null;
}

/** Stores `ticks` when it beats the stored best (or there was none); returns true if it did. */
export function recordBestTime(
  id: string,
  ticks: number,
  storage: Storage = defaultStorage(),
): boolean {
  if (!Number.isInteger(ticks) || ticks <= 0) return false;
  const all = loadBestTimes(storage);
  const prev = all[id];
  if (prev !== undefined && prev <= ticks) return false;
  all[id] = ticks;
  writeJson(storage, BEST_TIMES_KEY, all);
  return true;
}
