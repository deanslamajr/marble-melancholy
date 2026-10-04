import { ENTITY_SPECS } from "../../level/entities/specs";
import { ENTITY_TYPES } from "../../level/types";
import type { EditorState } from "../editor/EditorState";

export function EntityPalette(props: { ed: EditorState }) {
  const { ed } = props;
  const pending = ed.pendingPath.value;
  return (
    <div class="palette" data-testid="entity-palette">
      <h3>Entity palette</h3>
      <div class="palette-grid">
        {ENTITY_TYPES.map((t) => (
          <button
            key={t}
            class={`bbtn${ed.paletteType.value === t ? " on" : ""}`}
            onClick={() => (ed.paletteType.value = t)}
            data-testid={`palette-${t}`}
            title={ENTITY_SPECS[t].label}
          >
            <span class="glyph">{ENTITY_SPECS[t].glyph}</span>
            {ENTITY_SPECS[t].label}
          </button>
        ))}
      </div>
      {pending !== null && (
        <p class="hint">
          Adding path points to entity #{pending}. Enter finishes, right click cancels.
        </p>
      )}
    </div>
  );
}
