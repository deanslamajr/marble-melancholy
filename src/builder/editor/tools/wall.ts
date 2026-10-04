import { WALL } from "../../../level/types";
import { gridOf, setWall } from "../commands";
import type { Tool, ToolEvent } from "./types";

/** Edge bit nearest to the pointer inside the cell. */
export function nearestEdge(fx: number, fy: number): number {
  const d = [
    { bit: WALL.N, v: fy },
    { bit: WALL.S, v: 1 - fy },
    { bit: WALL.W, v: fx },
    { bit: WALL.E, v: 1 - fx },
  ];
  d.sort((a, b) => a.v - b.v);
  return d[0]!.bit;
}

let mode: boolean | null = null;

function paint(e: ToolEvent): void {
  const bit = nearestEdge(e.fx, e.fy);
  if (e.button === 2) {
    e.ed.apply((s) => setWall(s, e.cell, bit, false));
    return;
  }
  if (mode === null) {
    const g = gridOf(e.ed.src);
    const cur = g.walls[e.cell[1] * g.w + e.cell[0]] ?? 0;
    mode = (cur & bit) === 0;
  }
  const on = mode;
  e.ed.apply((s) => setWall(s, e.cell, bit, on));
}

/** Wall (W): toggle the rail on the nearest edge; a drag paints the same state along edges. */
export const wallTool: Tool = {
  id: "wall",
  key: "w",
  label: "Wall",
  stroke: true,
  down(e) {
    mode = null;
    paint(e);
  },
  drag: paint,
  up() {
    mode = null;
  },
};
