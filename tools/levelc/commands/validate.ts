import { validateSource } from "../../../src/level/validate";
import { display, expandInputs, isSourceFile } from "../fs";
import { printDiagnostics, printLine, type OutOpts } from "../format";
import { loadFile } from "../load";

export interface ValidateOpts extends OutOpts {
  warningsAsErrors?: boolean;
}

export async function validateCommand(srcs: string[], o: ValidateOpts): Promise<number> {
  const files = expandInputs(srcs, isSourceFile);
  let code = 0;
  for (const f of files) {
    const shown = display(f);
    const r = loadFile(f);
    if (!r.ok) {
      printDiagnostics(r.diagnostics, shown, o);
      code = Math.max(code, r.io ? 3 : 1);
      continue;
    }
    if (r.file.kind !== "source") {
      printLine(o, `${shown}: not a source file`, { file: shown, error: "not a source" });
      code = Math.max(code, 3);
      continue;
    }
    const rep = validateSource(r.file.source, r.file.layerLines);
    printDiagnostics([...rep.errors, ...rep.warnings], shown, o);
    const failed = rep.errors.length > 0 || (o.warningsAsErrors && rep.warnings.length > 0);
    if (failed) code = Math.max(code, 1);
    else printLine(o, `${shown}: OK (${rep.warnings.length} warnings)`, { file: shown, ok: true, warnings: rep.warnings.length });
  }
  return code;
}
