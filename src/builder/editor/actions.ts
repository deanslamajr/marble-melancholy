// Editor commands shared by the toolbar, menus and keyboard shortcuts (§6.2).
import { navigate } from "../../app/router";
import { putCustomLevel } from "../../storage/levelsStore";
import { removeCheckpoint, removeEntities, waypointsOf } from "./commands";
import type { EditorState } from "./EditorState";
import {
  copyText,
  describe,
  downloadText,
  exportCompiled,
  exportYaml,
  importText,
  pickFile,
  sourceFromCompiled,
} from "./io";

export async function exportJson(ed: EditorState, mode: "download" | "copy"): Promise<void> {
  ed.exportMenu.value = false;
  const r = await exportCompiled(ed.src);
  if (!r.ok) {
    ed.diagnostics.value = r.diagnostics;
    ed.notify(`Export failed: ${describe(r.diagnostics)}`);
    return;
  }
  await putCustomLevel(r.level);
  if (mode === "download") downloadText(`${r.level.id}.level.json`, r.json, "application/json");
  else if (!(await copyText(r.json))) {
    ed.notify("Clipboard unavailable");
    return;
  }
  ed.notify(
    mode === "download"
      ? "Exported and added to Custom Races"
      : "Compiled JSON copied; added to Custom Races",
  );
}

export async function exportSource(ed: EditorState, mode: "download" | "copy"): Promise<void> {
  ed.exportMenu.value = false;
  const text = exportYaml(ed.src);
  if (mode === "download") {
    downloadText(`${ed.src.id}.level.yaml`, text, "text/yaml");
    ed.notify("YAML exported");
  } else {
    ed.notify((await copyText(text)) ? "YAML copied" : "Clipboard unavailable");
  }
}

/** Import replaces the draft's source (undoable); compiled imports also land in Custom Races. */
export async function importInto(ed: EditorState): Promise<void> {
  const f = await pickFile(".level.yaml,.level.json,.yaml,.yml,.json");
  if (!f) return;
  const r = await importText(f.text, f.name);
  if (r.kind === "error") {
    ed.diagnostics.value = r.diagnostics;
    ed.notify(`Import failed: ${r.message}`);
    return;
  }
  if (r.kind === "compiled") {
    await putCustomLevel(r.level);
    const src = sourceFromCompiled(r.level);
    ed.apply(() => src);
  } else {
    if (r.compiled) await putCustomLevel(r.compiled);
    const src = r.source;
    ed.apply(() => src);
  }
  ed.selection.value = null;
  ed.notify(`Imported ${f.name}`);
}

export function validate(ed: EditorState): void {
  const d = ed.runValidation();
  const e = d.filter((x) => x.severity === "error").length;
  ed.notify(`Validation: ${e} errors, ${d.length - e} warnings`);
}

export function deleteSelection(ed: EditorState): void {
  const sel = ed.selection.value;
  if (!sel) return;
  if (sel.kind === "entities") ed.apply((s) => removeEntities(s, sel.indices));
  else if (sel.kind === "checkpoint") ed.apply((s) => removeCheckpoint(s, sel.index));
  else if (sel.kind === "waypoint") {
    ed.apply((s) => {
      const pts = waypointsOf(s).filter((_, i) => i !== sel.index);
      return { ...s, solution: { kind: "waypoints", points: pts } };
    });
  }
  ed.selection.value = null;
}

export async function goHome(ed: EditorState): Promise<void> {
  if (ed.dirty.value) await ed.save();
  navigate({ name: "builder" });
}

export function zoomBy(ed: EditorState, factor: number): void {
  ed.zoom.value = Math.max(8, Math.min(64, Math.round(ed.zoom.value * factor)));
}
