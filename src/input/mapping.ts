import { quantizeInput } from "../sim/quantize";
import type { InputFrame } from "../sim/types";
import type { KeyboardMapping, StickVector } from "./types";

/** Screen stick (x right+, y down+) → world input, rotated 45° so "up" rolls up the screen (§7.6). */
export function screenToWorld(sx: number, sy: number): StickVector {
  return { x: (sx + sy) * Math.SQRT1_2, y: (sy - sx) * Math.SQRT1_2 };
}

/** Inverse of {@link screenToWorld}. */
export function worldToScreen(wx: number, wy: number): StickVector {
  return { x: (wx - wy) * Math.SQRT1_2, y: (wx + wy) * Math.SQRT1_2 };
}

/** Alias kept for the layout in PLAN §4. */
export const isoRotate = screenToWorld;

/** Keyboard vectors bypass the rotation in "world" mapping. */
export function keyboardToWorld(v: StickVector, mapping: KeyboardMapping): StickVector {
  return mapping === "world" ? { x: v.x, y: v.y } : screenToWorld(v.x, v.y);
}

export function magnitude(v: StickVector): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function clampDisk(x: number, y: number): StickVector {
  const m = Math.sqrt(x * x + y * y);
  return m > 1 ? { x: x / m, y: y / m } : { x, y };
}

/** Radial dead zone rescaled linearly so output magnitude runs 0..1 from `dz` to 1. */
export function radialDeadzone(x: number, y: number, dz: number): StickVector {
  const m = Math.sqrt(x * x + y * y);
  if (m <= dz || m === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}

/** The vector with the largest magnitude; earlier entries win ties. */
export function largestMagnitude(vectors: readonly StickVector[]): StickVector {
  let best: StickVector = { x: 0, y: 0 };
  let bestM2 = 0;
  for (const v of vectors) {
    const m2 = v.x * v.x + v.y * v.y;
    if (m2 > bestM2) {
      best = v;
      bestM2 = m2;
    }
  }
  return best;
}

/** Every frame handed to the sim goes through this. */
export function toInputFrame(world: StickVector): InputFrame {
  return quantizeInput(world.x, world.y);
}
