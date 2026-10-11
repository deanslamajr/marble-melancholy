// Cloud SQL connection pool from the DB_* settings (Secret marble-db), or null without DB_HOST.
import pg from "pg";

export function createPool(env: NodeJS.ProcessEnv, max = 3): pg.Pool | null {
  if (!env.DB_HOST) return null;
  return new pg.Pool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASS,
    // The shared db-f1-micro instance allows few connections; llmgag needs most of them.
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
