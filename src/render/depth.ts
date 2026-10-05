// Painter's-order anchor for spheres (marbles, steelies) against cached terrain strips (§7.11, R02).
import { type CellEnv, sampleZ } from "./draw/cell";

const EPS = 0.05;

/**
 * Strip after which a sphere of radius `r` with its lowest point at (x, y, z) is drawn: its own
 * cell's strip, bumped one cell toward the viewer on each axis where it overhangs a neighbour that
 * cannot hide it. Strip k + 1 is drawn after the sphere, so a neighbour it overhangs must stay
 * below the sight line: view rays rise one unit per unit travelled toward the viewer (+x, +y),
 * steeper than any ramp, so only the neighbour's height on the shared edge matters, not its
 * highest corner (which, on a ramp rising toward the viewer, is always above the marble).
 */
export function sphereAnchor(
  env: CellEnv,
  x: number,
  y: number,
  z: number,
  r: number,
  tick: number,
): number {
  const ax = Math.floor(x);
  const ay = Math.floor(y);
  const fx = x - ax;
  const fy = y - ay;
  const bx = fx + r > 1 && belowSight(env, ax + 1, ay, 0, clamp01(fy), z + (1 - fx), tick);
  const by = fy + r > 1 && belowSight(env, ax, ay + 1, clamp01(fx), 0, z + (1 - fy), tick);
  if (bx && by && !belowSight(env, ax + 1, ay + 1, 0, 0, z + Math.min(1 - fx, 1 - fy), tick)) {
    return ax + ay + 1;
  }
  return ax + ay + (bx ? 1 : 0) + (by ? 1 : 0);
}

/** True if cell (cx, cy) at fraction (fx, fy) is void, off-grid, or no higher than `sight`. */
function belowSight(
  env: CellEnv,
  cx: number,
  cy: number,
  fx: number,
  fy: number,
  sight: number,
  tick: number,
): boolean {
  if (cx < 0 || cy < 0 || cx >= env.W || cy >= env.H) return true;
  const i = cy * env.W + cx;
  if (env.heights[i]! < 0) return true;
  return sampleZ(env, i, cx, cy, fx, fy, tick, true) <= sight + EPS;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
