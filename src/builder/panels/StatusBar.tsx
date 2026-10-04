import { SLOPE, SURFACE } from "../../level/types";
import { gridOf } from "../editor/commands";
import type { EditorState } from "../editor/EditorState";
import { focusDiagnostic } from "./ValidationPanel";

const SLOPE_TAG = Object.fromEntries(
  Object.entries(SLOPE).map(([k, v]) => [v, k === "flat" ? "" : k]),
);
const SURFACE_TAG = Object.fromEntries(
  Object.entries(SURFACE).map(([k, v]) => [v, k === "normal" ? "" : k]),
);

export function StatusBar(props: { ed: EditorState }) {
  const { ed } = props;
  const diags = ed.diagnostics.value;
  const errors = diags.filter((d) => d.severity === "error");
  const warnings = diags.length - errors.length;
  const first = errors[0] ?? diags[0];
  const hv = ed.hover.value;
  let cell = "";
  if (hv) {
    const g = gridOf(ed.source.value);
    const i = hv[1] * g.w + hv[0];
    const h = g.heights[i] ?? -1;
    cell = `(${hv[0]}, ${hv[1]}) ${h < 0 ? "void" : `h=${h}`} ${SLOPE_TAG[g.slopes[i] ?? 0] ?? ""} ${SURFACE_TAG[g.surfaces[i] ?? 0] ?? ""}`;
  }
  return (
    <div class="statusbar" data-testid="statusbar">
      <span data-testid="validation-summary" class={errors.length ? "err" : "ok"}>
        Validation: {errors.length} errors, {warnings} warnings
      </span>
      {first && (
        <button class={`diag-link ${first.severity}`} onClick={() => focusDiagnostic(ed, first)}>
          [{first.code} {first.message}]
        </button>
      )}
      <span class="spacer" />
      {ed.toast.value && (
        <span class="toast" role="status">
          {ed.toast.value}
        </span>
      )}
      {ed.dirty.value && <span class="dim">unsaved</span>}
      <span>{cell}</span>
      <span>zoom {Math.round((ed.zoom.value / 24) * 100)}%</span>
    </div>
  );
}
