import { useState } from "preact/hooks";
import { resolveTheme } from "../../level/themes";
import {
  MUSIC_IDS,
  THEME_IDS,
  type LevelSource,
  type ThemeId,
  type ThemeOverride,
} from "../../level/types";
import { resizeGrid } from "../editor/commands";
import type { EditorState } from "../editor/EditorState";
import { NumberField } from "./fields";

const COLOR_KEYS = ["top", "sideLight", "sideDark", "rail", "bgTop", "bgBottom", "accent"] as const;

function setIn<K extends keyof LevelSource>(
  s: LevelSource,
  key: K,
  value: LevelSource[K] | undefined,
): LevelSource {
  const next = { ...s };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function prune<T extends object>(o: T): T | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

export function LevelSettings(props: { ed: EditorState }) {
  const { ed } = props;
  const s = ed.source.value;
  const [size, setSize] = useState<[number, number] | null>(null);
  const themeBase: ThemeId = typeof s.theme === "string" ? s.theme : s.theme.base;
  const override: ThemeOverride | null = typeof s.theme === "string" ? null : s.theme;
  const resolved = resolveTheme(s.theme);
  const levelErrs = ed.diagnostics.value.filter((d) => d.entityIndex === null && d.cell === null);

  const text = (label: string, value: string, onChange: (v: string) => void, testid?: string) => (
    <label class="field">
      {label}
      <input
        type="text"
        value={value}
        data-testid={testid}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );

  const pendingSize = size ?? [s.grid.width, s.grid.height];
  const shrinking = pendingSize[0] < s.grid.width || pendingSize[1] < s.grid.height;

  return (
    <div class="inspector" data-testid="level-settings">
      <h3>Level settings</h3>
      {text("Name", s.name, (v) => ed.apply((x) => ({ ...x, name: v })), "level-name")}
      {text("Id", s.id, (v) => ed.apply((x) => ({ ...x, id: v.trim() })), "level-id")}
      {text("Author", s.author ?? "", (v) =>
        ed.apply((x) => setIn(x, "author", v.trim() ? v : undefined)),
      )}
      <label class="field">
        Theme
        <select
          value={themeBase}
          onChange={(e) => {
            const base = e.currentTarget.value as ThemeId;
            ed.apply((x) => ({ ...x, theme: override ? { ...override, base } : base }));
          }}
        >
          {THEME_IDS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Theme colours</summary>
        {COLOR_KEYS.map((k) => (
          <label key={k} class="field color">
            {k}
            <input
              type="color"
              value={override?.[k] ?? resolved[k]}
              onChange={(e) => {
                const v = e.currentTarget.value;
                ed.apply((x) => ({
                  ...x,
                  theme: { ...(override ?? { base: themeBase }), [k]: v },
                }));
              }}
            />
          </label>
        ))}
        {override && (
          <button class="bbtn small" onClick={() => ed.apply((x) => ({ ...x, theme: themeBase }))}>
            Reset colours
          </button>
        )}
      </details>
      <label class="field">
        Music
        <select
          value={s.music}
          onChange={(e) =>
            ed.apply((x) => ({ ...x, music: e.currentTarget.value as LevelSource["music"] }))
          }
        >
          {MUSIC_IDS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <h4>Grid</h4>
      <div class="row">
        <NumberField
          label="W"
          value={pendingSize[0]}
          min={4}
          max={128}
          step={1}
          onChange={(v) =>
            v && setSize([Math.max(4, Math.min(128, Math.round(v))), pendingSize[1]])
          }
        />
        <NumberField
          label="H"
          value={pendingSize[1]}
          min={4}
          max={128}
          step={1}
          onChange={(v) =>
            v && setSize([pendingSize[0], Math.max(4, Math.min(128, Math.round(v)))])
          }
        />
      </div>
      {size && (size[0] !== s.grid.width || size[1] !== s.grid.height) && (
        <div class="row">
          <button
            class={`bbtn small${shrinking ? " danger" : ""}`}
            onClick={() => {
              ed.apply((x) => resizeGrid(x, size[0], size[1]));
              setSize(null);
            }}
          >
            {shrinking ? "Resize (drops cells)" : "Resize"}
          </button>
          <button class="bbtn small" onClick={() => setSize(null)}>
            Cancel
          </button>
        </div>
      )}

      <h4>Timing</h4>
      <NumberField
        label="Time limit (s)"
        value={s.timing.timeLimit}
        min={5}
        max={99}
        step={1}
        onChange={(v) =>
          v !== undefined &&
          ed.apply((x) => ({ ...x, timing: { ...x.timing, timeLimit: Math.round(v) } }))
        }
      />
      <NumberField
        label="Par (s)"
        value={s.timing.par}
        min={1}
        max={98}
        step={1}
        onChange={(v) =>
          v !== undefined &&
          ed.apply((x) => ({ ...x, timing: { ...x.timing, par: Math.round(v) } }))
        }
      />
      <NumberField
        label="Time bonus (s)"
        value={s.timing.timeBonus}
        placeholder="auto"
        min={0}
        max={30}
        step={1}
        onChange={(v) =>
          ed.apply((x) => ({
            ...x,
            timing:
              prune({ ...x.timing, timeBonus: v === undefined ? undefined : Math.round(v) }) ??
              x.timing,
          }))
        }
      />
      <NumberField
        label="Goal radius"
        value={s.goal.radius}
        placeholder="0.8"
        min={0.5}
        max={2}
        step={0.1}
        onChange={(v) =>
          ed.apply((x) => ({ ...x, goal: prune({ ...x.goal, radius: v }) ?? x.goal }))
        }
      />
      <NumberField
        label="Seed"
        value={s.seed}
        placeholder="0"
        min={0}
        step={1}
        onChange={(v) =>
          ed.apply((x) => setIn(x, "seed", v === undefined ? undefined : Math.round(v)))
        }
      />

      <details>
        <summary>Scoring</summary>
        {(["progress", "goal", "perSecond", "firstHome"] as const).map((k) => (
          <NumberField
            key={k}
            label={k}
            value={s.scoring?.[k]}
            placeholder="default"
            min={0}
            step={1}
            onChange={(v) => ed.apply((x) => setIn(x, "scoring", prune({ ...x.scoring, [k]: v })))}
          />
        ))}
      </details>
      <details>
        <summary>Physics</summary>
        {(["slopeGravityScale", "frictionScale", "inputScale"] as const).map((k) => (
          <NumberField
            key={k}
            label={k}
            value={s.physics?.[k]}
            placeholder="1"
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => ed.apply((x) => setIn(x, "physics", prune({ ...x.physics, [k]: v })))}
          />
        ))}
      </details>
      {levelErrs.map((d, k) => (
        <p key={k} class={`diag ${d.severity}`}>
          {d.code} {d.message}
        </p>
      ))}
    </div>
  );
}
