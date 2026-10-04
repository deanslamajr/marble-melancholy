import type { Diagnostic } from "../../level/diagnostics";
import type { EditorState } from "../editor/EditorState";

export function focusDiagnostic(ed: EditorState, d: Diagnostic): void {
  if (d.entityIndex !== null) ed.selection.value = { kind: "entities", indices: [d.entityIndex] };
  if (d.cell) ed.focusCell.value = [d.cell[0], d.cell[1]];
  if (ed.view.value !== "top" && !ed.playing.value) ed.view.value = "top";
}

/** Diagnostics list; clicking one focuses its cell (and selects its entity). */
export function ValidationPanel(props: { ed: EditorState }) {
  const { ed } = props;
  const diags = ed.diagnostics.value;
  return (
    <div class="validation" data-testid="validation-panel">
      <h3>Validation</h3>
      {diags.length === 0 && <p class="ok">No problems.</p>}
      <ul>
        {diags.map((d, i) => (
          <li key={i}>
            <button class={`diag ${d.severity}`} onClick={() => focusDiagnostic(ed, d)}>
              <b>{d.code}</b> {d.message}
              {d.cell && (
                <span class="dim">
                  {" "}
                  ({d.cell[0]}, {d.cell[1]})
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
