// HTTP handler for the score server (P15). Every submitted score is re-earned by replaying its
// recording; the client's own numbers are never trusted.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { verifyCourseRun, type CourseRecording } from "../src/game/courseRun";
import type { CompiledLevel } from "../src/level/types";
import { normalizeInitials } from "../src/storage/highscores";
import type { Store } from "./store";

export const TABLE_SIZE = 10;
const MAX_BODY = 2 * 1024 * 1024;
const POSTS_PER_WINDOW = 30;
const WINDOW_MS = 10 * 60 * 1000;

const Submission = z.object({
  initials: z.string().max(8),
  player: z.number().int().min(0).max(1),
  build: z.string().max(40).optional(),
  recording: z.object({
    version: z.literal(1),
    players: z.union([z.literal(1), z.literal(2)]),
    races: z
      .array(
        z.object({
          contentHash: z.string().max(100),
          ticks: z.number().int(),
          inputs: z.array(z.string().max(500_000)).min(1).max(2),
        }),
      )
      .min(1)
      .max(6),
  }),
});

export interface AppDeps {
  store: Store;
  /** The current six-race course, in order. */
  course: () => Promise<CompiledLevel[]>;
  log?: (msg: string) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createHandler(deps: AppDeps) {
  const log = deps.log ?? (() => {});
  const posts = new Map<string, { n: number; until: number }>();

  function rateLimit(req: IncomingMessage): void {
    const fwd = req.headers["x-forwarded-for"];
    const ip =
      (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim() ?? req.socket.remoteAddress;
    const key = ip ?? "unknown";
    const now = Date.now();
    const slot = posts.get(key);
    if (!slot || slot.until < now) {
      posts.set(key, { n: 1, until: now + WINDOW_MS });
      return;
    }
    if (++slot.n > POSTS_PER_WINDOW) throw new HttpError(429, "too many submissions; try later");
  }

  async function submitCampaign(body: unknown) {
    const parsed = Submission.safeParse(body);
    if (!parsed.success) throw new HttpError(400, "malformed submission");
    const { initials, player, build, recording } = parsed.data;
    if (player >= recording.players) throw new HttpError(400, "no such player");
    const verdict = verifyCourseRun(await deps.course(), recording as CourseRecording);
    if (!verdict.ok) throw new HttpError(422, verdict.error);
    const score = verdict.scores[player]!;
    if (score <= 0) throw new HttpError(422, "a score must be above zero");
    const runHash = createHash("sha256").update(JSON.stringify(recording)).digest("hex");
    const stored = await deps.store.addCampaign(
      {
        initials: normalizeInitials(initials),
        score,
        race: verdict.reached[player]!,
        players: recording.players,
        player,
        complete: verdict.complete,
        runHash,
        recording: recording as CourseRecording,
        build: build ?? null,
      },
      TABLE_SIZE,
    );
    log(`campaign score ${score} (${recording.players}P, player ${player + 1})`);
    return {
      score,
      race: verdict.reached[player]!,
      index: stored.index,
      table: await deps.store.topCampaign(TABLE_SIZE),
    };
  }

  async function route(req: IncomingMessage): Promise<unknown> {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path === "/api/health") {
      return { ok: true, db: await deps.store.ping() };
    }
    if (path === "/api/scores/campaign") {
      if (req.method === "GET") return { table: await deps.store.topCampaign(TABLE_SIZE) };
      if (req.method === "POST") {
        rateLimit(req);
        return submitCampaign(await readJson(req));
      }
      throw new HttpError(405, "method not allowed");
    }
    throw new HttpError(404, "not found");
  }

  return (req: IncomingMessage, res: ServerResponse): void => {
    route(req)
      .then((body) => send(res, 200, body))
      .catch((e: unknown) => {
        if (e instanceof HttpError) return send(res, e.status, { error: e.message });
        log(`error: ${(e as Error).stack ?? String(e)}`);
        send(res, 500, { error: "server error" });
      });
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "submission too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
