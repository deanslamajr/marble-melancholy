// Score server entry (P15). Uses Cloud SQL when DB_HOST is set, otherwise an in-memory store.
import { createServer } from "node:http";
import pg from "pg";
import type { CompiledLevel } from "../src/level/types";
import { LevelLoader } from "../src/levels/loader";
import { createHandler } from "./app";
import { MemoryStore, PgStore, type Store } from "./store";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const env = process.env;
const pool = env.DB_HOST
  ? new pg.Pool({
      host: env.DB_HOST,
      port: Number(env.DB_PORT ?? 5432),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASS,
      // The shared db-f1-micro instance allows few connections; llmgag needs most of them.
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;
const store: Store = pool ? new PgStore(pool) : new MemoryStore();
await store.init();

let course: Promise<CompiledLevel[]> | null = null;
const handler = createHandler({
  store,
  course: () => (course ??= LevelLoader.loadCourse()),
  log,
});
const port = Number(env.PORT ?? 8080);
const server = createServer(handler).listen(port, () =>
  log(`marble api on :${port} (${pool ? "postgres" : "memory"})`),
);

process.on("SIGTERM", () => {
  server.close(() => void pool?.end().finally(() => process.exit(0)));
});
