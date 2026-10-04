import { addCheckpoint } from "../commands";
import type { Tool } from "./types";

export const checkpointTool: Tool = {
  id: "checkpoint",
  key: "c",
  label: "Checkpoint",
  stroke: false,
  down({ ed, cell, button }) {
    if (button !== 0) return;
    const index = ed.src.checkpoints?.length ?? 0;
    ed.apply((s) => addCheckpoint(s, cell));
    ed.selection.value = { kind: "checkpoint", index };
  },
};
