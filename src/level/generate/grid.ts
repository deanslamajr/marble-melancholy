// A mutable cell grid for composing courses from segments, encoded as source layers (§5.2).
// Pure and YAML-free so generation can run anywhere; the layers go through the normal pipeline.
import type { LevelSource } from "../types";

export type SlopeChar = "." | "N" | "E" | "S" | "W" | "n" | "e" | "s" | "w";
export type SurfaceChar = "." | "i" | "a" | "^" | ">" | "v" | "<";

export const EDGE = { N: 1, E: 2, S: 4, W: 8 } as const;

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

  /** Flat ground at `h` over the inclusive rect; clears slope and surface. */
  fill(x0: number, y0: number, x1: number, y1: number, h: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.inside(x, y)) continue;
        const i = this.idx(x, y);
        this.heights[i] = h;
        this.slopes[i] = ".";
        this.surfaces[i] = ".";
      }
  }

  /**
   * A ramp descending south over rows y0..y0+rows-1 starting at high edge `hTop`.
   * Returns the height of the flat ground that should follow it.
   */
  rampS(x0: number, x1: number, y0: number, rows: number, hTop: number, steep: boolean): number {
    const step = steep ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      this.fill(x0, y0 + r, x1, y0 + r, hTop - r * step);
      for (let x = x0; x <= x1; x++) this.slopes[this.idx(x, y0 + r)] = steep ? "s" : "S";
    }
    return hTop - rows * step;
  }

  /** A ramp descending east over columns x0..x0+cols-1. Returns the following flat height. */
  rampE(y0: number, y1: number, x0: number, cols: number, hTop: number, steep: boolean): number {
    const step = steep ? 2 : 1;
    for (let c = 0; c < cols; c++) {
      this.fill(x0 + c, y0, x0 + c, y1, hTop - c * step);
      for (let y = y0; y <= y1; y++) this.slopes[this.idx(x0 + c, y)] = steep ? "e" : "E";
    }
    return hTop - cols * step;
  }

  surface(x0: number, y0: number, x1: number, y1: number, s: SurfaceChar): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (this.isGround(x, y)) this.surfaces[this.idx(x, y)] = s;
  }

  void(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!this.inside(x, y)) continue;
        const i = this.idx(x, y);
        this.heights[i] = -1;
        this.slopes[i] = ".";
        this.surfaces[i] = ".";
        this.walls[i] = 0;
      }
  }

  /** Mark edges of every cell in the rect as open (never railed). */
  openEdges(x0: number, y0: number, x1: number, y1: number, bits: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (this.inside(x, y)) this.open[this.idx(x, y)]! |= bits;
  }

  rail(x0: number, y0: number, x1: number, y1: number, bits: number): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (this.isGround(x, y)) this.walls[this.idx(x, y)]! |= bits;
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
    const out = new CourseGrid(this.width, rows);
    const n = this.width * rows;
    for (let i = 0; i < n; i++) {
      out.heights[i] = this.heights[i]!;
      out.slopes[i] = this.slopes[i]!;
      out.surfaces[i] = this.surfaces[i]!;
      out.walls[i] = this.walls[i]!;
      out.open[i] = this.open[i]!;
    }
    return out;
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
