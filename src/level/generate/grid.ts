// A mutable cell grid for composing courses from segments, encoded as source layers (§5.2).
// Pure and YAML-free so generation can run anywhere; the layers go through the normal pipeline.
import type { LevelSource } from "../types";

export type SlopeChar = "." | "N" | "E" | "S" | "W" | "n" | "e" | "s" | "w";
export type SurfaceChar = "." | "i" | "a" | "^" | ">" | "v" | "<";

export const EDGE = { N: 1, E: 2, S: 4, W: 8 } as const;

/** Compass heading: 0 N, 1 E, 2 S, 3 W (y grows southward). */
export type Dir = 0 | 1 | 2 | 3;
export const N: Dir = 0;
export const E: Dir = 1;
export const S: Dir = 2;
export const W: Dir = 3;
export const DV: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
export const DIR_BIT: readonly number[] = [EDGE.N, EDGE.E, EDGE.S, EDGE.W];
/** Slope characters descending toward each heading (gentle, steep). */
export const SLOPE_TO: readonly SlopeChar[] = ["N", "E", "S", "W"];
export const STEEP_TO: readonly SlopeChar[] = ["n", "e", "s", "w"];
/** Speed-strip characters pushing toward each heading. */
export const ARROW_TO: readonly SurfaceChar[] = ["^", ">", "v", "<"];

export function turnDir(d: Dir, k: number): Dir {
  return ((d + k) & 3) as Dir;
}

const DIRS: ReadonlyArray<[bit: number, dx: number, dy: number]> = [
  [EDGE.N, 0, -1],
  [EDGE.E, 1, 0],
  [EDGE.S, 0, 1],
  [EDGE.W, -1, 0],
];

function heightChar(h: number): string {
  if (h < 0) return ".";
  if (h < 10) return String(h);
  return String.fromCharCode(65 + h - 10);
}

export class CourseGrid {
  readonly heights: number[];
  readonly slopes: SlopeChar[];
  readonly surfaces: SurfaceChar[];
  readonly walls: number[];
  /** Edges `autoRails` must leave open (jump gaps, catapult launches). */
  readonly open: number[];
  /** Which layout piece wrote each ground cell (-1 for void). */
  readonly owner: number[];
  /** Undo log for `begin`/`rollback`: cell index followed by its previous state. */
  private journal: Array<[number, number, SlopeChar, SurfaceChar, number, number, number]> | null =
    null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.heights = new Array<number>(n).fill(-1);
    this.slopes = new Array<SlopeChar>(n).fill(".");
    this.surfaces = new Array<SurfaceChar>(n).fill(".");
    this.walls = new Array<number>(n).fill(0);
    this.open = new Array<number>(n).fill(0);
    this.owner = new Array<number>(n).fill(-1);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  heightAt(x: number, y: number): number {
    return this.inside(x, y) ? this.heights[this.idx(x, y)]! : -1;
  }

  isGround(x: number, y: number): boolean {
    return this.heightAt(x, y) >= 0;
  }

  // ---------- undo log ----------

  begin(): void {
    this.journal = [];
  }

  commit(): void {
    this.journal = null;
  }

  rollback(): void {
    const j = this.journal;
    if (!j) return;
    for (let k = j.length - 1; k >= 0; k--) {
      const [i, h, s, f, w, o, ow] = j[k]!;
      this.heights[i] = h;
      this.slopes[i] = s;
      this.surfaces[i] = f;
      this.walls[i] = w;
      this.open[i] = o;
      this.owner[i] = ow;
    }
    this.journal = null;
  }

  private touch(i: number): void {
    this.journal?.push([
      i,
      this.heights[i]!,
      this.slopes[i]!,
      this.surfaces[i]!,
      this.walls[i]!,
      this.open[i]!,
      this.owner[i]!,
    ]);
  }

  // ---------- cell writes ----------

  /** Flat ground at `h` on one cell, owned by `piece`; clears slope and surface. */
  setGround(x: number, y: number, h: number, piece = -1): void {
    if (!this.inside(x, y)) return;
    const i = this.idx(x, y);
    this.touch(i);
    this.heights[i] = h;
    this.slopes[i] = ".";
    this.surfaces[i] = ".";
    this.owner[i] = piece;
  }

  setSlope(x: number, y: number, s: SlopeChar): void {
    if (!this.isGround(x, y)) return;
    const i = this.idx(x, y);
    this.touch(i);
    this.slopes[i] = s;
  }

  /** Flat ground at `h` over the inclusive rect; clears slope and surface. */
  fill(x0: number, y0: number, x1: number, y1: number, h: number): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.setGround(x, y, h);
  }

  /**
   * A ramp descending south over rows y0..y0+rows-1 starting at high edge `hTop`.
   * Returns the height of the flat ground that should follow it.
   */
  rampS(x0: number, x1: number, y0: number, rows: number, hTop: number, steep: boolean): number {
    const step = steep ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      this.fill(x0, y0 + r, x1, y0 + r, hTop - r * step);
      for (let x = x0; x <= x1; x++) this.setSlope(x, y0 + r, steep ? "s" : "S");
    }
    return hTop - rows * step;
  }

  /** A ramp descending east over columns x0..x0+cols-1. Returns the following flat height. */
  rampE(y0: number, y1: number, x0: number, cols: number, hTop: number, steep: boolean): number {
    const step = steep ? 2 : 1;
    for (let c = 0; c < cols; c++) {
      this.fill(x0 + c, y0, x0 + c, y1, hTop - c * step);
      for (let y = y0; y <= y1; y++) this.setSlope(x0 + c, y, steep ? "e" : "E");
    }
    return hTop - cols * step;
  }

  surface(x0: number, y0: number, x1: number, y1: number, s: SurfaceChar): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.isGround(x, y)) continue;
        const i = this.idx(x, y);
        this.touch(i);
        this.surfaces[i] = s;
      }
  }

  void(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.inside(x, y)) continue;
        const i = this.idx(x, y);
        this.touch(i);
        this.heights[i] = -1;
        this.slopes[i] = ".";
        this.surfaces[i] = ".";
        this.walls[i] = 0;
        this.owner[i] = -1;
      }
  }

  /** Mark edges of every cell in the rect as open (never railed). */
  openEdges(x0: number, y0: number, x1: number, y1: number, bits: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.inside(x, y)) continue;
        const i = this.idx(x, y);
        this.touch(i);
        this.open[i]! |= bits;
      }
  }

  rail(x0: number, y0: number, x1: number, y1: number, bits: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.isGround(x, y)) continue;
        const i = this.idx(x, y);
        this.touch(i);
        this.walls[i]! |= bits;
      }
  }

  /** Rails on every ground edge that faces void or the grid border, except open edges. */
  autoRails(): void {
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (!this.isGround(x, y)) continue;
        const i = this.idx(x, y);
        for (const [bit, dx, dy] of DIRS) {
          if ((this.open[i]! & bit) !== 0) continue;
          if (!this.isGround(x + dx, y + dy)) this.walls[i]! |= bit;
        }
      }
  }

  /** A copy holding only the first `rows` rows. */
  cropRows(rows: number): CourseGrid {
    return this.crop(0, 0, this.width, rows);
  }

  /** A `w`×`h` copy whose cell (0, 0) is this grid's (x0, y0). */
  crop(x0: number, y0: number, w: number, h: number): CourseGrid {
    const out = new CourseGrid(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!this.inside(x0 + x, y0 + y)) continue;
        const i = this.idx(x0 + x, y0 + y);
        const o = out.idx(x, y);
        out.heights[o] = this.heights[i]!;
        out.slopes[o] = this.slopes[i]!;
        out.surfaces[o] = this.surfaces[i]!;
        out.walls[o] = this.walls[i]!;
        out.open[o] = this.open[i]!;
        out.owner[o] = this.owner[i]!;
      }
    return out;
  }

  /** Inclusive bounds of all ground cells, or null for an empty grid. */
  bounds(): [x0: number, y0: number, x1: number, y1: number] | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (this.heights[this.idx(x, y)]! < 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    return x1 < 0 ? null : [x0, y0, x1, y1];
  }

  groundCount(): number {
    return this.heights.reduce((n, h) => n + (h >= 0 ? 1 : 0), 0);
  }

  /** Source layers; optional layers are omitted when empty. */
  toLayers(): LevelSource["layers"] {
    const rows = (cell: (i: number) => string): string => {
      const out: string[] = [];
      for (let y = 0; y < this.height; y++) {
        let row = "";
        for (let x = 0; x < this.width; x++) row += cell(this.idx(x, y));
        out.push(row);
      }
      return out.join("\n") + "\n";
    };
    const layers: LevelSource["layers"] = { heights: rows((i) => heightChar(this.heights[i]!)) };
    if (this.slopes.some((s) => s !== ".")) layers.slopes = rows((i) => this.slopes[i]!);
    if (this.surfaces.some((s) => s !== ".")) layers.surfaces = rows((i) => this.surfaces[i]!);
    if (this.walls.some((w) => w !== 0))
      layers.walls = rows((i) =>
        this.walls[i] === 0 ? "." : this.walls[i]!.toString(16).toUpperCase(),
      );
    return layers;
  }
}
