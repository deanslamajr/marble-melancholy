// ENTITY_SPECS registry: params, defaults, ranges, footprints (§5.3 table).
import type { Cell, EntitySource, EntityType, Rect } from "../types";

export type ParamKind =
  "number" | "int" | "cell" | "path" | "vec3" | "vec2" | "rect" | "size" | "enum";

export interface ParamSpec {
  key: string;
  label: string;
  kind: ParamKind;
  required?: boolean;
  /** Default value; the string "at" means "[at]" for paths. */
  default?: number | string | number[] | number[][];
  min?: number;
  max?: number;
  step?: number;
  minItems?: number;
  maxItems?: number;
  options?: readonly string[];
}

export interface EntitySpec {
  type: EntityType;
  label: string;
  /** One-character glyph for the top-down editor view. */
  glyph: string;
  params: ParamSpec[];
  /** Cells claimed by this entity for overlap checks (E010) and hazard checks (E005). */
  footprint(e: EntitySource): Cell[];
  /** Cells that must be non-void ground (E009). */
  groundCells(e: EntitySource): Cell[];
}

const cell = (key: string, label: string): ParamSpec => ({
  key,
  label,
  kind: "cell",
  required: true,
});

function pathCells(e: { at: Cell; path?: Cell[] }): Cell[] {
  return [e.at, ...(e.path ?? [])];
}

export function funnelCells(at: Cell, radius: number): Cell[] {
  const out: Cell[] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= radius * radius) out.push([at[0] + dx, at[1] + dy]);
    }
  }
  return out;
}

/** Every cell swept by a platform footprint along its path (axis-aligned bounding boxes per leg). */
export function platformSweptCells(path: Cell[], size: [number, number]): Cell[] {
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const b = path[Math.min(i + 1, path.length - 1)]!;
    const x0 = Math.min(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const x1 = Math.max(a[0], b[0]) + size[0] - 1;
    const y1 = Math.max(a[1], b[1]) + size[1] - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = `${x},${y}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push([x, y]);
        }
      }
    }
  }
  return out;
}

export const ENTITY_SPECS: Record<EntityType, EntitySpec> = {
  steelie: {
    type: "steelie",
    label: "Steelie",
    glyph: "S",
    params: [
      cell("at", "Home"),
      { key: "mode", label: "Mode", kind: "enum", options: ["patrol", "hunt"], default: "patrol" },
      { key: "path", label: "Path", kind: "path", default: "at", minItems: 1, maxItems: 16 },
      { key: "speed", label: "Speed", kind: "number", default: 3.5, min: 0.5, max: 8, step: 0.1 },
      {
        key: "aggroRadius",
        label: "Aggro radius",
        kind: "number",
        default: 5,
        min: 1,
        max: 12,
        step: 0.1,
      },
    ],
    footprint: (e) => pathCells(e as { at: Cell; path?: Cell[] }),
    groundCells: (e) => pathCells(e as { at: Cell; path?: Cell[] }),
  },
  muncher: {
    type: "muncher",
    label: "Marble Muncher",
    glyph: "M",
    params: [
      cell("at", "Body"),
      {
        key: "triggerRadius",
        label: "Trigger radius",
        kind: "number",
        default: 1.3,
        min: 0.5,
        max: 3,
        step: 0.1,
      },
      { key: "path", label: "Path", kind: "path", default: "at", minItems: 1, maxItems: 16 },
      { key: "speed", label: "Speed", kind: "number", default: 1.5, min: 0, max: 3, step: 0.1 },
      {
        key: "digestTime",
        label: "Digest time",
        kind: "number",
        default: 1.5,
        min: 0.5,
        max: 4,
        step: 0.1,
      },
    ],
    footprint: (e) => pathCells(e as { at: Cell; path?: Cell[] }),
    groundCells: (e) => pathCells(e as { at: Cell; path?: Cell[] }),
  },
  hoover: {
    type: "hoover",
    label: "Hoover",
    glyph: "H",
    params: [
      cell("at", "Nozzle"),
      {
        key: "pullRadius",
        label: "Pull radius",
        kind: "number",
        default: 3.0,
        min: 1,
        max: 6,
        step: 0.1,
      },
      {
        key: "pullStrength",
        label: "Pull strength",
        kind: "number",
        default: 14,
        min: 2,
        max: 30,
        step: 0.5,
      },
      {
        key: "killRadius",
        label: "Kill radius",
        kind: "number",
        default: 0.4,
        min: 0.2,
        max: 0.8,
        step: 0.05,
      },
      { key: "onTime", label: "On time", kind: "number", default: 0, min: 0, max: 10, step: 0.1 },
      { key: "offTime", label: "Off time", kind: "number", default: 0, min: 0, max: 10, step: 0.1 },
      { key: "phase", label: "Phase", kind: "number", default: 0, min: 0, max: 10, step: 0.1 },
    ],
    footprint: (e) => [(e as { at: Cell }).at],
    groundCells: (e) => [(e as { at: Cell }).at],
  },
  hammer: {
    type: "hammer",
    label: "Hammer",
    glyph: "⌂",
    params: [
      cell("at", "Cell"),
      { key: "period", label: "Period", kind: "number", default: 2.4, min: 1, max: 6, step: 0.1 },
      { key: "phase", label: "Phase", kind: "number", default: 0, min: 0, max: 6, step: 0.01 },
    ],
    footprint: (e) => [(e as { at: Cell }).at],
    groundCells: (e) => [(e as { at: Cell }).at],
  },
  catapult: {
    type: "catapult",
    label: "Catapult",
    glyph: "⇑",
    params: [
      cell("at", "Pad"),
      { key: "launch", label: "Launch velocity", kind: "vec3", required: true },
      {
        key: "windup",
        label: "Windup",
        kind: "number",
        default: 0.3,
        min: 0.1,
        max: 1,
        step: 0.05,
      },
    ],
    footprint: (e) => [(e as { at: Cell }).at],
    groundCells: (e) => [(e as { at: Cell }).at],
  },
  wave: {
    type: "wave",
    label: "Wave floor",
    glyph: "~",
    params: [
      { key: "rect", label: "Region", kind: "rect", required: true },
      {
        key: "amplitude",
        label: "Amplitude",
        kind: "number",
        default: 0.35,
        min: 0.05,
        max: 1,
        step: 0.05,
      },
      {
        key: "wavelength",
        label: "Wavelength",
        kind: "number",
        default: 3.5,
        min: 1,
        max: 10,
        step: 0.1,
      },
      { key: "speed", label: "Speed", kind: "number", default: 2, min: 0, max: 5, step: 0.1 },
      { key: "dir", label: "Direction", kind: "vec2", default: [1, 0] },
    ],
    footprint: () => [],
    groundCells: () => [],
  },
  platform: {
    type: "platform",
    label: "Moving platform",
    glyph: "▭",
    params: [
      cell("at", "Origin"),
      { key: "size", label: "Size", kind: "size", default: [2, 2], min: 1, max: 4 },
      {
        key: "top",
        label: "Top (half-units)",
        kind: "int",
        required: true,
        min: 0,
        max: 35,
        step: 1,
      },
      { key: "path", label: "Path", kind: "path", required: true, minItems: 2, maxItems: 8 },
      { key: "speed", label: "Speed", kind: "number", default: 2, min: 0.5, max: 6, step: 0.1 },
      { key: "pause", label: "Pause", kind: "number", default: 1, min: 0, max: 3, step: 0.1 },
      { key: "phase", label: "Phase", kind: "number", default: 0, min: 0, max: 1, step: 0.01 },
    ],
    footprint: (e) => {
      const p = e as { path?: Cell[]; size?: [number, number]; at: Cell };
      return platformSweptCells(p.path && p.path.length ? p.path : [p.at], p.size ?? [2, 2]);
    },
    groundCells: () => [],
  },
  pipe: {
    type: "pipe",
    label: "Pipe",
    glyph: "◎",
    params: [
      cell("entry", "Entry"),
      cell("exit", "Exit"),
      {
        key: "exitVelocity",
        label: "Exit velocity",
        kind: "vec3",
        default: [0, 2, 0],
        min: -12,
        max: 12,
      },
      {
        key: "travelTime",
        label: "Travel time",
        kind: "number",
        default: 1.2,
        min: 0.3,
        max: 4,
        step: 0.1,
      },
    ],
    footprint: (e) => [(e as { entry: Cell }).entry, (e as { exit: Cell }).exit],
    groundCells: (e) => [(e as { entry: Cell }).entry],
  },
  funnel: {
    type: "funnel",
    label: "Funnel",
    glyph: "◉",
    params: [
      cell("at", "Centre"),
      { key: "radius", label: "Radius", kind: "number", default: 2.5, min: 1, max: 5, step: 0.1 },
      { key: "depth", label: "Depth", kind: "number", default: 1.5, min: 0.5, max: 3, step: 0.1 },
      cell("exit", "Exit"),
      {
        key: "exitVelocity",
        label: "Exit velocity",
        kind: "vec3",
        default: [0, 2, 0],
        min: -12,
        max: 12,
      },
      {
        key: "travelTime",
        label: "Travel time",
        kind: "number",
        default: 1.0,
        min: 0.3,
        max: 4,
        step: 0.1,
      },
    ],
    footprint: (e) => {
      const f = e as { at: Cell; radius?: number; exit: Cell };
      return [...funnelCells(f.at, f.radius ?? 2.5), f.exit];
    },
    groundCells: (e) => [(e as { at: Cell }).at],
  },
};

/** Checkpoint param spec (checkpoints are a separate list, but share the inspector). */
export const CHECKPOINT_PARAMS: ParamSpec[] = [
  cell("at", "Cell"),
  { key: "radius", label: "Radius", kind: "number", default: 1.0, min: 0.5, max: 3, step: 0.1 },
  { key: "respawnAt", label: "Respawn at", kind: "cell" },
];

export function defaultEntity(type: EntityType, at: Cell): EntitySource {
  const [x, y] = at;
  switch (type) {
    case "steelie":
      return { type, at: [x, y] };
    case "muncher":
      return { type, at: [x, y] };
    case "hoover":
      return { type, at: [x, y] };
    case "hammer":
      return { type, at: [x, y] };
    case "catapult":
      return { type, at: [x, y], launch: [0, 6, 6] };
    case "wave":
      return { type, rect: [x, y, x + 3, y + 3] as Rect };
    case "platform":
      return {
        type,
        at: [x, y],
        top: 10,
        path: [
          [x, y],
          [x + 3, y],
        ],
      };
    case "pipe":
      return { type, entry: [x, y], exit: [x + 2, y + 2] };
    case "funnel":
      return { type, at: [x, y], exit: [x, y + 4] };
  }
}
