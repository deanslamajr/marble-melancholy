import type { Cell } from "./types";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  cell: Cell | null;
  entityIndex: number | null;
  layer: string | null;
  line: number | null;
  col: number | null;
}

/** Every diagnostic code (§6.5 plus DECISIONS additions E000, E026, E027). */
export const CODES: Record<string, string> = {
  E000: "YAML syntax error",
  E001: "grid size out of range or too many cells",
  E002: "layer has wrong row count or row width",
  E003: "invalid character in layer",
  E004: "slope, surface or wall on a void cell",
  E005: "start cell void, acid, or inside a hazard",
  E006: "goal void or acid, or radius out of range",
  E007: "start equals goal, or p1 equals p2",
  E008: "goal unreachable",
  E009: "entity needs ground",
  E010: "entity footprints overlap",
  E011: "entity parameter out of range",
  E012: "unknown entity type or parameter",
  E013: "pipe/funnel/catapult landing void",
  E014: "checkpoint respawn cell void or acid",
  E015: "timing out of range",
  E016: "id, name or author invalid",
  E017: "too many entities or checkpoints",
  E018: "no solution",
  E019: "solution fails",
  E020: "stamp missing or invalid",
  E021: "unsupported format",
  E022: "physics override out of range",
  E023: "course slot invalid or duplicated",
  E024: "replay desync",
  E025: "invalid theme colour or unknown theme/music",
  E026: "compiled file fails schema",
  E027: "malformed field",
  W101: "unreachable cells",
  W102: "solution slower than par",
  W103: "par above 80% of time limit",
  W104: "slope low edge meets a higher neighbour",
  W105: "fatal ledge next to the solution path",
  W106: "entity never interacts",
};

export function diag(
  code: string,
  message: string,
  extra: Partial<Pick<Diagnostic, "cell" | "entityIndex" | "layer" | "line" | "col">> = {},
): Diagnostic {
  return {
    code,
    severity: code.startsWith("W") ? "warning" : "error",
    message,
    cell: extra.cell ?? null,
    entityIndex: extra.entityIndex ?? null,
    layer: extra.layer ?? null,
    line: extra.line ?? null,
    col: extra.col ?? null,
  };
}

export function isError(d: Diagnostic): boolean {
  return d.severity === "error";
}

/** Human format: `<file>:<row>:<col>: <severity> <CODE>: <message>` (§6.3). */
export function formatDiagnostic(d: Diagnostic, file: string): string {
  let loc = file;
  if (d.line !== null) loc += `:${d.line}${d.col !== null ? `:${d.col}` : ""}`;
  else if (d.cell) loc += `:(${d.cell[0]},${d.cell[1]})`;
  return `${loc}: ${d.severity} ${d.code}: ${d.message}`;
}

export function diagnosticJson(d: Diagnostic, file: string): string {
  return JSON.stringify({
    code: d.code,
    severity: d.severity,
    message: d.message,
    file,
    cell: d.cell,
    entityIndex: d.entityIndex,
    layer: d.layer,
    line: d.line,
  });
}
