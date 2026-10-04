import { basename, join } from "node:path";
import { compileLevel } from "../../../src/level/compile";
import { defaultOutDir, display, expandInputs, isSourceFile, writeJson } from "../fs";
import { printDiagnostics, printLine, type OutOpts } from "../format";
import { loadFile } from "../load";

export interface CompileOpts extends OutOpts {
  out?: string;
  allowUnsolved?: boolean;
}

export interface CompileOutcome {
  code: number;
  id?: string;
  outPath?: string;
  slot?: number;
}

/** Compile one source file; writes `<out>/<id>.level.json` on success. */
export async function compileOne(path: string, o: CompileOpts, outDir?: string): Promise<CompileOutcome> {
  const shown = display(path);
  const r = loadFile(path);
  if (!r.ok) {
    printDiagnostics(r.diagnostics, shown, o);
    return { code: r.io ? 3 : 1 };
  }
  if (r.file.kind !== "source") {
    printLine(o, `${shown}: not a .level.yaml source`, { file: shown, error: "not a source" });
    return { code: 3 };
  }
  const { source, text, layerLines } = r.file;
  const res = await compileLevel(source, { sourceText: text, layerLines, allowUnsolved: o.allowUnsolved });
  if (!res.ok) {
    printDiagnostics(res.diagnostics, shown, o);
    const solveFail = res.diagnostics.some((d) => d.code === "E018" || d.code === "E019");
    return { code: solveFail && !res.diagnostics.some((d) => d.severity === "error" && d.code !== "E018" && d.code !== "E019") ? 2 : 1 };
  }
  printDiagnostics(res.warnings, shown, o);
  if ("draft" in res) {
    printDiagnostics(res.diagnostics, shown, o);
    printLine(o, `${shown}: draft OK (not written; --allow-unsolved)`, { file: shown, draft: true });
    return { code: 0, id: source.id };
  }
  const dir = outDir ?? o.out ?? defaultOutDir(path);
  const outPath = join(dir, `${res.level.id}.level.json`);
  writeJson(outPath, res.level);
  const s = res.level.solution;
  printLine(
    o,
    `${shown} → ${display(outPath)}  GOAL tick=${s.ticks} time=${(s.ticks / 120).toFixed(2)}s deaths=${s.deaths} par=${res.level.timing.par} hash=${s.stateHash}`,
    { file: shown, out: display(outPath), id: res.level.id, ticks: s.ticks, deaths: s.deaths, stateHash: s.stateHash },
  );
  return { code: 0, id: res.level.id, outPath, slot: res.level.course?.slot };
}

export async function compileCommand(srcs: string[], o: CompileOpts): Promise<number> {
  const files = expandInputs(srcs, isSourceFile, ["invalid"]);
  let code = 0;
  for (const f of files) {
    const r = await compileOne(f, o);
    code = Math.max(code, r.code);
  }
  if (files.length === 0) {
    console.error(`no sources matched: ${srcs.map((s) => basename(s)).join(" ")}`);
    return 3;
  }
  return code;
}
