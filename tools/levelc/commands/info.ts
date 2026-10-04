import { buildUnstamped } from "../../../src/level/compile";
import { runsLength } from "../../../src/level/solution/replay";
import type { PlayableLevel } from "../../../src/level/types";
import { display } from "../fs";
import { printDiagnostics, printLine, type OutOpts } from "../format";
import { loadFile } from "../load";

export async function infoCommand(file: string, o: OutOpts): Promise<number> {
  const shown = display(file);
  const r = loadFile(file);
  if (!r.ok) {
    printDiagnostics(r.diagnostics, shown, o);
    return 3;
  }
  let level: PlayableLevel;
  let solution: { ticks: number; length: number; deaths: number } | null = null;
  let stamp: unknown = null;
  if (r.file.kind === "compiled") {
    level = r.file.level;
    const s = r.file.level.solution;
    solution = { ticks: s.ticks, length: runsLength(s.runs), deaths: s.deaths };
    stamp = r.file.level.stamp;
  } else {
    const b = buildUnstamped(r.file.source, r.file.layerLines);
    if (!b.ok) {
      printDiagnostics(b.diagnostics, shown, o);
      return 3;
    }
    level = b.level;
  }
  const cells = level.cells.heights.filter((h) => h >= 0).length;
  const byType: Record<string, number> = {};
  for (const e of level.entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const info = {
    id: level.id,
    name: level.name,
    author: level.author,
    course: level.course,
    grid: level.grid,
    cells,
    entities: byType,
    checkpoints: level.checkpoints.length,
    timing: level.timing,
    solution,
    stamp,
  };
  printLine(
    o,
    [
      `id        ${info.id}${info.course ? ` (course slot ${info.course.slot})` : ""}`,
      `name      ${info.name}${info.author ? ` by ${info.author}` : ""}`,
      `grid      ${level.grid.width}×${level.grid.height}, ${cells} cells`,
      `entities  ${
        Object.entries(byType)
          .map(([k, v]) => `${k}×${v}`)
          .join(" ") || "none"
      }`,
      `timing    limit ${level.timing.timeLimit}s, par ${level.timing.par}s, bonus ${level.timing.timeBonus}s`,
      `solution  ${solution ? `${solution.ticks} ticks (${(solution.ticks / 120).toFixed(2)} s), ${solution.deaths} deaths` : "(source; not compiled)"}`,
      `stamp     ${stamp ? JSON.stringify(stamp) : "none"}`,
    ].join("\n"),
    info,
  );
  return 0;
}
