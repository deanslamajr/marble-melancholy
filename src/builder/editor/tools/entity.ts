import { defaultEntity, ENTITY_SPECS } from "../../../level/entities/specs";
import type { EntitySource } from "../../../level/types";
import { addEntity, updateEntity } from "../commands";
import type { Tool } from "./types";

function needsPath(e: EntitySource): boolean {
  return ENTITY_SPECS[e.type].params.some((p) => p.kind === "path" && p.required);
}

/**
 * Entity (E): place the palette entity. Entities with a required path (platforms) take further
 * clicks as path points; Enter finishes. Optional paths are edited from the inspector.
 */
export const entityTool: Tool = {
  id: "entity",
  key: "e",
  label: "Entity",
  stroke: false,
  down({ ed, cell, button }) {
    const pending = ed.pendingPath.value;
    if (button === 2) {
      ed.pendingPath.value = null;
      return;
    }
    if (pending !== null) {
      const e = ed.src.entities?.[pending];
      if (e && "path" in e) {
        const path = [...(e.path ?? []), [cell[0], cell[1]] as [number, number]];
        ed.apply((s) => updateEntity(s, pending, { ...e, path } as EntitySource));
        return;
      }
      ed.pendingPath.value = null;
    }
    const e = defaultEntity(ed.paletteType.value, cell);
    const index = ed.src.entities?.length ?? 0;
    if (needsPath(e) && "path" in e) {
      (e as { path?: Array<[number, number]> }).path = [[cell[0], cell[1]]];
      ed.pendingPath.value = index;
      ed.notify("Click path cells, Enter to finish");
    }
    ed.apply((s) => addEntity(s, e));
    ed.selection.value = { kind: "entities", indices: [index] };
  },
};
