// Render-side camera (§7.7). Never read by the sim.
import type { LevelBounds } from "../level/types";
import type { PlayerSnapshot, SimSnapshot } from "../sim/types";
import { projectX, projectY, VIEW_H, VIEW_W } from "./iso";

export const CAM_TAU = 0.15;
export const CAM_RESPAWN_TAU = 0.3;
export const CAM_RESPAWN_SETTLE_PX = 40;
export const CAM_LEAD = 0.25;
export const CAM_LEAD_MAX_PX = 120;
export const CAM_BOUNDS_MARGIN = 96;
export const CAM_MIN_ZOOM_2P = 0.6;
export const CAM_LEAVE_BEHIND_FRAMES = 30;
export const CAM_FREE_MIN_ZOOM = 0.25;
export const CAM_FREE_MAX_ZOOM = 3;

const HELD = new Set(["dying", "waiting", "eliminated", "transit"]);

function framed(p: PlayerSnapshot): boolean {
  return p.status === "alive" || p.status === "finished" || p.status === "windup";
}

export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  free = false;

  private bounds: LevelBounds;
  private unfitFrames = 0;
  private held = false;
  private holdSx = 0;
  private holdSy = 0;
  private recovering = false;
  private tx = 0;
  private ty = 0;
  private tz = 1;

  constructor(bounds: LevelBounds) {
    this.bounds = { ...bounds };
    this.cx = (bounds.minSx + bounds.maxSx) / 2;
    this.cy = (bounds.minSy + bounds.maxSy) / 2;
  }

  setBounds(bounds: LevelBounds): void {
    this.bounds = { ...bounds };
    if (!this.free) this.clamp();
  }

  snapTo(snap: SimSnapshot): void {
    this.held = false;
    this.recovering = false;
    this.unfitFrames = 0;
    this.computeTarget(snap);
    this.cx = this.tx;
    this.cy = this.ty;
    this.zoom = this.tz;
    this.clamp();
  }

  update(snap: SimSnapshot, dt: number): number | null {
    if (this.free) return null;
    const fit = this.computeTarget(snap);
    const dx = this.tx - this.cx;
    const dy = this.ty - this.cy;
    if (this.recovering && dx * dx + dy * dy < CAM_RESPAWN_SETTLE_PX * CAM_RESPAWN_SETTLE_PX) {
      this.recovering = false;
    }
    const tau = this.recovering ? CAM_RESPAWN_TAU : CAM_TAU;
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
    this.cx += dx * k;
    this.cy += dy * k;
    this.zoom += (this.tz - this.zoom) * (dt > 0 ? 1 - Math.exp(-dt / CAM_TAU) : 0);
    this.clamp();

    if (fit !== null && fit < CAM_MIN_ZOOM_2P) {
      this.unfitFrames++;
      if (this.unfitFrames >= CAM_LEAVE_BEHIND_FRAMES) {
        this.unfitFrames = 0;
        return trailingPlayer(snap);
      }
    } else {
      this.unfitFrames = 0;
    }
    return null;
  }

  pan(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.zoom;
    this.cy -= dyPx / this.zoom;
  }

  zoomAt(factor: number, X: number, Y: number): void {
    const sx = (X - VIEW_W / 2) / this.zoom + this.cx;
    const sy = (Y - VIEW_H / 2) / this.zoom + this.cy;
    const z = Math.min(CAM_FREE_MAX_ZOOM, Math.max(CAM_FREE_MIN_ZOOM, this.zoom * factor));
    this.zoom = z;
    this.cx = sx - (X - VIEW_W / 2) / z;
    this.cy = sy - (Y - VIEW_H / 2) / z;
  }

  /**
   * Sets tx/ty/tz from the framing rules. Returns the unclamped 2P fit zoom when two marbles
   * are framed, else null.
   */
  private computeTarget(snap: SimSnapshot): number | null {
    const players = snap.players;
    if (players.length <= 1) {
      const p = players[0];
      this.tz = 1;
      if (!p) return null;
      this.followSingle(p, true);
      return null;
    }
    const a = players[0]!;
    const b = players[1]!;
    const fa = framed(a);
    const fb = framed(b);
    if (fa && fb) {
      this.endHold();
      const ax = projectX(a.x, a.y);
      const ay = projectY(a.x, a.y, a.z);
      const bx = projectX(b.x, b.y);
      const by = projectY(b.x, b.y, b.z);
      const reqW = Math.abs(ax - bx) + 320;
      const reqH = Math.abs(ay - by) + 240;
      const fit = Math.min(VIEW_W / reqW, VIEW_H / reqH);
      this.tz = Math.min(1, Math.max(CAM_MIN_ZOOM_2P, fit));
      this.tx = (ax + bx) / 2;
      this.ty = (ay + by) / 2;
      return fit;
    }
    this.tz = 1;
    if (fa || fb) {
      const p = fa ? a : b;
      const other = fa ? b : a;
      this.followSingle(p, other.eliminated || other.status === "eliminated");
      return null;
    }
    // Nobody framed: hold on whoever died most recently (or the first player).
    this.followSingle(a.status === "eliminated" && b.status !== "eliminated" ? b : a, true);
    return null;
  }

  private followSingle(p: PlayerSnapshot, lead: boolean): void {
    if (HELD.has(p.status)) {
      if (!this.held) {
        this.held = true;
        this.holdSx = projectX(p.x, p.y);
        this.holdSy = projectY(p.x, p.y, p.z);
      }
      this.tx = this.holdSx;
      this.ty = this.holdSy;
      return;
    }
    this.endHold();
    let lx = 0;
    let ly = 0;
    if (lead) {
      lx = projectX(p.vx, p.vy) * CAM_LEAD;
      ly = projectY(p.vx, p.vy, 0) * CAM_LEAD;
      const l = Math.sqrt(lx * lx + ly * ly);
      if (l > CAM_LEAD_MAX_PX) {
        lx *= CAM_LEAD_MAX_PX / l;
        ly *= CAM_LEAD_MAX_PX / l;
      }
    }
    this.tx = projectX(p.x, p.y) + lx;
    this.ty = projectY(p.x, p.y, p.z) + ly;
  }

  private endHold(): void {
    if (this.held) {
      this.held = false;
      this.recovering = true;
    }
  }

  private clamp(): void {
    const b = this.bounds;
    const m = CAM_BOUNDS_MARGIN;
    const halfW = VIEW_W / 2 / this.zoom;
    const halfH = VIEW_H / 2 / this.zoom;
    this.cx = clampAxis(this.cx, b.minSx - m, b.maxSx + m, halfW);
    this.cy = clampAxis(this.cy, b.minSy - m, b.maxSy + m, halfH);
  }
}

function clampAxis(c: number, lo: number, hi: number, half: number): number {
  if (hi - lo <= half * 2) return (lo + hi) / 2;
  if (c < lo + half) return lo + half;
  if (c > hi - half) return hi - half;
  return c;
}

/** The alive player with the lower progressBest (tie: higher index). */
export function trailingPlayer(snap: SimSnapshot): number | null {
  let best: PlayerSnapshot | null = null;
  for (const p of snap.players) {
    if (p.status !== "alive") continue;
    if (
      best === null ||
      p.progressBest < best.progressBest ||
      (p.progressBest === best.progressBest && p.index > best.index)
    ) {
      best = p;
    }
  }
  return best ? best.index : null;
}
