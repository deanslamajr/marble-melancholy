import { SLOPE, SURFACE } from "../../level/types";
import type { EditorState, LayerVisibility } from "../editor/EditorState";

const LAYER_KEYS: Array<keyof LayerVisibility> = [
  "heights",
  "slopes",
  "surfaces",
  "walls",
  "entities",
  "waypoints",
];

const SLOPE_NAMES: Array<[number, string]> = Object.entries(SLOPE)
  .filter(([k]) => k !== "flat")
  .map(([k, v]) => [v, k === k.toLowerCase() ? `${k.toUpperCase()} steep` : k]);

const SURFACE_NAMES: Array<[number, string]> = [
  [SURFACE.normal, ". normal"],
  [SURFACE.ice, "i ice"],
  [SURFACE.acid, "a acid"],
  [SURFACE.speedN, "speed N"],
  [SURFACE.speedE, "speed E"],
  [SURFACE.speedS, "speed S"],
  [SURFACE.speedW, "speed W"],
];

/** Left column: layer visibility and brush settings. */
export function LayersPanel(props: { ed: EditorState }) {
  const { ed } = props;
  const vis = ed.layers.value;
  return (
    <div class="side left">
      <h3>Layers</h3>
      {LAYER_KEYS.map((k) => (
        <label key={k} class="check">
          <input
            type="checkbox"
            checked={vis[k]}
            onChange={(e) => (ed.layers.value = { ...vis, [k]: e.currentTarget.checked })}
          />
          {k}
        </label>
      ))}
      <h3>Brush</h3>
      <div class="seg">
        {([1, 3, 5] as const).map((n) => (
          <button
            key={n}
            class={`bbtn${ed.brush.value === n ? " on" : ""}`}
            onClick={() => (ed.brush.value = n)}
          >
            {n}
          </button>
        ))}
      </div>
      <label class="field">
        Height
        <input
          type="number"
          min={0}
          max={35}
          step={1}
          value={ed.heightValue.value}
          data-testid="height-value"
          onChange={(e) =>
            (ed.heightValue.value = Math.max(
              0,
              Math.min(35, Math.round(Number(e.currentTarget.value) || 0)),
            ))
          }
        />
      </label>
      <label class="field">
        Slope
        <select
          value={ed.slopeValue.value}
          onChange={(e) => (ed.slopeValue.value = Number(e.currentTarget.value))}
        >
          {SLOPE_NAMES.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        Surface
        <select
          value={ed.surfaceValue.value}
          onChange={(e) => (ed.surfaceValue.value = Number(e.currentTarget.value))}
        >
          {SURFACE_NAMES.map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p class="hint">Space+drag or middle-drag pans; wheel or +/− zooms.</p>
    </div>
  );
}
