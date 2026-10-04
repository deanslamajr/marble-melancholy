// Terrain queries (§7.3).
import type { CompiledFunnel, CompiledWave, PlayableLevel, SurfaceId } from "../level/types";
import { cellGradient, cellZ, edgeZ, funnelOffset, waveOffset } from "./terrainMath";

export interface Carrier {
  readonly index: number;
  vx: number;
  vy: number;
}

export interface Ground {
  z: number;
  surface: SurfaceId;
  /** Raw surface code (0 normal, 1 ice, 2 acid, 3–6 speed N/E/S/W). */
  surfaceCode: number;
  cx: number;
  cy: number;
  carrier: Carrier | null;
  gradX: number;
  gradY: number;
}

/** Entities that provide walkable ground (moving platforms). */
export interface GroundPatchProvider {
  groundPatch(x: number, y: number, baseZ: number | null): Ground | null;
}

export const SURFACE_IDS: readonly SurfaceId[] = [
  "normal",
  "ice",
  "acid",
  "speed",
  "speed",
  "speed",
  "speed",
];

/** Edge index: 0 N, 1 E, 2 S, 3 W. */
export type Edge = 0 | 1 | 2 | 3;
export const EDGE_BIT = [1, 2, 4, 8] as const;
export const EDGE_DX = [0, 1, 0, -1] as const;
export const EDGE_DY = [-1, 0, 1, 0] as const;
export const OPPOSITE: readonly Edge[] = [2, 3, 0, 1];

export class Terrain {
  readonly W: number;
  readonly H: number;
  readonly heights: readonly number[];
  readonly slopes: readonly number[];
  readonly surfaces: readonly number[];
  readonly walls: readonly number[];
  readonly waves: CompiledWave[];
  readonly funnels: CompiledFunnel[];
  readonly minZ: number;
  readonly maxZ: number;
  patches: GroundPatchProvider[] = [];

  constructor(level: PlayableLevel) {
    this.W = level.grid.width;
    this.H = level.grid.height;
    this.heights = level.cells.heights;
    this.slopes = level.cells.slopes;
    this.surfaces = level.cells.surfaces;
    this.walls = level.cells.walls;
    this.waves = [];
    this.funnels = [];
    for (const e of level.entities) {
      if (e.type === "wave") this.waves.push(e);
      else if (e.type === "funnel") this.funnels.push(e);
    }
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const h of this.heights) {
      if (h < 0) continue;
      minZ = Math.min(minZ, h * 0.5 - 1);
      maxZ = Math.max(maxZ, h * 0.5);
    }
    for (const e of level.entities) {
      if (e.type === "platform") maxZ = Math.max(maxZ, e.top * 0.5);
    }
    this.minZ = minZ === Infinity ? 0 : minZ;
    this.maxZ = maxZ === -Infinity ? 0 : maxZ;
  }

  index(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return -1;
    return cy * this.W + cx;
  }

  /** hRaw of a cell, -1 for void or out of bounds. */
  hRaw(cx: number, cy: number): number {
    const i = this.index(cx, cy);
    return i < 0 ? -1 : this.heights[i]!;
  }

  isVoid(cx: number, cy: number): boolean {
    return this.hRaw(cx, cy) < 0;
  }

  /** Continuous height offsets (funnel cones, wave floors) at a point. */
  offsetAt(x: number, y: number, tick: number): { dz: number; gx: number; gy: number } {
    let dz = 0;
    let gx = 0;
    let gy = 0;
    for (const f of this.funnels) {
      const o = funnelOffset(f, x, y);
      if (o) {
        dz += o.dz;
        gx += o.gx;
        gy += o.gy;
      }
    }
    for (const w of this.waves) {
      const o = waveEnvelopeOffset(w, x, y, tick);
      if (o) {
        dz += o.dz;
        gx += o.gx;
        gy += o.gy;
      }
    }
    return { dz, gx, gy };
  }

  /** Base terrain ground (no platforms). */
  baseGroundAt(x: number, y: number, tick: number): Ground | null {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const i = this.index(cx, cy);
    if (i < 0) return null;
    const h = this.heights[i]!;
    if (h < 0) return null;
    const slope = this.slopes[i]!;
    const [sgx, sgy] = cellGradient(slope);
    const off = this.offsetAt(x, y, tick);
    const sc = this.surfaces[i]!;
    return {
      z: cellZ(h, slope, x - cx, y - cy) + off.dz,
      surface: SURFACE_IDS[sc] ?? "normal",
      surfaceCode: sc,
      cx,
      cy,
      carrier: null,
      gradX: sgx + off.gx,
      gradY: sgy + off.gy,
    };
  }

  /** Ground at a point: platforms first, then base cell with offsets (§7.3). */
  groundAt(x: number, y: number, tick: number): Ground | null {
    const base = this.baseGroundAt(x, y, tick);
    for (const p of this.patches) {
      const g = p.groundPatch(x, y, base ? base.z : null);
      if (g) return g;
    }
    return base;
  }

  /** Height of a base cell along an edge at parameter t, including continuous offsets. */
  edgeHeight(cx: number, cy: number, edge: Edge, t: number, tick: number): number | null {
    const i = this.index(cx, cy);
    if (i < 0) return null;
    const h = this.heights[i]!;
    if (h < 0) return null;
    const base = edgeZ(h, this.slopes[i]!, edge, t);
    let px: number;
    let py: number;
    switch (edge) {
      case 0:
        px = cx + t;
        py = cy;
        break;
      case 1:
        px = cx + 1;
        py = cy + t;
        break;
      case 2:
        px = cx + t;
        py = cy + 1;
        break;
      default:
        px = cx;
        py = cy + t;
    }
    return base + this.offsetAt(px, py, tick).dz;
  }

  /** Explicit wall flag on either side of the edge. */
  isWall(cx: number, cy: number, edge: Edge): boolean {
    const i = this.index(cx, cy);
    if (i >= 0 && (this.walls[i]! & EDGE_BIT[edge]) !== 0) return true;
    const j = this.index(cx + EDGE_DX[edge], cy + EDGE_DY[edge]);
    if (j >= 0 && (this.walls[j]! & EDGE_BIT[OPPOSITE[edge]!]) !== 0) return true;
    return false;
  }
}

/**
 * Wave offset with an amplitude envelope that tapers to zero over one cell at the region
 * boundary, so wave floors meet neighbouring terrain without steps (DECISIONS M04).
 */
export function waveEnvelopeOffset(
  w: CompiledWave,
  x: number,
  y: number,
  tick: number,
): { dz: number; gx: number; gy: number } | null {
  const x0 = w.rect[0];
  const y0 = w.rect[1];
  const x1 = w.rect[2] + 1;
  const y1 = w.rect[3] + 1;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return null;
  const dW = x - x0;
  const dE = x1 - x;
  const dN = y - y0;
  const dS = y1 - y;
  let d = dW;
  let ex = 1;
  let ey = 0;
  if (dE < d) {
    d = dE;
    ex = -1;
    ey = 0;
  }
  if (dN < d) {
    d = dN;
    ex = 0;
    ey = 1;
  }
  if (dS < d) {
    d = dS;
    ex = 0;
    ey = -1;
  }
  const o = waveOffset(w, x, y, tick);
  if (d >= 1) return o;
  const raw = o.dz;
  return {
    dz: raw * d,
    gx: o.gx * d + raw * ex,
    gy: o.gy * d + raw * ey,
  };
}
