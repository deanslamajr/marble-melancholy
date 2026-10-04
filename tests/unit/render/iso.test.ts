import { describe, expect, it } from "vitest";
import {
  computeBounds,
  fromScreen,
  project,
  TILE_H,
  TILE_W,
  toScreen,
  unproject,
  VIEW_H,
  VIEW_W,
  Z_PX,
} from "../../../src/render/iso";

function level(width: number, height: number, heights: number[], slopes?: number[]) {
  return {
    grid: { width, height },
    cells: {
      heights,
      slopes: slopes ?? heights.map(() => 0),
      surfaces: heights.map(() => 0),
      walls: heights.map(() => 0),
      progress: heights.map(() => 0),
    },
  };
}

describe("iso projection", () => {
  it("exposes the §7.7 constants", () => {
    expect([TILE_W, TILE_H, Z_PX, VIEW_W, VIEW_H]).toEqual([64, 32, 32, 960, 540]);
  });

  it("projects per the formula", () => {
    expect(project(0, 0, 0)).toEqual({ sx: 0, sy: 0 });
    expect(project(1, 0, 0)).toEqual({ sx: 32, sy: 16 });
    expect(project(0, 1, 0)).toEqual({ sx: -32, sy: 16 });
    expect(project(2, 3, 1.5)).toEqual({ sx: -32, sy: 80 - 48 });
  });

  it("a half-unit height step is 16 px", () => {
    expect(project(4, 4, 0).sy - project(4, 4, 0.5).sy).toBe(16);
  });

  it("unproject inverts project at the given z", () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [3.25, 7.5, 0],
      [10, 2, 4.5],
      [-1, 5, 2],
    ] as const) {
      const p = project(x, y, z);
      const w = unproject(p.sx, p.sy, z);
      expect(w.x).toBeCloseTo(x, 10);
      expect(w.y).toBeCloseTo(y, 10);
    }
  });

  it("toScreen centres the camera point and scales by zoom", () => {
    const cam = { cx: 100, cy: 50, zoom: 2 };
    expect(toScreen({ sx: 100, sy: 50 }, cam)).toEqual({ X: 480, Y: 270 });
    expect(toScreen({ sx: 110, sy: 40 }, cam)).toEqual({ X: 500, Y: 250 });
    const back = fromScreen(500, 250, cam);
    expect(back.sx).toBeCloseTo(110);
    expect(back.sy).toBeCloseTo(40);
  });
});

describe("computeBounds", () => {
  it("covers top corners and faces 2.5 units down for a single flat cell", () => {
    const b = computeBounds(level(1, 1, [4]));
    // z = 2; corners (0,0),(1,0),(1,1),(0,1)
    expect(b.minSx).toBe(-32);
    expect(b.maxSx).toBe(32);
    expect(b.minSy).toBe(0 - 2 * 32);
    expect(b.maxSy).toBe(32 - (2 - 2.5) * 32);
  });

  it("ignores void cells and handles all-void levels", () => {
    expect(computeBounds(level(2, 2, [-1, -1, -1, -1]))).toEqual({
      minSx: 0,
      minSy: 0,
      maxSx: 0,
      maxSy: 0,
    });
    const b = computeBounds(level(2, 1, [-1, 0]));
    expect(b.minSx).toBe(0);
    expect(b.maxSx).toBe(64);
  });

  it("uses slope corner heights", () => {
    // Steep south slope from hRaw 4 (z 2 at north edge → 1 at south edge).
    const b = computeBounds(level(1, 1, [4], [7]));
    expect(b.minSy).toBe(-64);
    expect(b.maxSy).toBe(32 - (1 - 2.5) * 32);
  });
});
