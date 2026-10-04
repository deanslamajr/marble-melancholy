// Pure terrain formulas shared by sim, level compiler and renderer (§5.2, §7.3).
import { dcos, dsin, TWO_PI } from "../core/dmath";
import type { CompiledFunnel, CompiledWave } from "../level/types";
import { DT } from "./constants";

/** Drop across the cell for a slope code (0 flat, 1–4 gentle N/E/S/W, 5–8 steep n/e/s/w). */
export function slopeDrop(slope: number): number {
  if (slope === 0) return 0;
  return slope <= 4 ? 0.5 : 1.0;
}

/** Direction of descent: 1 N, 2 E, 3 S, 4 W (0 flat). */
export function slopeDir(slope: number): number {
  if (slope === 0) return 0;
  return slope <= 4 ? slope : slope - 4;
}

/**
 * Height of a base cell at fractional position (fx, fy) ∈ [0,1]².
 * hRaw is the height (half-units) of the high edge.
 */
export function cellZ(hRaw: number, slope: number, fx: number, fy: number): number {
  const top = hRaw * 0.5;
  const drop = slopeDrop(slope);
  switch (slopeDir(slope)) {
    case 1:
      return top - drop * (1 - fy);
    case 2:
      return top - drop * fx;
    case 3:
      return top - drop * fy;
    case 4:
      return top - drop * (1 - fx);
    default:
      return top;
  }
}

/** Gradient (dz/dx, dz/dy) of a base cell. */
export function cellGradient(slope: number): [number, number] {
  const drop = slopeDrop(slope);
  switch (slopeDir(slope)) {
    case 1:
      return [0, drop];
    case 2:
      return [-drop, 0];
    case 3:
      return [0, -drop];
    case 4:
      return [drop, 0];
    default:
      return [0, 0];
  }
}

/**
 * Height along a cell edge. edge: 0 N (y=cy), 1 E (x=cx+1), 2 S (y=cy+1), 3 W (x=cx).
 * t ∈ [0,1] runs west→east on N/S edges and north→south on E/W edges.
 */
export function edgeZ(hRaw: number, slope: number, edge: number, t: number): number {
  switch (edge) {
    case 0:
      return cellZ(hRaw, slope, t, 0);
    case 1:
      return cellZ(hRaw, slope, 1, t);
    case 2:
      return cellZ(hRaw, slope, t, 1);
    default:
      return cellZ(hRaw, slope, 0, t);
  }
}

/** Corner heights [NW, NE, SE, SW] of a base cell. */
export function cornerZ(hRaw: number, slope: number): [number, number, number, number] {
  return [
    cellZ(hRaw, slope, 0, 0),
    cellZ(hRaw, slope, 1, 0),
    cellZ(hRaw, slope, 1, 1),
    cellZ(hRaw, slope, 0, 1),
  ];
}

export function inRect(rect: readonly number[], x: number, y: number): boolean {
  return x >= rect[0]! && x < rect[2]! + 1 && y >= rect[1]! && y < rect[3]! + 1;
}

/** Wave height offset and gradient at (x, y) for a race tick (§7.3 step 4). */
export function waveOffset(
  w: CompiledWave,
  x: number,
  y: number,
  tick: number,
): { dz: number; gx: number; gy: number } {
  const t = tick * DT;
  const phase = (TWO_PI * (w.dir[0] * x + w.dir[1] * y - w.speed * t)) / w.wavelength;
  const dz = w.amplitude * dsin(phase);
  const g = w.amplitude * (TWO_PI / w.wavelength) * dcos(phase);
  return { dz, gx: g * w.dir[0], gy: g * w.dir[1] };
}

/** Funnel cone offset and gradient at (x, y) (§7.3 step 3). */
export function funnelOffset(
  f: CompiledFunnel,
  x: number,
  y: number,
): { dz: number; gx: number; gy: number } | null {
  const cx = f.at[0] + 0.5;
  const cy = f.at[1] + 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= f.radius) return null;
  const dz = -f.depth * (1 - d / f.radius);
  if (d < 1e-9) return { dz, gx: 0, gy: 0 };
  const s = f.depth / f.radius;
  return { dz, gx: (s * dx) / d, gy: (s * dy) / d };
}
