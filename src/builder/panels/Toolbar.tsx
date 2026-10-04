import { exportJson, exportSource, goHome, importInto, validate } from "../editor/actions";
import type { EditorState } from "../editor/EditorState";
import { TOOLS } from "../editor/tools";

export function Toolbar(props: { ed: EditorState }) {
  const { ed } = props;
  const tool = ed.tool.value;
  const playing = ed.playing.value !== null;
  const btn = (
    label: string,
    key: string,
    onClick: () => void,
    opts: { active?: boolean; testid?: string; disabled?: boolean } = {},
  ) => (
    <button
      class={`bbtn${opts.active ? " on" : ""}`}
      onClick={onClick}
      disabled={opts.disabled}
      data-testid={opts.testid}
      title={key ? `${label} (${key})` : label}
    >
      {key && <kbd>{key}</kbd>}
      {label}
    </button>
  );
  return (
    <div class="toolbar" role="toolbar" aria-label="Editor tools">
      <div class="group">
        {TOOLS.map((t) =>
          btn(t.label, t.key.toUpperCase(), () => (ed.tool.value = t.id), {
            active: tool === t.id,
            testid: `tool-${t.id}`,
          }),
        )}
      </div>
      <div class="group">
        {btn(
          ed.view.value === "top" ? "Iso view" : "Top view",
          "Tab",
          () => (ed.view.value = ed.view.value === "top" ? "iso" : "top"),
          {
            testid: "toggle-view",
            disabled: playing,
          },
        )}
        {btn("Undo", "Ctrl+Z", () => ed.undo(), { disabled: playing })}
        {btn("Redo", "Ctrl+Y", () => ed.redo(), { disabled: playing })}
      </div>
      <div class="group">
        {btn("Test-play", "T", () => ed.startTestPlay(false), {
          testid: "test-play",
          disabled: playing,
        })}
        {btn("Record", "R", () => ed.startTestPlay(true), { testid: "record", disabled: playing })}
        {btn("Auto-solve", "A", () => void ed.autoSolve(), {
          testid: "auto-solve",
          disabled: playing,
        })}
        {btn("Validate", "F7", () => validate(ed), { testid: "validate" })}
      </div>
      <div class="group">
        {btn("Save", "Ctrl+S", () => void ed.save(), { testid: "save" })}
        <div class="menu-anchor">
          {btn("Export ▾", "Ctrl+E", () => (ed.exportMenu.value = !ed.exportMenu.value), {
            testid: "export",
          })}
          {ed.exportMenu.value && (
            <div class="dropdown" role="menu">
              <button
                role="menuitem"
                onClick={() => void exportJson(ed, "download")}
                data-testid="export-json"
              >
                Download .level.json
              </button>
              <button
                role="menuitem"
                onClick={() => void exportSource(ed, "download")}
                data-testid="export-yaml"
              >
                Download .level.yaml
              </button>
              <button role="menuitem" onClick={() => void exportJson(ed, "copy")}>
                Copy JSON
              </button>
              <button role="menuitem" onClick={() => void exportSource(ed, "copy")}>
                Copy YAML
              </button>
            </div>
          )}
        </div>
        {btn("Import", "Ctrl+I", () => void importInto(ed))}
        <span class="spacer" />
        {btn("← Home", "", () => void goHome(ed), { testid: "builder-home" })}
      </div>
    </div>
  );
}
