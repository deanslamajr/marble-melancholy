import { SURFACE } from "../../../level/types";
import { brushCells, setSurface } from "../commands";
import type { Tool, ToolEvent } from "./types";

function paint({ ed, cell, button }: ToolEvent): void {
  const cells = brushCells(cell, ed.brush.value, ed.src.grid.width, ed.src.grid.height);
  const v = button === 2 ? SURFACE.normal : ed.surfaceValue.value;
  ed.apply((s) => setSurface(s, cells, v));
}

/** Surface brush (U): `.`, `i`, `a` select normal/ice/acid; arrows select a speed strip direction. */
export const surfaceTool: Tool = {
  id: "surface",
  key: "u",
  label: "Surface",
  stroke: true,
  down: paint,
  drag: paint,
};
