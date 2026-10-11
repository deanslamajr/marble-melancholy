// Client for shared courses (P19): share links with short codes and the public course list. Every
// call degrades to null when the API is unreachable.
import type { CompiledLevel } from "../level/types";
import { call } from "./api";
import type { TimeEntry } from "./boards";

/** Share codes: 7 characters without look-alikes (no 0/o, 1/l/i). */
export const SHARE_CODE = /^[2-9a-hjkmnp-z]{7}$/;
export const SHARE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export interface SharedSummary {
  code: string;
  name: string;
  author: string | null;
  par: number;
  contentHash: string;
  /** ISO timestamp of the first share. */
  date: string;
  /** Times on the course's board. */
  times: number;
  best: TimeEntry | null;
  /** Present only in moderation listings. */
  hidden?: boolean;
}

/** Uploading and replaying a course takes longer than a list read. */
const SHARE_TIMEOUT_MS = 30_000;

/** The page link that opens a shared course. */
export function shareUrl(code: string): string {
  if (typeof location === "undefined") return `#/c/${code}`;
  return `${location.origin}${location.pathname}#/c/${code}`;
}

/** Publishes a course; the server answers with its code (the same code for the same course). */
export async function shareCourse(
  level: CompiledLevel,
): Promise<{ code: string } | { error: string } | null> {
  const body = (await call(
    "courses",
    { method: "POST", body: JSON.stringify({ level }) },
    SHARE_TIMEOUT_MS,
  )) as { code?: unknown; error?: unknown } | null;
  if (!body) return null;
  if (typeof body.error === "string") return { error: body.error };
  return typeof body.code === "string" && SHARE_CODE.test(body.code) ? { code: body.code } : null;
}

const fetched = new Map<string, unknown>();

/** A shared course's JSON (still to be checked by LevelLoader), an error, or null offline. */
export async function fetchSharedCourse(
  code: string,
): Promise<{ json: unknown } | { error: string } | null> {
  const hit = fetched.get(code);
  if (hit !== undefined) return { json: hit };
  if (!SHARE_CODE.test(code)) return { error: "that is not a course code" };
  const body = (await call(`courses/${code}`)) as { level?: unknown; error?: unknown } | null;
  if (!body) return null;
  if (typeof body.error === "string") return { error: body.error };
  if (body.level === undefined) return null;
  fetched.set(code, body.level);
  return { json: body.level };
}

function isSummary(v: unknown): v is SharedSummary {
  const o = v as SharedSummary | null;
  return (
    !!o &&
    typeof o.code === "string" &&
    typeof o.name === "string" &&
    typeof o.par === "number" &&
    typeof o.contentHash === "string" &&
    typeof o.times === "number"
  );
}

export const PAGE_SIZE = 30;

export async function listSharedCourses(
  sort: "new" | "popular",
  offset = 0,
): Promise<{ courses: SharedSummary[]; more: boolean } | null> {
  const body = (await call(`courses?sort=${sort}&offset=${offset}`)) as {
    courses?: unknown;
    more?: unknown;
  } | null;
  if (!body || !Array.isArray(body.courses) || !body.courses.every(isSummary)) return null;
  return { courses: body.courses, more: body.more === true };
}
