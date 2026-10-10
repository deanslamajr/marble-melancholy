// Client for the global high-score table (P15). Every call degrades to null when the API is
// unreachable, so the game keeps its local table offline and in development.
import type { CourseRecording } from "../game/courseRun";
import type { HighScoreEntry } from "../storage/highscores";

const TIMEOUT_MS = 8000;

export interface CampaignSubmitResult {
  score: number;
  race: number;
  /** 0-based place of the new entry in `table`, or -1. */
  index: number;
  table: HighScoreEntry[];
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  if (typeof fetch !== "function" || typeof document === "undefined") return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(`api/${path}`, document.baseURI), {
      ...init,
      signal: ctl.signal,
      headers: { "content-type": "application/json" },
    });
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isTable(v: unknown): v is HighScoreEntry[] {
  return (
    Array.isArray(v) &&
    v.every(
      (r) =>
        r &&
        typeof r.initials === "string" &&
        typeof r.score === "number" &&
        typeof r.race === "number" &&
        (r.players === 1 || r.players === 2),
    )
  );
}

export async function fetchCampaignTable(): Promise<HighScoreEntry[] | null> {
  const body = (await call("scores/campaign")) as { table?: unknown } | null;
  return body && isTable(body.table) ? body.table : null;
}

/** Sends a finished course run; the server replays it and answers with the global table. */
export async function submitCampaignScore(
  initials: string,
  player: number,
  recording: CourseRecording,
  build: string,
): Promise<CampaignSubmitResult | { error: string } | null> {
  const body = (await call("scores/campaign", {
    method: "POST",
    body: JSON.stringify({ initials, player, recording, build }),
  })) as Partial<CampaignSubmitResult> & { error?: unknown };
  if (!body) return null;
  if (typeof body.error === "string") return { error: body.error };
  if (!isTable(body.table) || typeof body.index !== "number") return null;
  return {
    score: Number(body.score),
    race: Number(body.race),
    index: body.index,
    table: body.table,
  };
}
