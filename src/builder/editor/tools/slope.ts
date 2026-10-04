import { SLOPE } from "../../../level/types";
import { brushCells, setSlope } from "../commands";
import type { Tool, ToolEvent } from "./types";

function paint({ ed, cell, button }: ToolEvent): void {
  const cells = brushCells(cell, ed.brush.value, ed.src.grid.width, ed.src.grid.height);
  const v = button === 2 ? SLOPE.flat : ed.slopeValue.value;
  ed.apply((s) => setSlope(s, cells, v));
}

/** Slope brush (S): arrows pick N/E/S/W, Shift+arrow picks steep; right click flattens. */
export const slopeTool: Tool = {
  id: "slope",
  key: "s",
  label: "Slope",
  stroke: true,
  down: paint,
  drag: paint,
};
