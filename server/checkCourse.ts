// The publish gate for shared courses (P19): schema, limits and stamp like LevelLoader, and the
// embedded solution must still reach the goal, so every shared course can be finished.
import { formatDiagnostic } from "../src/level/diagnostics";
import type { CompiledLevel } from "../src/level/types";
import { verifyCompiled } from "../src/level/verify";

export async function checkCourse(json: unknown): Promise<CompiledLevel> {
  const report = await verifyCompiled(json, { replay: true });
  if (!report.ok) {
    const first = report.diagnostics[0];
    throw new Error(first ? formatDiagnostic(first, "course") : "course failed verification");
  }
  return json as CompiledLevel;
}
