import type { CompiledLevel, LevelSource } from "../level/types";
import { idbDelete, idbGet, idbList, idbPut } from "./idb";

export interface CustomLevelRecord {
  id: string;
  level: CompiledLevel;
  addedAt: number;
  bestTicks: number | null;
}

export interface DraftRecord {
  /** Draft id (see newDraftId), independent of `source.id`. */
  id: string;
  name: string;
  source: LevelSource;
  modifiedAt: number;
  solved: boolean;
  gridW: number;
  gridH: number;
}

const NAME_MAX = 24;
const ID_MAX = 48;

// ---------- custom (compiled) levels ----------

/** Newest first. */
export async function listCustomLevels(): Promise<CustomLevelRecord[]> {
  const all = await idbList<CustomLevelRecord>("levels");
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

export function getCustomLevel(id: string): Promise<CustomLevelRecord | undefined> {
  return idbGet<CustomLevelRecord>("levels", id);
}

/** Stores an already-verified level; keeps `addedAt` and `bestTicks` of an existing record. */
export async function putCustomLevel(level: CompiledLevel): Promise<CustomLevelRecord> {
  const existing = await getCustomLevel(level.id);
  const rec: CustomLevelRecord = {
    id: level.id,
    level,
    addedAt: existing?.addedAt ?? Date.now(),
    bestTicks: existing?.bestTicks ?? null,
  };
  await idbPut("levels", rec);
  return rec;
}

export function deleteCustomLevel(id: string): Promise<void> {
  return idbDelete("levels", id);
}

/** Returns true when `ticks` beats the stored best (or there was none). */
export async function recordBestTicks(id: string, ticks: number): Promise<boolean> {
  const rec = await getCustomLevel(id);
  if (!rec) return false;
  if (rec.bestTicks !== null && rec.bestTicks <= ticks) return false;
  await idbPut("levels", { ...rec, bestTicks: ticks });
  return true;
}

// ---------- builder drafts ----------

export function newDraftId(): string {
  const rand = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `d-${Date.now().toString(36)}${rand}`;
}

/** Most recently modified first. */
export async function listDrafts(): Promise<DraftRecord[]> {
  const all = await idbList<DraftRecord>("drafts");
  return all.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function getDraft(id: string): Promise<DraftRecord | undefined> {
  return idbGet<DraftRecord>("drafts", id);
}

export async function saveDraft(
  d: Omit<DraftRecord, "modifiedAt"> & { modifiedAt?: number },
): Promise<DraftRecord> {
  const rec: DraftRecord = { ...d, modifiedAt: d.modifiedAt ?? Date.now() };
  await idbPut("drafts", rec);
  return rec;
}

export function deleteDraft(id: string): Promise<void> {
  return idbDelete("drafts", id);
}

function copyLevelId(base: string, taken: Set<string>): string {
  const stem = base.replace(/-copy\d*$/, "");
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "-copy" : `-copy${n}`;
    const id = stem.slice(0, ID_MAX - suffix.length) + suffix;
    if (!taken.has(id)) return id;
  }
}

/** New draft id, "<name> copy" name, and a fresh `source.id` so both can coexist as levels. */
export async function duplicateDraft(id: string): Promise<DraftRecord> {
  const orig = await getDraft(id);
  if (!orig) throw new Error(`Draft not found: ${id}`);
  const drafts = await listDrafts();
  const taken = new Set(drafts.map((d) => d.source.id));
  const name = `${orig.name} copy`.slice(0, NAME_MAX);
  const source: LevelSource = {
    ...structuredClone(orig.source),
    id: copyLevelId(orig.source.id, taken),
    name,
  };
  return saveDraft({ ...orig, id: newDraftId(), name, source, modifiedAt: undefined });
}
