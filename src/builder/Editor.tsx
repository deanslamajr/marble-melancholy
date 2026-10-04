import { useEffect, useState } from "preact/hooks";
import type { AudioEngine } from "../audio/AudioEngine";
import { navigate } from "../app/router";
import { TICK_HZ } from "../sim/constants";
import { getDraft } from "../storage/levelsStore";
import { EditorState } from "./editor/EditorState";
import { IsoView } from "./editor/views/IsoView";
import { TopDownView } from "./editor/views/TopDownView";
import { Inspector } from "./panels/Inspector";
import { LayersPanel } from "./panels/LayersPanel";
import { SolutionPanel } from "./panels/SolutionPanel";
import { StatusBar } from "./panels/StatusBar";
import { Toolbar } from "./panels/Toolbar";
import { ValidationPanel } from "./panels/ValidationPanel";
import { installShortcuts } from "./shortcuts";

const AUTOSAVE_MS = 30_000;

export function Editor(props: { draftId: string; audio: AudioEngine }) {
  const [ed, setEd] = useState<EditorState | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    let state: EditorState | null = null;
    void getDraft(props.draftId).then((d) => {
      if (!alive) return;
      if (!d) {
        setMissing(true);
        return;
      }
      state = new EditorState(d.id, d.source);
      setEd(state);
    });
    return () => {
      alive = false;
      if (state?.dirty.value) void state.save();
      state?.dispose();
    };
  }, [props.draftId]);

  useEffect(() => {
    if (!ed) return;
    const off = installShortcuts(ed);
    const saveIfDirty = () => {
      if (ed.dirty.value && !ed.playing.value) void ed.save();
    };
    const timer = setInterval(saveIfDirty, AUTOSAVE_MS);
    const onVis = () => {
      if (document.visibilityState === "hidden") saveIfDirty();
    };
    window.addEventListener("blur", saveIfDirty);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off();
      clearInterval(timer);
      window.removeEventListener("blur", saveIfDirty);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ed]);

  if (missing) {
    return (
      <div class="builder-home">
        <p>Draft not found.</p>
        <button class="bbtn" onClick={() => navigate({ name: "builder" })}>
          ← Builder home
        </button>
      </div>
    );
  }
  if (!ed) return <div class="builder loading">Loading draft…</div>;

  const rec = ed.pendingRecording.value;
  return (
    <div class="builder" data-testid="editor">
      <Toolbar ed={ed} />
      <div class="builder-main">
        <LayersPanel ed={ed} />
        {ed.view.value === "top" ? (
          <TopDownView ed={ed} />
        ) : (
          <IsoView ed={ed} audio={props.audio} />
        )}
        <div class="side right-col">
          <Inspector ed={ed} />
          <SolutionPanel ed={ed} />
          <ValidationPanel ed={ed} />
        </div>
      </div>
      <StatusBar ed={ed} />
      {rec && (
        <div class="modal-backdrop">
          <div class="modal builder-modal" role="dialog" aria-label="Save recording">
            <h3>GOAL in {(rec.ticks / TICK_HZ).toFixed(2)} s</h3>
            <p>{rec.deaths} deaths. Save this run as the level's solution?</p>
            <div class="row">
              <button
                class="bbtn on"
                onClick={() => ed.acceptRecording()}
                data-testid="save-recording"
              >
                Save as solution
              </button>
              <button class="bbtn" onClick={() => ed.discardRecording()}>
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
