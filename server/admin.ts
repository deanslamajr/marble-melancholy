// Moderation for shared courses (P19). Runs inside the API pod, which holds the database settings:
//   npm run admin -- list [n] | hide <code> | unhide <code>
import { createPool } from "./db";
import { PgStore } from "./store";

/** Course names come from players; keep control characters out of the terminal. */
function clean(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");
}

const [cmd, arg] = process.argv.slice(2);
const pool = createPool(process.env, 1);
if (!pool) {
  console.error("DB_HOST is not set; run this inside the marble-api pod (npm run admin)");
  process.exit(1);
}
const store = new PgStore(pool);
try {
  if (cmd === "list") {
    const limit = Math.min(200, Math.max(1, Number(arg ?? 30) || 30));
    const rows = await store.listShared({ sort: "new", limit, offset: 0, includeHidden: true });
    for (const r of rows) {
      const flag = r.hidden ? "HIDDEN" : "      ";
      const by = r.author ? ` · ${clean(r.author)}` : "";
      console.log(
        `${r.code}  ${flag}  ${r.date.slice(0, 16)}  ${r.times} times  ${clean(r.name)}${by}`,
      );
    }
    if (rows.length === 0) console.log("no shared courses yet");
  } else if ((cmd === "hide" || cmd === "unhide") && arg) {
    const ok = await store.setHidden(arg, cmd === "hide");
    console.log(
      ok ? `${arg} is ${cmd === "hide" ? "hidden" : "visible again"}` : `no course has code ${arg}`,
    );
    if (!ok) process.exitCode = 1;
  } else {
    console.error("usage: admin.mjs list [n] | hide <code> | unhide <code>");
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
