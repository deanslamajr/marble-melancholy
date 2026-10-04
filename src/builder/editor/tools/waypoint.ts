import { addWaypoint, removeLastWaypoint, waypointsOf } from "../commands";
import type { Tool } from "./types";

/** Waypoint (P): append a solution waypoint; right click removes the last one. */
export const waypointTool: Tool = {
  id: "waypoint",
  key: "p",
  label: "Waypoint",
  stroke: false,
  down({ ed, cell, button }) {
    if (button === 2) {
      ed.apply(removeLastWaypoint);
      return;
    }
    if (ed.src.solution && ed.src.solution.kind !== "waypoints") {
      ed.apply((s) => ({ ...s, solution: { kind: "waypoints", points: [] } }));
      ed.notify("Replaced the previous solution with waypoints (Ctrl+Z to undo)");
    }
    ed.apply((s) => addWaypoint(s, cell));
    ed.selection.value = { kind: "waypoint", index: waypointsOf(ed.src).length - 1 };
  },
};
