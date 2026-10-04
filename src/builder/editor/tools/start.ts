import { setStart } from "../commands";
import type { Tool } from "./types";

export const p1Tool: Tool = {
  id: "p1",
  key: "1",
  label: "P1",
  stroke: false,
  down({ ed, cell, button }) {
    if (button === 0) ed.apply((s) => setStart(s, "p1", cell));
  },
};

export const p2Tool: Tool = {
  id: "p2",
  key: "2",
  label: "P2",
  stroke: false,
  down({ ed, cell, button }) {
    if (button === 0) ed.apply((s) => setStart(s, "p2", cell));
  },
};
