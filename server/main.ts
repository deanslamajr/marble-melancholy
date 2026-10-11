// Score server entry (P15). Uses Cloud SQL when DB_HOST is set, otherwise an in-memory store.
import { createServer } from "node:http";
import type { CompiledLevel } from "../src/level/types";
import { LevelLoader } from "../src/levels/loader";
import { createHandler } from "./app";
import { checkCourse } from "./checkCourse";
import { createPool } from "./db";
import { MemoryStore, PgStore, type Store } from "./store";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const env = process.env;
const pool = createPool(env);
const store: Store = pool ? new PgStore(pool) : new MemoryStore();
await store.init();

let course: Promise<CompiledLevel[]> | null = null;
const handler = createHandler({
  store,
  course: () => (course ??= LevelLoader.loadCourse()),
  loadLevel: (json) => LevelLoader.load(json),
  checkCourse,
  log,
});
const port = Number(env.PORT ?? 8080);
const server = createServer(handler).listen(port, () =>
  log(`marble api on :${port} (${pool ? "postgres" : "memory"})`),
);

process.on("SIGTERM", () => {
  server.close(() => void pool?.end().finally(() => process.exit(0)));
});
