// Isometric projection (§7.7). Pure: shared by the renderer, camera and level compiler.
import type { LevelBounds, UnstampedLevel } from "../level/types";
import { computeBounds as levelBounds } from "../level/bounds";

export const TILE_W = 64;
export const TILE_H = 32;
export const Z_PX = 32;
export const VIEW_W = 960;
export const VIEW_H = 540;

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
): { X: number; Y: number } {
  return {
    X: (p.sx - cam.cx) * cam.zoom + VIEW_W / 2,
    Y: (p.sy - cam.cy) * cam.zoom + VIEW_H / 2,
  };
}

/** Inverse of toScreen. */
export function fromScreen(
  X: number,
  Y: number,
  cam: { cx: number; cy: number; zoom: number },
): { sx: number; sy: number } {
  return {
    sx: (X - VIEW_W / 2) / cam.zoom + cam.cx,
    sy: (Y - VIEW_H / 2) / cam.zoom + cam.cy,
  };
}

/**
 * Min/max of project() over every non-void cell's top corners and the same corners
 * extended SIDE_FADE_DEPTH units down (§7.7). All-void levels give a zero box.
 */
export function computeBounds(level: Pick<UnstampedLevel, "grid" | "cells">): LevelBounds {
  return levelBounds(level);
}
