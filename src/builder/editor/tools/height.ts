import type { Cell } from "../../../level/types";
import { brushCells, cellHeight, raiseHeight, setHeight } from "../commands";
import type { Tool, ToolEvent } from "./types";

let flattenTo: number | null = null;
const touched = new Set<string>();

function paint(e: ToolEvent): void {
  const { ed, cell } = e;
  const cells = brushCells(cell, ed.brush.value, ed.src.grid.width, ed.src.grid.height).filter(
    (c: Cell) => {
      const k = `${c[0]},${c[1]}`;
      if (touched.has(k)) return false;
      touched.add(k);
      return true;
    },
  );
  if (cells.length === 0) return;
  if (flattenTo !== null) {
    const h = flattenTo;
    ed.apply((s) => setHeight(s, cells, h));
  } else {
    ed.apply((s) => raiseHeight(s, cells, e.button === 2 ? -1 : 1, ed.heightValue.value));
  }
}

/** Height brush (H): raise/lower by one half-unit per cell per stroke; Shift flattens. */
export const heightTool: Tool = {
  id: "height",
  key: "h",
  label: "Height",
  stroke: true,
  down(e) {
    touched.clear();
    flattenTo = e.shift ? cellHeight(e.ed.src, e.cell) : null;
    paint(e);
  },
  drag: paint,
  up() {
    touched.clear();
    flattenTo = null;
  },
};
