import { TICK_HZ } from "../../sim/constants";
import { setSolution, waypointsOf } from "../editor/commands";
import type { EditorState } from "../editor/EditorState";

export function SolutionPanel(props: { ed: EditorState }) {
  const { ed } = props;
  const sol = ed.source.value.solution;
  const sv = ed.solve.value;
  const playing = ed.playing.value !== null;
  let summary = "none";
  if (sol?.kind === "waypoints") summary = `waypoints (${waypointsOf(ed.source.value).length})`;
  else if (sol?.kind === "script") summary = `script (${sol.segments.length} segments)`;
  else if (sol?.kind === "replay")
    summary = `recorded run (${(sol.expectedTicks / TICK_HZ).toFixed(2)} s)`;
  return (
    <div class="solution" data-testid="solution-panel">
      <h3>Solution</h3>
      <p>
        Kind: <b>{summary}</b>
      </p>
      <div class="row">
        <button class="bbtn small" disabled={playing} onClick={() => ed.autoSolve()}>
          Auto-solve
        </button>
        <button class="bbtn small" disabled={playing} onClick={() => ed.startTestPlay(true)}>
          Record
        </button>
        <button
          class="bbtn small"
          disabled={!sol || playing}
          onClick={() => {
            ed.apply((s) => setSolution(s, undefined));
            ed.solve.value = null;
          }}
        >
          Clear
        </button>
      </div>
      {sv && (
        <p class={`solve-result ${sv.ok ? "ok" : "fail"}`} data-testid="solve-result">
          {sv.text}
        </p>
      )}
    </div>
  );
}
