import { diagnosticJson, formatDiagnostic, type Diagnostic } from "../../src/level/diagnostics";

export interface OutOpts {
  json?: boolean;
  quiet?: boolean;
  color?: boolean;
}

const useColor = (o: OutOpts) => o.color !== false && process.stdout.isTTY && !o.json;

function paint(o: OutOpts, code: number, s: string): string {
  return useColor(o) ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export function printDiagnostics(diags: readonly Diagnostic[], file: string, o: OutOpts): void {
  for (const d of diags) {
    if (o.json) console.log(diagnosticJson(d, file));
    else console.log(paint(o, d.severity === "error" ? 31 : 33, formatDiagnostic(d, file)));
  }
  const errors = diags.filter((d) => d.severity === "error");
  if (errors.length > 0 && !o.json) {
    console.error(`${file}: ${errors.length} error(s): ${errors.map((e) => e.code).join(", ")}`);
  }
}

export function printLine(o: OutOpts, human: string, json?: Record<string, unknown>): void {
  if (o.json) {
    if (json) console.log(JSON.stringify(json));
  } else if (!o.quiet) {
    console.log(human);
  }
}

export function ok(o: OutOpts, s: string): string {
  return paint(o, 32, s);
}

export function fail(o: OutOpts, s: string): string {
  return paint(o, 31, s);
}
