import { useEffect, useMemo, useState } from "preact/hooks";
import { navigate } from "../../app/router";
import { extraIds, loadRawLevel } from "../../levels/manifest";
import { TICK_HZ } from "../../sim/constants";
import { loadBestTimes } from "../../storage/bestTimes";
import { PixelText } from "./PixelText";

export type ExtraTier = "EASY" | "MEDIUM" | "HARD";

/** Difficulty tags for the shipped extra courses; courses without one show none. */
export const EXTRA_TIER: Readonly<Record<string, ExtraTier>> = {
  "puddle-hop": "EASY",
  "ice-rink-blues": "EASY",
  "tea-kettle": "EASY",
  "rainy-day-ferry": "MEDIUM",
  "clocktower-steps": "MEDIUM",
  "acid-garden": "MEDIUM",
  "catapult-canyon": "HARD",
  "grey-gauntlet": "HARD",
};

/** Courses with a par this short are tagged as quick (phone-sized) runs. */
export const QUICK_PAR = 15;

interface Row {
  id: string;
  name: string;
  par: number;
}

async function loadRows(): Promise<Row[]> {
  const ids = extraIds();
  const raws = await Promise.all(ids.map((id) => loadRawLevel(id)));
  return ids.flatMap((id, i) => {
    const raw = raws[i] as { name?: unknown; timing?: { par?: unknown } } | undefined;
    if (!raw) return [];
    const par = typeof raw.timing?.par === "number" ? raw.timing.par : 0;
    return [{ id, name: typeof raw.name === "string" ? raw.name : id, par }];
  });
}

export function ExtraCourses() {
  const [list, setList] = useState<Row[] | null>(null);
  const best = useMemo(() => loadBestTimes(), []);

  useEffect(() => {
    let alive = true;
    void loadRows().then((r) => alive && setList(r));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate({ name: "title" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="overlay panel-screen" data-testid="extra-courses">
      <PixelText size="l">EXTRA COURSES</PixelText>
      <PixelText size="s" tone="dim">
        Single races outside the main course. Beat your best time.
      </PixelText>
      <div class="list">
        {list === null && (
          <PixelText size="s" tone="dim">
            loading…
          </PixelText>
        )}
        {list?.map((r) => {
          const b = best[r.id];
          const tier = EXTRA_TIER[r.id];
          return (
            <div class="list-row" key={r.id} data-testid="extra-row">
              <span class="name">{r.name}</span>
              {tier && <span class={`meta tier tier-${tier.toLowerCase()}`}>{tier}</span>}
              {r.par <= QUICK_PAR && <span class="meta quick">QUICK</span>}
              <span class="meta">par {r.par}s</span>
              <span class="meta">
                best {b === undefined ? "—" : `${(b / TICK_HZ).toFixed(2)}s`}
              </span>
              <button
                type="button"
                class="btn small"
                onClick={() => navigate({ name: "playExtra", id: r.id })}
              >
                PLAY
              </button>
            </div>
          );
        })}
      </div>
      <div class="row-buttons">
        <button type="button" class="btn" onClick={() => navigate({ name: "generate" })}>
          GENERATE COURSE
        </button>
        <button
          type="button"
          class="btn ghost"
          data-testid="extras-back"
          onClick={() => navigate({ name: "title" })}
        >
          BACK
        </button>
      </div>
    </div>
  );
}
