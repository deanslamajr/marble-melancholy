// Palettes live in src/level/themes.ts (single source of truth); render adds colour math only.
export { THEMES, resolveTheme } from "../level/themes";

export const PLAYER_COLORS = ["#2f6df6", "#f29a2e"] as const;
export const STEELIE_COLOR = "#202024";
export const ACID_COLOR = "#3fae4a";
export const ACID_DARK = "#2c8a37";
export const MUNCHER_LIGHT = "#4caf50";
export const MUNCHER_DARK = "#2e7d32";
export const NEUTRAL_FLAG = "#9a9a9a";

export function playerColor(index: number): string {
  return PLAYER_COLORS[index === 1 ? 1 : 0];
}

export function parseHex(hex: string): [number, number, number] {
  let h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function c255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function rgba(r: number, g: number, b: number, a = 1): string {
  return a >= 1
    ? `rgb(${c255(r)},${c255(g)},${c255(b)})`
    : `rgba(${c255(r)},${c255(g)},${c255(b)},${a < 0 ? 0 : a.toFixed(3)})`;
}

/** Multiply a colour by f (f > 1 brightens). */
export function scaleColor(hex: string, f: number): string {
  const [r, g, b] = parseHex(hex);
  return rgba(r * f, g * f, b * f);
}

export function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return rgba(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function lighten(hex: string, t: number): string {
  return mixColor(hex, "#ffffff", t);
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return rgba(r, g, b, a);
}

/** Hex output so results can be fed back into the helpers above. */
export function toHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) | (c255(r) << 16) | (c255(g) << 8) | c255(b)).toString(16).slice(1);
}

export function scaleHex(hex: string, f: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * f, g * f, b * f);
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

const SHADE_STEPS = 64;
const shadeCache = new Map<string, string[]>();

/** scaleColor quantised to 1/64 steps and memoised (per-frame dynamic cells avoid string churn). */
export function shadeCached(hex: string, f: number): string {
  let row = shadeCache.get(hex);
  if (!row) {
    row = [];
    shadeCache.set(hex, row);
  }
  const q = Math.max(0, Math.min(SHADE_STEPS * 2, Math.round(f * SHADE_STEPS)));
  let s = row[q];
  if (s === undefined) {
    s = scaleColor(hex, q / SHADE_STEPS);
    row[q] = s;
  }
  return s;
}
