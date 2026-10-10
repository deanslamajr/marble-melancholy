// The last initials a player entered on this device, offered first next time (P17).
import { normalizeInitials } from "./highscores";
import { defaultStorage, readJson, writeJson } from "./settings";

export const INITIALS_KEY = "marble-melancholy.initials.v1";

export function loadInitials(storage: Storage = defaultStorage()): string | null {
  const v = readJson(storage, INITIALS_KEY);
  return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null;
}

export function saveInitials(initials: string, storage: Storage = defaultStorage()): void {
  writeJson(storage, INITIALS_KEY, normalizeInitials(initials));
}
