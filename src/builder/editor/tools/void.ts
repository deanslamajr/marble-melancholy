import { brushCells, setHeight } from "../commands";
import type { Tool, ToolEvent } from "./types";

function paint({ ed, cell }: ToolEvent): void {
  const cells = brushCells(cell, ed.brush.value, ed.src.grid.width, ed.src.grid.height);
  ed.apply((s) => setHeight(s, cells, -1));
}

/** Void (X): clear cells entirely. */
export const voidTool: Tool = {
  id: "void",
  key: "x",
  label: "Void",
  stroke: true,
  down: paint,
  drag: paint,
};
