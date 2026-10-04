import type { Cell } from "../../../level/types";
import type { EditorState, ToolId } from "../EditorState";

export interface ToolEvent {
  ed: EditorState;
  cell: Cell;
  /** Pointer position inside the cell, 0..1 on each axis. */
  fx: number;
  fy: number;
  /** 0 = primary (left), 2 = secondary (right). */
  button: 0 | 2;
  shift: boolean;
  alt: boolean;
}

export interface Tool {
  id: ToolId;
  key: string;
  label: string;
  /** Painting tools coalesce a whole drag into one undo entry. */
  stroke: boolean;
  down(e: ToolEvent): void;
  drag?(e: ToolEvent): void;
  up?(e: ToolEvent): void;
}
