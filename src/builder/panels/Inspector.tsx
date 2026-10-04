import { CHECKPOINT_PARAMS, ENTITY_SPECS } from "../../level/entities/specs";
import type { EntitySource } from "../../level/types";
import { deleteSelection } from "../editor/actions";
import { updateEntity, updateWaypoint, waypointsOf } from "../editor/commands";
import type { EditorState } from "../editor/EditorState";
import { EntityPalette } from "./EntityPalette";
import { NumberField, ParamField, TupleField } from "./fields";
import { LevelSettings } from "./LevelSettings";

function patchKey<T extends object>(obj: T, key: string, v: unknown): T {
  const next = { ...obj } as Record<string, unknown>;
  if (v === undefined) delete next[key];
  else next[key] = v;
  return next as T;
}

/** Right column: selection form, or level settings when nothing is selected. */
export function Inspector(props: { ed: EditorState }) {
  const { ed } = props;
  const sel = ed.selection.value;
  const src = ed.source.value;

  let body;
  if (sel?.kind === "entities" && sel.indices.length === 1) {
    const i = sel.indices[0]!;
    const e = src.entities?.[i];
    if (e) {
      const spec = ENTITY_SPECS[e.type];
      const errs = ed.diagnostics.value.filter((d) => d.entityIndex === i);
      body = (
        <div class="inspector" data-testid="inspector-entity">
          <h3>
            {spec.label} <span class="dim">#{i}</span>
          </h3>
          {spec.params.map((p) => (
            <ParamField
              key={p.key}
              spec={p}
              value={(e as unknown as Record<string, unknown>)[p.key]}
              onChange={(v) =>
                ed.apply((s) => updateEntity(s, i, patchKey(e, p.key, v) as EntitySource))
              }
              onEditPath={() => {
                ed.pendingPath.value = i;
                ed.tool.value = "entity";
                ed.notify("Click path cells, Enter to finish");
              }}
            />
          ))}
          {errs.map((d, k) => (
            <p key={k} class={`diag ${d.severity}`}>
              {d.code} {d.message}
            </p>
          ))}
          <button class="bbtn danger" onClick={() => deleteSelection(ed)}>
            Delete
          </button>
        </div>
      );
    }
  } else if (sel?.kind === "entities") {
    body = (
      <div class="inspector">
        <h3>{sel.indices.length} entities</h3>
        <p class="hint">Drag to move together.</p>
        <button class="bbtn danger" onClick={() => deleteSelection(ed)}>
          Delete
        </button>
      </div>
    );
  } else if (sel?.kind === "checkpoint") {
    const cp = src.checkpoints?.[sel.index];
    if (cp) {
      body = (
        <div class="inspector" data-testid="inspector-checkpoint">
          <h3>
            Checkpoint <span class="dim">#{sel.index}</span>
          </h3>
          {CHECKPOINT_PARAMS.map((p) => (
            <ParamField
              key={p.key}
              spec={p}
              value={(cp as unknown as Record<string, unknown>)[p.key]}
              onChange={(v) =>
                ed.apply((s) => {
                  const next = patchKey(cp, p.key, v);
                  return {
                    ...s,
                    checkpoints: (s.checkpoints ?? []).map((c, k) => (k === sel.index ? next : c)),
                  };
                })
              }
              onEditPath={() => undefined}
            />
          ))}
          <button class="bbtn danger" onClick={() => deleteSelection(ed)}>
            Delete
          </button>
        </div>
      );
    }
  } else if (sel?.kind === "waypoint") {
    const wp = waypointsOf(src)[sel.index];
    if (wp) {
      body = (
        <div class="inspector" data-testid="inspector-waypoint">
          <h3>
            Waypoint <span class="dim">#{sel.index}</span>
          </h3>
          <TupleField
            label="Cell"
            size={2}
            value={wp.at}
            onChange={(v) =>
              v &&
              ed.apply((s) =>
                updateWaypoint(s, sel.index, { at: [Math.round(v[0]!), Math.round(v[1]!)] }),
              )
            }
          />
          <NumberField
            label="Speed"
            value={wp.speed}
            placeholder="0.8"
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => ed.apply((s) => updateWaypoint(s, sel.index, { speed: v }))}
          />
          <NumberField
            label="Radius"
            value={wp.radius}
            placeholder="0.6"
            min={0.1}
            max={3}
            step={0.05}
            onChange={(v) => ed.apply((s) => updateWaypoint(s, sel.index, { radius: v }))}
          />
          <NumberField
            label="Hold (s)"
            value={wp.hold}
            placeholder="0"
            min={0}
            max={10}
            step={0.05}
            onChange={(v) => ed.apply((s) => updateWaypoint(s, sel.index, { hold: v }))}
          />
          <button class="bbtn danger" onClick={() => deleteSelection(ed)}>
            Delete
          </button>
        </div>
      );
    }
  }

  return (
    <div class="side right">
      {ed.tool.value === "entity" && <EntityPalette ed={ed} />}
      {body ?? <LevelSettings ed={ed} />}
    </div>
  );
}
