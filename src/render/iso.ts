// Isometric projection (§7.7). Pure: shared by the renderer, camera and level compiler.
import type { LevelBounds, UnstampedLevel } from "../level/types";
import { computeBounds as levelBounds } from "../level/bounds";

export const TILE_W = 64;
export const TILE_H = 32;
export const Z_PX = 32;
/** Base logical view (D22): the smallest visible area, and the box the 2P fit is measured in. */
export const VIEW_W = 960;
export const VIEW_H = 540;
/** The visible view widens or heightens to the stage's aspect within these limits (R16). */
export const VIEW_MIN_ASPECT = 3 / 4;
export const VIEW_MAX_ASPECT = 2.4;
/** Backing-store pixels may exceed the base view's by at most this factor (R16). */
export const VIEW_PIXEL_BUDGET = 1.35;

export interface ViewSize {
  w: number;
  h: number;
}

/** Visible logical view for a stage of the given CSS size: the base view grown to its aspect. */
export function viewSizeFor(cssW: number, cssH: number): ViewSize {
  if (!(cssW > 0 && cssH > 0)) return { w: VIEW_W, h: VIEW_H };
  const a = Math.min(VIEW_MAX_ASPECT, Math.max(VIEW_MIN_ASPECT, cssW / cssH));
  if (a >= VIEW_W / VIEW_H) return { w: Math.round(VIEW_H * a), h: VIEW_H };
  return { w: VIEW_W, h: Math.round(VIEW_W / a) };
}

/** Backing-store pixels per logical pixel: min(DPR, 2), reduced to keep within the pixel budget. */
export function backingScale(view: ViewSize, devicePixelRatio: number): number {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const budget = VIEW_PIXEL_BUDGET * VIEW_W * VIEW_H;
  return dpr * Math.min(1, Math.sqrt(budget / (view.w * view.h)));
}

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/** Side faces over void extend this far below the cell top (§7.11). */
export const SIDE_FADE_DEPTH = 2.5;

export function project(x: number, y: number, z: number): { sx: number; sy: number } {
  return { sx: (x - y) * HALF_W, sy: (x + y) * HALF_H - z * Z_PX };
}

export function projectX(x: number, y: number): number {
  return (x - y) * HALF_W;
}

export function projectY(x: number, y: number, z: number): number {
  return (x + y) * HALF_H - z * Z_PX;
}

export function unproject(sx: number, sy: number, z = 0): { x: number; y: number } {
  const a = sx / HALF_W;
  const b = (sy + z * Z_PX) / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function toScreen(
  p: { sx: number; sy: number },
  cam: { cx: number; cy: number; zoom: number },
  view: ViewSize = { w: VIEW_W, h: VIEW_H },
): { X: number; Y: number } {
  return {
    X: (p.sx - cam.cx) * cam.zoom + view.w / 2,
    Y: (p.sy - cam.cy) * cam.zoom + view.h / 2,
  };
}

/** Inverse of toScreen. */
export function fromScreen(
  X: number,
  Y: number,
  cam: { cx: number; cy: number; zoom: number },
  view: ViewSize = { w: VIEW_W, h: VIEW_H },
): { sx: number; sy: number } {
  return {
    sx: (X - view.w / 2) / cam.zoom + cam.cx,
    sy: (Y - view.h / 2) / cam.zoom + cam.cy,
  };
}

/**
 * Min/max of project() over every non-void cell's top corners and the same corners
 * extended SIDE_FADE_DEPTH units down (§7.7). All-void levels give a zero box.
 */
export function computeBounds(level: Pick<UnstampedLevel, "grid" | "cells">): LevelBounds {
  return levelBounds(level);
}
