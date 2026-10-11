// Opening shared courses (P19): fetch by code, check like any level, play with its board.
import type { GameController } from "../game/GameController";
import type { CompiledLevel } from "../level/types";
import { LevelLoader } from "../levels/loader";
import { fetchSharedCourse } from "../net/courses";
import { bestTicksFor, recordBestTime } from "../storage/bestTimes";
import { navigate } from "./router";

export const OFFLINE = "the course server cannot be reached; try again later";

/** The checked course, or why it cannot be played. */
export async function loadSharedCourse(code: string): Promise<CompiledLevel | { error: string }> {
  const r = await fetchSharedCourse(code);
  if (!r) return { error: OFFLINE };
  if ("error" in r) return r;
  try {
    return await LevelLoader.load(r.json);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Plays a shared course and returns to its card. Personal bests are keyed by content hash, since
 * courses from different players can share an id.
 */
export async function startSharedByCode(c: GameController, code: string): Promise<void> {
  const back = () => navigate({ name: "sharedCourse", code }, { replace: true });
  const level = await loadSharedCourse(code);
  if ("error" in level) return back();
  const hash = level.stamp.contentHash;
  c.startCustom(level, back, {
    label: "SHARED COURSE",
    recordBest: (_id, ticks) => recordBestTime(hash, ticks),
    bestTicks: bestTicksFor(hash),
    board: true,
  });
}
