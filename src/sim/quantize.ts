import { clampToUnitDisk } from "../core/dmath";
import type { InputFrame } from "./types";

/** Quantize one axis in [-1, 1] to an int8 step −127..127. */
export function quantizeAxis(v: number): number {
  const q = Math.round(v * 127);
  return q < -127 ? -127 : q > 127 ? 127 : q;
}

/** Clamp to unit disk and quantize both axes; returns the integer pair. */
export function quantizeInt(ax: number, ay: number): [number, number] {
  const [cx, cy] = clampToUnitDisk(ax, ay);
  let qx = quantizeAxis(cx);
  let qy = quantizeAxis(cy);
  // Rounding can push the vector just outside the disk; pull it back in deterministically.
  while (qx * qx + qy * qy > 127 * 127) {
    if (Math.abs(qx) >= Math.abs(qy)) qx -= Math.sign(qx);
    else qy -= Math.sign(qy);
  }
  return [qx, qy];
}

/** The exact input the sim sees for live play, autopilot and replays alike. */
export function quantizeInput(ax: number, ay: number): InputFrame {
  const [qx, qy] = quantizeInt(ax, ay);
  return { ax: qx / 127, ay: qy / 127 };
}

export function dequantize(qx: number, qy: number): InputFrame {
  return { ax: qx / 127, ay: qy / 127 };
}
