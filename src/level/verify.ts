// Compiled-level verification (§5.6): schema, stamp and embedded replay. Kept free of the YAML
// parser so the game bundle can load levels without it (D13).
import { TICK_HZ } from "../sim/constants";
import { runReplay } from "../sim/replayRunner";
import { diag, type Diagnostic } from "./diagnostics";
import { CompiledLevelSchema } from "./schema";
import { runsWellFormed } from "./solution/replay";
import { verifyStamp } from "./stamp";
import type { CompiledLevel } from "./types";

export interface VerifyReport {
  ok: boolean;
  level?: CompiledLevel;
  diagnostics: Diagnostic[];
}

/** Verify a compiled level: schema, stamp, and (optionally) the embedded replay. */
export async function verifyCompiled(
  json: unknown,
  opts: { replay?: boolean } = {},
): Promise<VerifyReport> {
  const fmt = (json as { format?: unknown } | null)?.format;
  if (fmt !== "mm-level/1") {
    return { ok: false, diagnostics: [diag("E021", `unsupported format ${JSON.stringify(fmt)}`)] };
  }
  if ((json as { stamp?: unknown }).stamp == null) {
    return {
      ok: false,
      diagnostics: [diag("E020", "stamp missing — only levels compiled by mmlevel can be loaded")],
    };
  }
  const parsed = CompiledLevelSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues
        .slice(0, 10)
        .map((i) => diag("E026", `${i.path.join(".") || "(root)"}: ${i.message}`)),
    };
  }
  const level = json as CompiledLevel;
  const W = level.grid.width;
  const H = level.grid.height;
  const n = W * H;
  for (const k of ["heights", "slopes", "surfaces", "walls", "progress"] as const) {
    if (level.cells[k].length !== n) {
      return {
        ok: false,
        diagnostics: [
          diag("E026", `cells.${k} has ${level.cells[k].length} entries; expected ${n}`),
        ],
      };
    }
  }
  if (!runsWellFormed(level.solution.runs)) {
    return {
      ok: false,
      diagnostics: [diag("E026", "solution.runs is not a list of valid [count, qx, qy] triples")],
    };
  }
  const st = await verifyStamp(level);
  if (!st.ok) return { ok: false, diagnostics: [diag("E020", `stamp invalid: ${st.reason}`)] };
  if (opts.replay !== false) {
    const r = runReplay(level, level.solution.runs, { extraTicks: 0 });
    if (!r.reached || r.ticks >= level.timing.timeLimit * TICK_HZ) {
      return {
        ok: false,
        diagnostics: [
          diag(
            "E019",
            `embedded replay does not reach the goal (ended ${r.end} at tick ${r.ticks})`,
          ),
        ],
      };
    }
    if (r.ticks !== level.solution.ticks || r.stateHash !== level.solution.stateHash) {
      return {
        ok: false,
        diagnostics: [
          diag(
            "E024",
            `replay desync: tick ${r.ticks} hash ${r.stateHash}; expected tick ${level.solution.ticks} hash ${level.solution.stateHash}`,
          ),
        ],
      };
    }
  }
  return { ok: true, level, diagnostics: [] };
}
