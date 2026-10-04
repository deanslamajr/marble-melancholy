import { encodeLayers } from "../../../src/level/parse";
import { solveSolution } from "../../../src/level/solution/solve";
import { display } from "../fs";
import { printDiagnostics, printLine, type OutOpts } from "../format";
import { loadPlayable } from "../load";

export interface PathOpts extends OutOpts {
  layer?: string;
  solution?: string;
}

export async function pathCommand(file: string, o: PathOpts): Promise<number> {
  const shown = display(file);
  const r = loadPlayable(file, o.solution);
  if (!r.ok) {
    printDiagnostics(r.diagnostics, shown, o);
    return r.code === 3 ? 3 : 2;
  }
  const layerName = (o.layer ?? "heights") as "heights" | "slopes" | "surfaces" | "walls";
  if (!["heights", "slopes", "surfaces", "walls"].includes(layerName)) {
    console.error(`unknown layer ${layerName}`);
    return 3;
  }
  const lvl = r.level;
  const W = lvl.grid.width;
  const H = lvl.grid.height;
  const layers = encodeLayers(W, H, lvl.cells);
  const rows = layers[layerName].split("\n").slice(0, H).map((row) => row.split(""));
  const s = r.solution ? solveSolution(lvl, r.solution) : null;
  if (s) {
    for (const [x, y] of s.path) if (rows[y]?.[x] !== undefined) rows[y]![x] = "*";
    for (const [x, y] of s.deathCells) if (rows[y]?.[x] !== undefined) rows[y]![x] = "x";
  }
  const { p1 } = lvl.start;
  const g = lvl.goal.at;
  if (rows[p1[1]]?.[p1[0]] !== undefined) rows[p1[1]]![p1[0]] = "S";
  if (rows[g[1]]?.[g[0]] !== undefined) rows[g[1]]![g[0]] = "G";
  const text = rows.map((row) => row.join("")).join("\n");
  printLine(o, text, { layer: layerName, rows: rows.map((row) => row.join("")), ok: s?.ok ?? false });
  if (!s) return 2;
  printLine(o, s.ok ? `GOAL tick=${s.ticks} deaths=${s.deaths}` : `FAIL reason=${s.reason} at tick=${s.tick}`);
  return s.ok ? 0 : 2;
}
