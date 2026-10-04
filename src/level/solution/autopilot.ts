// Deterministic waypoint controller (§6.6).
import { INPUT_MAX_SPEED } from "../../sim/constants";
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

export class Autopilot {
  i = 0;
  holdLeft = 0;
  holding = false;
  deathsAtAdvance = 0;
  failed = false;
  private wasHeld = false;

  constructor(
    readonly points: readonly Waypoint[],
    private readonly probe?: GroundProbe,
  ) {}

  get done(): boolean {
    return this.i >= this.points.length;
  }

  private advance(p: PlayerState): void {
    this.i++;
    this.holding = false;
    this.holdLeft = 0;
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
    } else if (dist < 1e-9) {
      desX = 0;
      desY = 0;
    } else {
      const s = INPUT_MAX_SPEED * (wp.speed ?? DEFAULT_WP_SPEED) * (isLast ? Math.min(1, dist / 1.5) : 1);
      desX = (dx / dist) * s;
      desY = (dy / dist) * s;
    }
    const rawX = (desX - wvx) * AUTOPILOT_GAIN;
    const rawY = (desY - wvy) * AUTOPILOT_GAIN;
    return quantizeInt(rawX, rawY);
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
