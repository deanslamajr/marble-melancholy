// Deterministic waypoint controller (§6.6).
import { INPUT_ACCEL, INPUT_MAX_SPEED, MARBLE_RADIUS, TICK_HZ } from "../../sim/constants";
import { quantizeInt } from "../../sim/quantize";
import type { PlayerState } from "../../sim/types";
import type { Waypoint } from "../types";

export const AUTOPILOT_GAIN = 0.6;
export const DEFAULT_WP_SPEED = 0.8;
export const DEFAULT_WP_RADIUS = 0.6;
export const MAX_DEATHS_PER_WAYPOINT = 6;

/** What is under (x, y) right now: nothing, static terrain, or a moving carrier (platform). */
export type GroundProbe = (x: number, y: number) => "none" | "static" | "carrier";

const PROBE_STEP = 0.25;

/** A hammer as the autopilot sees it: its cell and its phase at any tick. */
export interface HammerView {
  readonly cx: number;
  readonly cy: number;
  phaseAt(tick: number): { phase: string };
}

/** The current tick and the level's hammers, for `timed` waypoints (DECISIONS M14). */
export type HammerProbe = () => { tick: number; hammers: readonly HammerView[] };

const GATE_REACH = MARBLE_RADIUS + 0.15;

/** Seconds to cover `s` from speed `v0` accelerating at `a` up to `vmax`. */
function timeTo(s: number, v0: number, vmax: number, a: number): number {
  if (s <= 0) return 0;
  if (v0 >= vmax) return s / vmax;
  const da = (vmax * vmax - v0 * v0) / (2 * a);
  if (s <= da) return (Math.sqrt(v0 * v0 + 2 * a * s) - v0) / a;
  return (vmax - v0) / a + (s - da) / vmax;
}

export class Autopilot {
  i = 0;
  holdLeft = 0;
  holding = false;
  deathsAtAdvance = 0;
  failed = false;
  private wasHeld = false;
  /** A `timed` waypoint's crossing has started; it is not re-checked mid-way. */
  private gateOpen = false;

  constructor(
    readonly points: readonly Waypoint[],
    private readonly probe?: GroundProbe,
    private readonly hammers?: HammerProbe,
  ) {}

  get done(): boolean {
    return this.i >= this.points.length;
  }

  private advance(p: PlayerState): void {
    this.i++;
    this.holding = false;
    this.holdLeft = 0;
    this.gateOpen = false;
    this.deathsAtAdvance = p.deaths;
  }

  /** Quantized input for this tick. */
  input(p: PlayerState): [number, number] {
    const m = p.marble;
    if (p.deaths - this.deathsAtAdvance >= MAX_DEATHS_PER_WAYPOINT) this.failed = true;
    const held = m.status === "transit" || m.status === "windup";
    // Entering a pipe, funnel or catapult counts as reaching the current waypoint (DECISIONS M07).
    if (held && !this.wasHeld && !this.done) this.advance(p);
    this.wasHeld = held;
    if (m.status !== "alive" || m.catapultFlight || this.done) return [0, 0];

    const wp = this.points[this.i]!;
    const tx = wp.at[0] + 0.5;
    const ty = wp.at[1] + 0.5;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const radius = wp.radius ?? DEFAULT_WP_RADIUS;
    const hold = wp.hold ?? 0;
    const isLast = this.i === this.points.length - 1;

    if (!this.holding && dist < radius) {
      if (hold > 0) {
        this.holding = true;
        this.holdLeft = hold;
      } else if (!isLast) {
        this.advance(p);
        return this.input(p);
      }
    }

    const wvx = m.vx + m.carrierVx;
    const wvy = m.vy + m.carrierVy;
    let desX: number;
    let desY: number;
    if (this.holding) {
      desX = m.carrierVx;
      desY = m.carrierVy;
      this.holdLeft--;
      if (this.holdLeft <= 0) this.advance(p);
    } else if (m.grounded && !this.reachableNow(m.x, m.y, tx, ty, dist)) {
      // Target is on a moving platform that is away: wait (riding any carrier) until it arrives (DECISIONS M10).
      desX = m.carrierVx;
      desY = m.carrierVy;
    } else if (wp.timed && !this.gateOpen && m.grounded && !this.gateClear(m, dx, dy, dist, wp)) {
      // Void or a striking hammer on the way: wait in place, riding any carrier (DECISIONS M14).
      desX = m.carrierVx;
      desY = m.carrierVy;
    } else if (dist < 1e-9) {
      desX = 0;
      desY = 0;
    } else {
      const s =
        INPUT_MAX_SPEED * (wp.speed ?? DEFAULT_WP_SPEED) * (isLast ? Math.min(1, dist / 1.5) : 1);
      desX = (dx / dist) * s;
      desY = (dy / dist) * s;
    }
    const rawX = (desX - wvx) * AUTOPILOT_GAIN;
    const rawY = (desY - wvy) * AUTOPILOT_GAIN;
    return quantizeInt(rawX, rawY);
  }

  /**
   * True when the straight run to the target has floor all the way (a docking platform has closed
   * the gap) and no hammer cell on it is down while the marble crosses it.
   */
  private gateClear(
    m: { x: number; y: number; vx: number; vy: number },
    dx: number,
    dy: number,
    dist: number,
    wp: Waypoint,
  ): boolean {
    if (this.probe) {
      const n = Math.ceil(dist / PROBE_STEP);
      for (let k = 1; k <= n; k++) {
        if (this.probe(m.x + (dx * k) / n, m.y + (dy * k) / n) === "none") return false;
      }
    }
    const view = this.hammers?.();
    if (!view || view.hammers.length === 0 || dist < 1e-9) return (this.gateOpen = true);
    const ux = dx / dist;
    const uy = dy / dist;
    const vmax = INPUT_MAX_SPEED * (wp.speed ?? DEFAULT_WP_SPEED);
    const v0 = Math.max(0, m.vx * ux + m.vy * uy);
    for (const hm of view.hammers) {
      let lo = 0;
      let hi = dist + 0.5;
      const slab = (p: number, d: number, a: number, b: number): void => {
        if (Math.abs(d) < 1e-9) {
          if (p < a || p > b) hi = -1;
          return;
        }
        const s0 = (a - p) / d;
        const s1 = (b - p) / d;
        lo = Math.max(lo, Math.min(s0, s1));
        hi = Math.min(hi, Math.max(s0, s1));
      };
      slab(m.x, ux, hm.cx - GATE_REACH, hm.cx + 1 + GATE_REACH);
      slab(m.y, uy, hm.cy - GATE_REACH, hm.cy + 1 + GATE_REACH);
      if (lo > hi) continue;
      const t0 = timeTo(lo, v0, vmax, INPUT_ACCEL) - 0.08;
      const t1 = timeTo(hi, v0, vmax, INPUT_ACCEL / 2) + 0.12;
      const k1 = Math.ceil(t1 * TICK_HZ);
      for (let k = Math.max(0, Math.floor(t0 * TICK_HZ)); k <= k1; k++) {
        const ph = hm.phaseAt(view.tick + k).phase;
        if (ph === "drop" || ph === "down") return false;
      }
    }
    return (this.gateOpen = true);
  }

  private reachableNow(x: number, y: number, tx: number, ty: number, dist: number): boolean {
    if (!this.probe) return true;
    const under = this.probe(tx, ty);
    if (under === "none") return false;
    if (under === "static") return true;
    const n = Math.ceil(dist / PROBE_STEP);
    for (let k = 1; k < n; k++) {
      const u = k / n;
      if (this.probe(x + (tx - x) * u, y + (ty - y) * u) === "none") return false;
    }
    return true;
  }
}
