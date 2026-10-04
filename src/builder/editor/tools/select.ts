import { ENTITY_SPECS } from "../../../level/entities/specs";
import type { Cell, LevelSource } from "../../../level/types";
import {
  entityAnchor,
  moveEntities,
  updateCheckpoint,
  updateWaypoint,
  waypointsOf,
} from "../commands";
import type { Selection } from "../EditorState";
import type { Tool } from "./types";

const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/** What is under a cell: entity anchors first, then footprints, checkpoints, waypoints. */
export function hitTest(src: LevelSource, c: Cell): Selection {
  const ents = src.entities ?? [];
  for (let i = ents.length - 1; i >= 0; i--)
    if (same(entityAnchor(ents[i]!), c)) return { kind: "entities", indices: [i] };
  const cps = src.checkpoints ?? [];
  for (let i = 0; i < cps.length; i++)
    if (same(cps[i]!.at, c)) return { kind: "checkpoint", index: i };
  const wps = waypointsOf(src);
  for (let i = wps.length - 1; i >= 0; i--)
    if (same(wps[i]!.at, c)) return { kind: "waypoint", index: i };
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i]!;
    if (ENTITY_SPECS[e.type].footprint(e).some((f) => same(f, c)))
      return { kind: "entities", indices: [i] };
  }
  return null;
}

let dragFrom: Cell | null = null;

export const selectTool: Tool = {
  id: "select",
  key: "v",
  label: "Select",
  stroke: true,
  down({ ed, cell, button, shift }) {
    if (button === 2) {
      ed.selection.value = null;
      return;
    }
    const hit = hitTest(ed.src, cell);
    const cur = ed.selection.value;
    if (shift && hit?.kind === "entities" && cur?.kind === "entities") {
      const set = new Set([...cur.indices, ...hit.indices]);
      ed.selection.value = { kind: "entities", indices: [...set] };
    } else if (
      hit?.kind === "entities" &&
      cur?.kind === "entities" &&
      cur.indices.includes(hit.indices[0]!)
    ) {
      // keep the multi-selection so the whole group drags
    } else {
      ed.selection.value = hit;
    }
    dragFrom = hit ? cell : null;
    ed.marquee.value = hit ? null : { a: cell, b: cell };
  },
  drag({ ed, cell }) {
    const m = ed.marquee.value;
    if (m) {
      ed.marquee.value = { a: m.a, b: cell };
      return;
    }
    if (!dragFrom) return;
    const dx = cell[0] - dragFrom[0];
    const dy = cell[1] - dragFrom[1];
    if (dx === 0 && dy === 0) return;
    const sel = ed.selection.value;
    if (sel?.kind === "entities") ed.apply((s) => moveEntities(s, sel.indices, dx, dy));
    else if (sel?.kind === "checkpoint")
      ed.apply((s) => updateCheckpoint(s, sel.index, { at: [cell[0], cell[1]] }));
    else if (sel?.kind === "waypoint")
      ed.apply((s) => updateWaypoint(s, sel.index, { at: [cell[0], cell[1]] }));
    dragFrom = cell;
  },
  up({ ed }) {
    dragFrom = null;
    const m = ed.marquee.value;
    ed.marquee.value = null;
    if (!m || same(m.a, m.b)) return;
    const x0 = Math.min(m.a[0], m.b[0]);
    const x1 = Math.max(m.a[0], m.b[0]);
    const y0 = Math.min(m.a[1], m.b[1]);
    const y1 = Math.max(m.a[1], m.b[1]);
    const indices: number[] = [];
    (ed.src.entities ?? []).forEach((e, i) => {
      const [x, y] = entityAnchor(e);
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) indices.push(i);
    });
    ed.selection.value = indices.length > 0 ? { kind: "entities", indices } : null;
  },
};
