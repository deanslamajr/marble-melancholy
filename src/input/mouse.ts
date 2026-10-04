import { clampDisk } from "./mapping";
import type { StickVector } from "./types";

export const MOUSE_GAIN = 0.12;
export const MOUSE_SMOOTH_KEEP = 0.55;
export const MOUSE_SMOOTH_RAW = 0.45;
export const MOUSE_ZERO_BELOW = 0.02;
/** Absolute-mode cursor distance (CSS px) from the canvas centre that maps to full deflection. */
export const ABSOLUTE_RADIUS_PX = 160;

/**
 * Trackball model (§7.6). DOM-free: feed(dx, dy) accumulates movement between ticks, tick()
 * returns the screen-space stick. Absolute fallback mode uses setCursor() instead.
 */
export class MouseSource {
  sensitivity = 1;
  /** True when pointer lock is unavailable or was denied. */
  absoluteMode = false;
  private accX = 0;
  private accY = 0;
  private sx = 0;
  private sy = 0;
  private cursorInside = false;
  /** Cursor offset from the target centre, CSS px. */
  private offX = 0;
  private offY = 0;

  feed(dx: number, dy: number): void {
    this.accX += dx;
    this.accY += dy;
  }

  /** Absolute mode: cursor offset from the target centre in CSS px; null when outside. */
  setCursor(offset: { x: number; y: number } | null): void {
    if (offset) {
      this.cursorInside = true;
      this.offX = offset.x;
      this.offY = offset.y;
    } else {
      this.cursorInside = false;
    }
  }

  get absoluteActive(): boolean {
    return this.absoluteMode && this.cursorInside;
  }

  tick(): StickVector {
    if (this.absoluteMode) {
      this.accX = 0;
      this.accY = 0;
      if (!this.cursorInside) return { x: 0, y: 0 };
      return clampDisk(this.offX / ABSOLUTE_RADIUS_PX, this.offY / ABSOLUTE_RADIUS_PX);
    }
    const k = MOUSE_GAIN * this.sensitivity;
    const rawX = this.accX * k;
    const rawY = this.accY * k;
    this.accX = 0;
    this.accY = 0;
    const s = clampDisk(
      MOUSE_SMOOTH_KEEP * this.sx + MOUSE_SMOOTH_RAW * rawX,
      MOUSE_SMOOTH_KEEP * this.sy + MOUSE_SMOOTH_RAW * rawY,
    );
    if (s.x * s.x + s.y * s.y < MOUSE_ZERO_BELOW * MOUSE_ZERO_BELOW) {
      this.sx = 0;
      this.sy = 0;
    } else {
      this.sx = s.x;
      this.sy = s.y;
    }
    return { x: this.sx, y: this.sy };
  }

  reset(): void {
    this.accX = 0;
    this.accY = 0;
    this.sx = 0;
    this.sy = 0;
  }
}
