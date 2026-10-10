import { describe, expect, it } from "vitest";
import {
  backingScale,
  computeBounds,
  fromScreen,
  project,
  TILE_H,
  TILE_W,
  toScreen,
  unproject,
  VIEW_H,
  VIEW_MAX_ASPECT,
  VIEW_MIN_ASPECT,
  VIEW_PIXEL_BUDGET,
  VIEW_W,
  viewSizeFor,
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
    const view = { w: 1296, h: 540 };
    expect(toScreen({ sx: 100, sy: 50 }, cam, view)).toEqual({ X: 648, Y: 270 });
    expect(fromScreen(648, 270, cam, view)).toEqual({ sx: 100, sy: 50 });
  });
});

describe("visible view", () => {
  it("grows the base view to the stage aspect, keeping 960×540 as the minimum", () => {
    expect(viewSizeFor(1920, 1080)).toEqual({ w: 960, h: 540 });
    expect(viewSizeFor(734, 343)).toEqual({ w: 1156, h: 540 });
    expect(viewSizeFor(1440, 900)).toEqual({ w: 960, h: 600 });
    expect(viewSizeFor(390, 520)).toEqual({ w: 960, h: 1280 });
    for (const [w, h] of [
      [734, 343],
      [863, 360],
      [1440, 900],
      [393, 524],
      [1024, 768],
    ]) {
      const v = viewSizeFor(w!, h!);
      expect(v.w).toBeGreaterThanOrEqual(VIEW_W);
      expect(v.h).toBeGreaterThanOrEqual(VIEW_H);
      expect(v.w / v.h).toBeCloseTo(w! / h!, 2);
    }
  });

  it("clamps the aspect to 3:4 … 2.4:1 and falls back to the base view without a size", () => {
    expect(viewSizeFor(3000, 360)).toEqual({ w: 1296, h: 540 });
    expect(viewSizeFor(360, 3000)).toEqual({ w: 960, h: 1280 });
    expect(viewSizeFor(0, 0)).toEqual({ w: 960, h: 540 });
    expect([VIEW_MIN_ASPECT, VIEW_MAX_ASPECT]).toEqual([0.75, 2.4]);
  });

  it("keeps the DPR cap and at most 1.35× the base view's backing pixels", () => {
    expect(backingScale({ w: 960, h: 540 }, 3)).toBe(2);
    expect(backingScale({ w: 960, h: 540 }, 1)).toBe(1);
    expect(backingScale({ w: 1296, h: 540 }, 3)).toBeCloseTo(2, 12);
    const base = 960 * 540 * 4;
    for (const v of [
      { w: 1296, h: 540 },
      { w: 960, h: 1280 },
      { w: 960, h: 960 },
    ]) {
      const s = backingScale(v, 3);
      expect(s).toBeLessThanOrEqual(2);
      expect(v.w * v.h * s * s).toBeLessThanOrEqual(base * VIEW_PIXEL_BUDGET + 1e-6);
    }
  });

  it("never gives the canvas more than 2 pixels per CSS pixel on screen (R19)", () => {
    // A portrait phone shows the 960×1280 view in a 412×549 CSS box.
    const portrait = backingScale({ w: 960, h: 1280 }, 2.625, { w: 412, h: 549 });
    expect(Math.round(960 * portrait)).toBe(824);
    // A landscape phone: 915×412 CSS for the 2.22:1 view.
    const view = viewSizeFor(915, 412);
    const landscape = backingScale(view, 2.625, { w: 915, h: 412 });
    expect(Math.round(view.w * landscape)).toBe(1830);
    // Large desktop windows keep the full budget.
    expect(backingScale({ w: 960, h: 540 }, 2, { w: 1920, h: 1080 })).toBe(2);
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
