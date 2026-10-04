// Export/import of levels (§6.2, D35): YAML source, compiled JSON, clipboard and downloads.
import { compileLevel, decompileToSource, verifyCompiled } from "../../level/compile";
import { formatDiagnostic, type Diagnostic } from "../../level/diagnostics";
import { parseSource } from "../../level/parse";
import { serializeSource } from "../../level/serialize";
import type { CompiledLevel, LevelSource } from "../../level/types";

export type ImportResult =
  | { kind: "compiled"; level: CompiledLevel }
  | { kind: "source"; source: LevelSource; compiled: CompiledLevel | null }
  | { kind: "error"; message: string; diagnostics: Diagnostic[] };

function looksLikeJson(text: string, filename?: string): boolean {
  if (filename && /\.json$/i.test(filename)) return true;
  if (filename && /\.ya?ml$/i.test(filename)) return false;
  return text.trimStart().startsWith("{");
}

export async function importText(text: string, filename?: string): Promise<ImportResult> {
  if (looksLikeJson(text, filename)) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { kind: "error", message: `not valid JSON: ${(e as Error).message}`, diagnostics: [] };
    }
    const report = await verifyCompiled(json, { replay: true });
    if (!report.ok) {
      return {
        kind: "error",
        message: describe(report.diagnostics),
        diagnostics: report.diagnostics,
      };
    }
    return { kind: "compiled", level: json as CompiledLevel };
  }
  const p = parseSource(text);
  if (!p.ok) return { kind: "error", message: describe(p.diagnostics), diagnostics: p.diagnostics };
  let compiled: CompiledLevel | null = null;
  if (p.source.solution) {
    const r = await compileLevel(p.source, { layerLines: p.layerLines });
    if (r.ok && "level" in r) compiled = r.level;
  }
  return { kind: "source", source: p.source, compiled };
}

export function describe(diags: readonly Diagnostic[]): string {
  const errs = diags.filter((d) => d.severity === "error");
  const first = errs[0] ?? diags[0];
  if (!first) return "unknown error";
  const more = errs.length > 1 ? ` (+${errs.length - 1} more)` : "";
  return formatDiagnostic(first, "level") + more;
}

export async function exportCompiled(
  source: LevelSource,
): Promise<
  { ok: true; level: CompiledLevel; json: string } | { ok: false; diagnostics: Diagnostic[] }
> {
  const r = await compileLevel(source);
  if (!r.ok) return { ok: false, diagnostics: r.diagnostics };
  if (!("level" in r)) return { ok: false, diagnostics: r.diagnostics };
  return { ok: true, level: r.level, json: `${JSON.stringify(r.level, null, 2)}\n` };
}

export function exportYaml(source: LevelSource): string {
  return serializeSource(source);
}

export function sourceFromCompiled(level: CompiledLevel): LevelSource {
  return decompileToSource(level);
}

export { copyText, downloadText, pickFile } from "../../app/files";
