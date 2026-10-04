#!/usr/bin/env node
// mmlevel entry point: runs tools/levelc/cli.ts through tsx.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "cli.ts");
const r = spawnSync(process.execPath, ["--import", "tsx", cli, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 3);
