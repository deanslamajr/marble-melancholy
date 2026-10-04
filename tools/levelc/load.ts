import { parse as parseYaml } from "yaml";
import { buildUnstamped } from "../../src/level/compile";
import { diag, type Diagnostic } from "../../src/level/diagnostics";
import { parseSource, type LayerLines } from "../../src/level/parse";
import { SolutionSourceSchema } from "../../src/level/schema";
import type {
  CompiledLevel,
  LevelSource,
  PlayableLevel,
  SolutionSource,
} from "../../src/level/types";
import { IoError, isCompiledFile, readJson, readText } from "./fs";

export type Loaded =
  | { kind: "source"; source: LevelSource; text: string; layerLines: LayerLines }
  | { kind: "compiled"; level: CompiledLevel };

export type LoadResult =
  { ok: true; file: Loaded } | { ok: false; diagnostics: Diagnostic[]; io: boolean };

export function loadFile(path: string): LoadResult {
  try {
    if (isCompiledFile(path) || path.endsWith(".json")) {
      const json = readJson(path) as CompiledLevel;
      if ((json as { format?: string }).format !== "mm-level/1") {
        return {
          ok: false,
          io: true,
          diagnostics: [diag("E021", `unsupported format in ${path}`)],
        };
      }
      return { ok: true, file: { kind: "compiled", level: json } };
    }
    const text = readText(path);
    const p = parseSource(text);
    if (!p.ok)
      return {
        ok: false,
        io: p.diagnostics.some((d) => d.code === "E000" || d.code === "E021"),
        diagnostics: p.diagnostics,
      };
    return { ok: true, file: { kind: "source", source: p.source, text, layerLines: p.layerLines } };
  } catch (e) {
    if (e instanceof IoError)
      return { ok: false, io: true, diagnostics: [diag("E000", e.message)] };
    throw e;
  }
}

export type PlayableResult =
  | { ok: true; level: PlayableLevel; solution: SolutionSource | null; par: number }
  | { ok: false; diagnostics: Diagnostic[]; code: number };

/** Prepare a level + solution spec for testplay / trace / path. */
export function loadPlayable(path: string, solutionOverride?: string): PlayableResult {
  const r = loadFile(path);
  if (!r.ok) return { ok: false, diagnostics: r.diagnostics, code: r.io ? 3 : 1 };
  let level: PlayableLevel;
  let solution: SolutionSource | null;
  if (r.file.kind === "compiled") {
    level = r.file.level;
    solution = {
      kind: "replay",
      runs: r.file.level.solution.runs,
      expectedTicks: r.file.level.solution.ticks,
    };
  } else {
    const b = buildUnstamped(r.file.source, r.file.layerLines);
    if (!b.ok) return { ok: false, diagnostics: b.diagnostics, code: 1 };
    level = b.level;
    solution = r.file.source.solution ?? null;
  }
  if (solutionOverride) {
    try {
      const raw = parseYaml(readText(solutionOverride)) as unknown;
      const obj = (raw as { solution?: unknown })?.solution ?? raw;
      const s = SolutionSourceSchema.safeParse(obj);
      if (!s.success) {
        return {
          ok: false,
          code: 3,
          diagnostics: [diag("E027", `invalid --solution file: ${s.error.issues[0]?.message}`)],
        };
      }
      solution = s.data as SolutionSource;
    } catch (e) {
      return { ok: false, code: 3, diagnostics: [diag("E000", (e as Error).message)] };
    }
  }
  return { ok: true, level, solution, par: level.timing.par };
}
