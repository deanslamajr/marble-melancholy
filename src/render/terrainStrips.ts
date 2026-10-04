// Diagonal terrain strips k = cx + cy, cached per zoom bucket (§7.11).
import { WALL } from "../level/types";
import { cornerZ } from "../sim/terrainMath";
import { SIDE_FADE_DEPTH } from "./iso";
import {
  type CellEnv,
  type Ctx2D,
  drawCell,
  drawRail,
  isDynamicCell,
  RAIL_HEIGHT,
} from "./draw/cell";

/** Cells per strip segment along cx; keeps cache canvases near viewport-sized. */
export const SEGMENT_CELLS = 4;
export const STRIP_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CANVAS_DIM = 8192;
const PAD = 2;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

interface CacheEntry {
  seg: Segment;
  bucket: number;
  canvas: AnyCanvas;
  bytes: number;
  scale: number;
  lastUsed: number;
}

export interface Segment {
  k: number;
  /** Static cell indices drawn in this segment. */
  cells: number[];
  /** S/E rails of strip k−1 cells, packed cellIndex * 4 + edge. */
  rails: number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cache: Map<number, CacheEntry>;
}

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function createCanvas(w: number, h: number): AnyCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

export class TerrainStrips {
  readonly kCount: number;
  readonly strips: Segment[][];
  /** Wave cells per strip, drawn live every frame. */
  readonly dynamicCells: number[][];
  /** Speed/acid cells per strip for the animated decal pass. */
  readonly decalCells: number[][];
  cacheEnabled: boolean;
  bytes = 0;
  private entries = new Set<CacheEntry>();
  private frame = 0;

  constructor(
    private readonly env: CellEnv,
    cacheEnabled = true,
  ) {
    this.cacheEnabled = cacheEnabled;
    const { W, H } = env;
    this.kCount = W + H;
    this.strips = [];
    this.dynamicCells = [];
    this.decalCells = [];
    for (let k = 0; k < this.kCount; k++) {
      this.strips.push([]);
      this.dynamicCells.push([]);
      this.decalCells.push([]);
    }
    const segMaps: Map<number, Segment>[] = this.strips.map(() => new Map());
    const segFor = (k: number, cxHost: number): Segment => {
      const m = segMaps[k]!;
      const s = Math.floor(cxHost / SEGMENT_CELLS);
      let seg = m.get(s);
      if (!seg) {
        seg = {
          k,
          cells: [],
          rails: [],
          x0: Infinity,
          y0: Infinity,
          x1: -Infinity,
          y1: -Infinity,
          cache: new Map(),
        };
        m.set(s, seg);
      }
      return seg;
    };
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cy * W + cx;
        if (env.heights[i]! < 0) continue;
        const k = cx + cy;
        const surf = env.surfaces[i] ?? 0;
        if (surf >= 2) this.decalCells[k]!.push(i);
        if (isDynamicCell(env, i)) {
          this.dynamicCells[k]!.push(i);
          continue;
        }
        const seg = segFor(k, cx);
        seg.cells.push(i);
        this.growCell(seg, i, cx, cy);
        const wb = env.walls[i] ?? 0;
        if (wb & WALL.S) {
          const rs = segFor(k + 1, cx);
          rs.rails.push(i * 4 + 2);
          this.growRail(rs, i, cx, cy);
        }
        if (wb & WALL.E) {
          const rs = segFor(k + 1, cx + 1);
          rs.rails.push(i * 4 + 1);
          this.growRail(rs, i, cx, cy);
        }
      }
    }
    for (let k = 0; k < this.kCount; k++) {
      this.strips[k] = [...segMaps[k]!.values()];
    }
  }

  private corners(i: number): [number, number, number, number] {
    const env = this.env;
    const c = cornerZ(env.heights[i]!, env.slopes[i] ?? 0);
    const fl = env.cellFunnels[i];
    if (fl) {
      let depth = 0;
      for (const f of fl) depth += env.funnels[f]!.depth;
      for (let n = 0; n < 4; n++) c[n] = c[n]! - depth;
    }
    return c;
  }

  private growCell(seg: Segment, i: number, cx: number, cy: number): void {
    const env = this.env;
    const wb = env.walls[i] ?? 0;
    const c = this.corners(i);
    const zTop = env.topMax[i]! + (wb & (WALL.N | WALL.W) ? RAIL_HEIGHT : 0) + 0.02;
    let zBot = Math.min(c[0], c[1], c[2], c[3]);
    // South face hangs from the SE/SW edge, east face from the NE/SE edge.
    zBot = Math.min(zBot, this.faceBottom(Math.min(c[2], c[3]), cx, cy + 1, 0, 1));
    zBot = Math.min(zBot, this.faceBottom(Math.min(c[1], c[2]), cx + 1, cy, 0, 3));
    grow(
      seg,
      (cx - cy - 1) * 32,
      (cx + cy) * 16 - zTop * 32,
      (cx - cy + 1) * 32,
      (cx + cy + 2) * 16 - zBot * 32,
    );
  }

  /** Lowest point of a side face whose top edge minimum is `edgeMin` (neighbour corners a, b). */
  private faceBottom(edgeMin: number, ncx: number, ncy: number, a: number, b: number): number {
    const env = this.env;
    if (ncx >= env.W || ncy >= env.H) return edgeMin - SIDE_FADE_DEPTH;
    const j = ncy * env.W + ncx;
    if (env.heights[j]! < 0) return edgeMin - SIDE_FADE_DEPTH;
    const n = this.corners(j);
    return Math.min(edgeMin, Math.min(n[a]!, n[b]!) - env.waveAmp[j]!);
  }

  private growRail(seg: Segment, i: number, cx: number, cy: number): void {
    const c = this.corners(i);
    const zTop = this.env.topMax[i]! + RAIL_HEIGHT + 0.02;
    const zBot = Math.min(c[0], c[1], c[2], c[3]);
    grow(
      seg,
      (cx - cy - 1) * 32,
      (cx + cy) * 16 - zTop * 32,
      (cx - cy + 1) * 32,
      (cx + cy + 2) * 16 - zBot * 32,
    );
  }

  /** Called once per frame before drawing strips. */
  beginFrame(): void {
    this.frame++;
  }

  /**
   * Draws the static part of strip k into `ctx` (world transform already applied), using or
   * filling the cache for `zoom`/`dpr`.
   */
  drawStrip(
    ctx: CanvasRenderingContext2D,
    k: number,
    view: ViewRect,
    zoom: number,
    dpr: number,
  ): void {
    const segs = this.strips[k];
    if (!segs) return;
    const bucket = Math.max(1, Math.round(zoom * 10));
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]!;
      if (seg.x1 < view.x0 || seg.x0 > view.x1 || seg.y1 < view.y0 || seg.y0 > view.y1) continue;
      if (!this.cacheEnabled) {
        this.renderSegment(ctx, seg);
        continue;
      }
      let e = seg.cache.get(bucket);
      if (!e) {
        const made = this.buildEntry(seg, bucket, dpr);
        if (!made) {
          this.renderSegment(ctx, seg);
          continue;
        }
        e = made;
      }
      e.lastUsed = this.frame;
      const inv = 1 / e.scale;
      ctx.drawImage(
        e.canvas as CanvasImageSource,
        seg.x0 - PAD * inv,
        seg.y0 - PAD * inv,
        e.canvas.width * inv,
        e.canvas.height * inv,
      );
    }
  }

  /** Dynamic wave cells of strip k (live heights). */
  drawDynamic(ctx: Ctx2D, k: number, view: ViewRect, tick: number): void {
    const cells = this.dynamicCells[k];
    if (!cells || cells.length === 0) return;
    const W = this.env.W;
    for (let n = 0; n < cells.length; n++) {
      const i = cells[n]!;
      const cx = i % W;
      const cy = (i - cx) / W;
      const sx = (cx - cy) * 32;
      if (sx + 40 < view.x0 || sx - 40 > view.x1) continue;
      const sy = (cx + cy + 1) * 16 - this.env.topMax[i]! * 32;
      if (sy + 140 < view.y0 || sy - 60 > view.y1) continue;
      drawCell(ctx, this.env, cx, cy, tick, true);
    }
  }

  private renderSegment(ctx: Ctx2D, seg: Segment): void {
    const env = this.env;
    const W = env.W;
    for (const packed of seg.rails) {
      const i = packed >> 2;
      const cx = i % W;
      drawRail(ctx, env, cx, (i - cx) / W, packed & 3, 0, false);
    }
    for (const i of seg.cells) {
      const cx = i % W;
      drawCell(ctx, env, cx, (i - cx) / W, 0, false);
    }
  }

  private buildEntry(seg: Segment, bucket: number, dpr: number): CacheEntry | null {
    const scale = (bucket / 10) * dpr;
    const w = Math.ceil((seg.x1 - seg.x0) * scale) + PAD * 2;
    const h = Math.ceil((seg.y1 - seg.y0) * scale) + PAD * 2;
    if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM || w <= 0 || h <= 0) return null;
    const canvas = createCanvas(w, h);
    if (!canvas) return null;
    const c = canvas.getContext("2d") as Ctx2D | null;
    if (!c) return null;
    c.setTransform(scale, 0, 0, scale, PAD - seg.x0 * scale, PAD - seg.y0 * scale);
    this.renderSegment(c, seg);
    const e: CacheEntry = { seg, bucket, canvas, bytes: w * h * 4, scale, lastUsed: this.frame };
    seg.cache.set(bucket, e);
    this.entries.add(e);
    this.bytes += e.bytes;
    if (this.bytes > STRIP_CACHE_BYTES) this.evict();
    return e;
  }

  private evict(): void {
    const sorted = [...this.entries].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of sorted) {
      if (this.bytes <= STRIP_CACHE_BYTES * 0.75) break;
      if (e.lastUsed === this.frame) break;
      this.drop(e);
    }
  }

  private drop(e: CacheEntry): void {
    e.seg.cache.delete(e.bucket);
    this.entries.delete(e);
    this.bytes -= e.bytes;
    e.canvas.width = 0;
    e.canvas.height = 0;
  }

  clear(): void {
    for (const e of [...this.entries]) this.drop(e);
    this.bytes = 0;
  }
}

function grow(seg: Segment, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < seg.x0) seg.x0 = x0;
  if (y0 < seg.y0) seg.y0 = y0;
  if (x1 > seg.x1) seg.x1 = x1;
  if (y1 > seg.y1) seg.y1 = y1;
}
