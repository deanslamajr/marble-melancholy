// Circle vs wall segments, sphere vs sphere (§7.5).
import {
  CLACK_MIN_IMPACT,
  MARBLE_RADIUS,
  RAIL_HEIGHT,
  WALL_RESTITUTION,
  WALL_STEP_THRESHOLD,
} from "./constants";
import type { Edge, Terrain } from "./terrain";

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface WallBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

/** Entities contributing wall segments (platform sides, lowered hammers). */
export interface WallProvider {
  wallSegments(x: number, y: number, z: number, out: Segment[]): void;
}

const scratch: Segment[] = [];

/**
 * Resolve one pass of wall collisions for a marble. Returns the largest normal impact speed
 * (for clack events), or 0.
 */
export function resolveWalls(
  m: WallBody,
  terrain: Terrain,
  providers: readonly WallProvider[],
  tick: number,
): number {
  const R = MARBLE_RADIUS;
  const cx = Math.floor(m.x);
  const cy = Math.floor(m.y);
  let maxImpact = 0;

  // Vertical edges x = X between (X-1, Y) and (X, Y).
  for (let Y = cy - 1; Y <= cy + 1; Y++) {
    for (let X = cx - 1; X <= cx + 2; X++) {
      const dx = m.x - X;
      if (dx > R || dx < -R) continue;
      if (m.y < Y - R || m.y > Y + 1 + R) continue;
      const left = m.x < X;
      const ax = left ? X - 1 : X;
      const bx = left ? X : X - 1;
      const edgeA: Edge = left ? 1 : 3;
      const edgeB: Edge = left ? 3 : 1;
      const t = clamp01(m.y - Y);
      if (isWallEdge(terrain, m.z, ax, Y, bx, Y, edgeA, edgeB, t, tick)) {
        const imp = pushOut(m, X, Y, X, Y + 1, left ? -1 : 1, 0);
        if (imp > maxImpact) maxImpact = imp;
      }
    }
  }
  // Horizontal edges y = Y between (X, Y-1) and (X, Y).
  for (let X = cx - 1; X <= cx + 1; X++) {
    for (let Y = cy - 1; Y <= cy + 2; Y++) {
      const dy = m.y - Y;
      if (dy > R || dy < -R) continue;
      if (m.x < X - R || m.x > X + 1 + R) continue;
      const above = m.y < Y;
      const ay = above ? Y - 1 : Y;
      const by = above ? Y : Y - 1;
      const edgeA: Edge = above ? 2 : 0;
      const edgeB: Edge = above ? 0 : 2;
      const t = clamp01(m.x - X);
      if (isWallEdge(terrain, m.z, X, ay, X, by, edgeA, edgeB, t, tick)) {
        const imp = pushOut(m, X, Y, X + 1, Y, 0, above ? -1 : 1);
        if (imp > maxImpact) maxImpact = imp;
      }
    }
  }

  for (const p of providers) {
    scratch.length = 0;
    p.wallSegments(m.x, m.y, m.z, scratch);
    for (const s of scratch) {
      const imp = pushOut(m, s.ax, s.ay, s.bx, s.by, 0, 0);
      if (imp > maxImpact) maxImpact = imp;
    }
  }
  return maxImpact >= CLACK_MIN_IMPACT ? maxImpact : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function isWallEdge(
  terrain: Terrain,
  z: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  edgeA: Edge,
  edgeB: Edge,
  t: number,
  tick: number,
): boolean {
  const aVoid = terrain.isVoid(ax, ay);
  const bVoid = terrain.isVoid(bx, by);
  if (aVoid && bVoid) return false;
  const hb = bVoid ? null : terrain.edgeHeight(bx, by, edgeB, t, tick);
  const ha = aVoid ? null : terrain.edgeHeight(ax, ay, edgeA, t, tick);
  // Compare against the marble's own surface at the edge, so climbing a ramp is not a step (DECISIONS M08).
  const ref = ha !== null && ha > z ? ha : z;
  if (hb !== null && hb > ref + WALL_STEP_THRESHOLD) return true;
  const explicit = aVoid ? terrain.isWall(bx, by, edgeB) : terrain.isWall(ax, ay, edgeA);
  if (explicit) {
    const base = Math.max(ha ?? -Infinity, hb ?? -Infinity);
    if (z < base + RAIL_HEIGHT) return true;
  }
  return false;
}

/**
 * Push a circle out of a segment and reflect its velocity. (fnx, fny) is a fallback normal
 * used when the centre lies exactly on the segment. Returns the normal impact speed.
 */
export function pushOut(
  m: WallBody,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  fnx: number,
  fny: number,
): number {
  const R = MARBLE_RADIUS;
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let u = len2 > 0 ? ((m.x - ax) * ex + (m.y - ay) * ey) / len2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const px = ax + ex * u;
  const py = ay + ey * u;
  let nx = m.x - px;
  let ny = m.y - py;
  const d = Math.sqrt(nx * nx + ny * ny);
  if (d >= R) return 0;
  if (d > 1e-9) {
    nx /= d;
    ny /= d;
  } else if (fnx !== 0 || fny !== 0) {
    nx = fnx;
    ny = fny;
  } else {
    return 0;
  }
  m.x += nx * (R - d);
  m.y += ny * (R - d);
  const vn = m.vx * nx + m.vy * ny;
  if (vn < 0) {
    m.vx -= (1 + WALL_RESTITUTION) * vn * nx;
    m.vy -= (1 + WALL_RESTITUTION) * vn * ny;
    return -vn;
  }
  return 0;
}

export interface SphereBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

/**
 * Sphere–sphere collision in the horizontal plane. invMassB = 0 makes B kinematic.
 * Returns the approach speed (0 when not colliding).
 */
export function collideSpheres(
  a: SphereBody,
  b: SphereBody,
  rSum: number,
  invMassA: number,
  invMassB: number,
  restitution: number,
): number {
  const dz = a.z - b.z;
  if (dz > rSum || dz < -rSum) return 0;
  let nx = a.x - b.x;
  let ny = a.y - b.y;
  const d = Math.sqrt(nx * nx + ny * ny);
  if (d >= rSum) return 0;
  if (d > 1e-9) {
    nx /= d;
    ny /= d;
  } else {
    nx = 1;
    ny = 0;
  }
  const invSum = invMassA + invMassB;
  if (invSum <= 0) return 0;
  const overlap = rSum - d;
  a.x += nx * overlap * (invMassA / invSum);
  a.y += ny * overlap * (invMassA / invSum);
  b.x -= nx * overlap * (invMassB / invSum);
  b.y -= ny * overlap * (invMassB / invSum);
  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vn >= 0) return 0;
  const j = (-(1 + restitution) * vn) / invSum;
  a.vx += j * invMassA * nx;
  a.vy += j * invMassA * ny;
  b.vx -= j * invMassB * nx;
  b.vy -= j * invMassB * ny;
  return -vn;
}
