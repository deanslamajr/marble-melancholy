import { cornerZ } from "../sim/terrainMath";
import type { LevelBounds } from "./types";

/**
 * Iso-projected extent at zoom 1 (§7.7): all non-void cell top corners plus side faces extended
 * 2.5 units down. Projection: sx = (x − y)·32, sy = (x + y)·16 − z·32.
 */
export function computeBounds(level: {
  grid: { width: number; height: number };
  cells: { heights: readonly number[]; slopes: readonly number[] };
}): LevelBounds {
  const W = level.grid.width;
  const H = level.grid.height;
  let minSx = Infinity;
  let minSy = Infinity;
  let maxSx = -Infinity;
  let maxSy = -Infinity;
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      const h = level.cells.heights[i]!;
      if (h < 0) continue;
      const zs = cornerZ(h, level.cells.slopes[i]!);
      const xs = [cx, cx + 1, cx + 1, cx];
      const ys = [cy, cy, cy + 1, cy + 1];
      for (let k = 0; k < 4; k++) {
        const sx = (xs[k]! - ys[k]!) * 32;
        const base = (xs[k]! + ys[k]!) * 16;
        const top = base - zs[k]! * 32;
        const bottom = base - (zs[k]! - 2.5) * 32;
        if (sx < minSx) minSx = sx;
        if (sx > maxSx) maxSx = sx;
        if (top < minSy) minSy = top;
        if (bottom > maxSy) maxSy = bottom;
      }
    }
  }
  if (minSx === Infinity) return { minSx: 0, minSy: 0, maxSx: 0, maxSy: 0 };
  return { minSx, minSy, maxSx, maxSy };
}
