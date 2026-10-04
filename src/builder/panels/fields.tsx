// Small form controls generated from ParamSpec (§6.2 Inspector).
import type { ParamSpec } from "../../level/entities/specs";
import type { Cell } from "../../level/types";

type Value = unknown;

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function NumberField(props: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange(v: number | undefined): void;
}) {
  return (
    <label class="field">
      {props.label}
      <input
        type="number"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        min={props.min}
        max={props.max}
        step={props.step ?? "any"}
        onChange={(e) => props.onChange(num(e.currentTarget.value))}
      />
    </label>
  );
}

export function TupleField(props: {
  label: string;
  value: number[] | undefined;
  size: number;
  placeholder?: number[];
  onChange(v: number[] | undefined): void;
}) {
  const cur = props.value;
  return (
    <div class="field tuple">
      <span>{props.label}</span>
      <div class="tuple-inputs">
        {Array.from({ length: props.size }, (_, i) => (
          <input
            key={i}
            type="number"
            step="any"
            value={cur?.[i] ?? ""}
            placeholder={props.placeholder?.[i] !== undefined ? String(props.placeholder[i]) : ""}
            onChange={(e) => {
              const n = num(e.currentTarget.value);
              const base = cur
                ? [...cur]
                : [...(props.placeholder ?? Array<number>(props.size).fill(0))];
              if (n === undefined && !cur) return;
              base[i] = n ?? 0;
              props.onChange(base);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function parsePath(text: string): Cell[] | null {
  const parts = text
    .split(/[;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Cell[] = [];
  for (const p of parts) {
    const m = /^(-?\d+)\s*[, ]\s*(-?\d+)$/.exec(p);
    if (!m) return null;
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

export function PathField(props: {
  label: string;
  value: Cell[] | undefined;
  onChange(v: Cell[] | undefined): void;
  onEdit(): void;
}) {
  const text = (props.value ?? []).map((c) => `${c[0]},${c[1]}`).join("; ");
  return (
    <div class="field">
      <span>{props.label}</span>
      <input
        type="text"
        value={text}
        placeholder="x,y; x,y"
        onChange={(e) => {
          const p = parsePath(e.currentTarget.value);
          if (p) props.onChange(p.length ? p : undefined);
        }}
      />
      <div class="row">
        <button class="bbtn small" onClick={props.onEdit}>
          Click cells…
        </button>
        <button class="bbtn small" onClick={() => props.onChange(undefined)}>
          Clear
        </button>
      </div>
    </div>
  );
}

/** Renders one ParamSpec. Unset optional values show their default as a placeholder. */
export function ParamField(props: {
  spec: ParamSpec;
  value: Value;
  onChange(v: Value): void;
  onEditPath(): void;
}) {
  const { spec, value, onChange } = props;
  const label = spec.required ? `${spec.label} *` : spec.label;
  const def = spec.default;
  switch (spec.kind) {
    case "number":
    case "int":
      return (
        <NumberField
          label={label}
          value={value as number | undefined}
          placeholder={typeof def === "number" ? String(def) : ""}
          min={spec.min}
          max={spec.max}
          step={spec.kind === "int" ? 1 : spec.step}
          onChange={(v) =>
            onChange(v === undefined ? undefined : spec.kind === "int" ? Math.round(v) : v)
          }
        />
      );
    case "enum":
      return (
        <label class="field">
          {label}
          <select
            value={(value as string | undefined) ?? (def as string)}
            onChange={(e) => onChange(e.currentTarget.value)}
          >
            {(spec.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      );
    case "path":
      return (
        <PathField
          label={label}
          value={value as Cell[] | undefined}
          onChange={onChange}
          onEdit={props.onEditPath}
        />
      );
    case "cell":
    case "vec2":
    case "size":
      return (
        <TupleField
          label={label}
          size={2}
          value={value as number[] | undefined}
          placeholder={Array.isArray(def) ? (def as number[]) : undefined}
          onChange={(v) => onChange(v && spec.kind !== "vec2" ? v.map((n) => Math.round(n)) : v)}
        />
      );
    case "vec3":
      return (
        <TupleField
          label={label}
          size={3}
          value={value as number[] | undefined}
          placeholder={Array.isArray(def) ? (def as number[]) : undefined}
          onChange={onChange}
        />
      );
    case "rect":
      return (
        <TupleField
          label={label}
          size={4}
          value={value as number[] | undefined}
          onChange={(v) => onChange(v?.map((n) => Math.round(n)))}
        />
      );
  }
}
