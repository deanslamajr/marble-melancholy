// Best times from the shared boards for a list of courses (P17); null until (or unless) the
// server answers.
import { useEffect, useState } from "preact/hooks";
import { fetchBestTimes, type TimeEntry } from "../net/boards";
import { TICK_HZ } from "../sim/constants";

export function useBestTimes(contentHashes: readonly string[]): Record<string, TimeEntry> | null {
  const key = contentHashes.join(",");
  const [best, setBest] = useState<Record<string, TimeEntry> | null>(null);
  useEffect(() => {
    setBest(null);
    if (key === "") return;
    let alive = true;
    void fetchBestTimes(key.split(",")).then((b) => alive && setBest(b));
    return () => {
      alive = false;
    };
  }, [key]);
  return best;
}

/** "12.34s DHS", or a dash for a board without times. */
export function formatTop(e: TimeEntry | undefined): string {
  return e ? `${(e.ticks / TICK_HZ).toFixed(2)}s ${e.initials}` : "—";
}
