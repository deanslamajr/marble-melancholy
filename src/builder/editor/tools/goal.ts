import { setGoal } from "../commands";
import type { Tool } from "./types";

export const goalTool: Tool = {
  id: "goal",
  key: "o",
  label: "Goal",
  stroke: false,
  down({ ed, cell, button }) {
    if (button === 0) ed.apply((s) => setGoal(s, cell));
  },
};
