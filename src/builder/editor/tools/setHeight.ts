import { brushCells, cellHeight, setHeight } from "../commands";
import type { Tool, ToolEvent } from "./types";

function paint({ ed, cell, button }: ToolEvent): void {
  const cells = brushCells(cell, ed.brush.value, ed.src.grid.width, ed.src.grid.height);
  const h = button === 2 ? -1 : ed.heightValue.value;
  ed.apply((s) => setHeight(s, cells, h));
}

/** Set height (G): paint the Height field value; right click voids; Alt+click samples. */
export const setHeightTool: Tool = {
  id: "setHeight",
  key: "g",
  label: "Set H",
  stroke: true,
  down(e) {
    if (e.alt) {
      const h = cellHeight(e.ed.src, e.cell);
      if (h >= 0) e.ed.heightValue.value = h;
      return;
    }
    paint(e);
  },
  drag(e) {
    if (!e.alt) paint(e);
  },
};
