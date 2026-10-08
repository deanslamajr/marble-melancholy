// Objective difficulty metrics for a solved course (DECISIONS L27). Pure and seeded (D06, D07).
//
// Fragility and robustness model an imperfect player: a closed-loop tracker follows the solution
// (its inputs plus a correction toward the solution's position and velocity at the same tick)
// while its stick is rotated by noise, its magnitude scaled and its timing delayed. The run is
// cut into windows; each window starts from the solution's exact state, so one early slip does not
// hide everything after it. Fragility is the chance that at least one window fails under normal
// noise; robustness is the success rate of the worst window under small noise.
import { datan2, dcos, dsin, PI } from "../../core/dmath";
import { Rng } from "../../core/rng";
import { TICK_HZ } from "../../sim/constants";
import { dequantize, quantizeInt } from "../../sim/quantize";
import { RaceSim } from "../../sim/race";
import { captureSim, restoreSim, type SimState } from "../../sim/simState";
import { RunCursor } from "../solution/replay";
import type { PlayableLevel } from "../types";

export interface CourseMetrics {
  /** Solution time in seconds. */
  seconds: number;
  /** % of noisy runs that die or fall behind somewhere on the course. */
  fragility: number;
  /** % success of the hardest 2 s window under small noise (fairness floor, L28). */
  robustness: number;
  /** Stick direction changes (45° sectors, with hysteresis) per second. */
  dirChanges: number;
  /** % of steering time at diagonal (non-axis) stick directions. */
  offAxis: number;
  /** Narrowest corridor across the direction of travel along the solution, in cells. */
  minWidth: number;
  /** % of path samples whose corridor is at most 1.5 cells wide. */
  narrow: number;
  /** % of visited path cells with an unrailed edge over void or a fatal drop. */
  railless: number;
  /** % of solution time over void (platforms, jumps, flights). */
  overVoid: number;
  /** Take-offs that stay airborne for at least 0.15 s. */
  airborne: number;
}

export interface NoiseLevel {
  /** Stick rotation, uniform in ±deg, redrawn every 8 ticks. */
  deg: number;
  /** Stick magnitude scale, uniform in 1 ± mag. */
  mag: number;
  /** Reaction delay, uniform in 0..lag ticks per trial. */
  lag: number;
  trials: number;
}

export const FRAGILITY_NOISE: NoiseLevel = { deg: 16, mag: 0.2, lag: 5, trials: 10 };
export const ROBUST_NOISE: NoiseLevel = { deg: 6, mag: 0.06, lag: 2, trials: 8 };
export const WINDOW_TICKS = 240;
const KP = 0.7;
const KV = 0.12;
const DEG = PI / 180;

interface Ref {
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  qx: number[];
  qy: number[];
  alive: boolean[];
  states: Map<number, SimState>;
  goal: number;
}

/** Re-run the solution, recording the trajectory and window-start states. */
function reference(level: PlayableLevel, runs: readonly number[], sim: RaceSim): Ref {
  const p = sim.players[0]!;
  const cur = new RunCursor(runs);
  const ref: Ref = {
    x: [],
    y: [],
    vx: [],
    vy: [],
    qx: [],
    qy: [],
    alive: [],
    states: new Map(),
    goal: -1,
  };
  const limit = level.timing.timeLimit * TICK_HZ;
  for (let t = 0; t < limit; t++) {
    const m = p.marble;
    if (t % WINDOW_TICKS === 0) ref.states.set(t, captureSim(sim));
    ref.x.push(m.x);
    ref.y.push(m.y);
    ref.vx.push(m.vx + m.carrierVx);
    ref.vy.push(m.vy + m.carrierVy);
    ref.alive.push(m.status === "alive");
    const q = cur.next() ?? [0, 0];
    ref.qx.push(q[0]);
    ref.qy.push(q[1]);
    const ev = sim.step([dequantize(q[0], q[1])]);
    if (ev.some((e) => e.t === "goal")) {
      ref.goal = t;
      break;
    }
  }
  return ref;
}

/** One noisy tracking run over window [t0, t1); true when it survives and keeps up. */
function trial(
  sim: RaceSim,
  ref: Ref,
  t0: number,
  t1: number,
  noise: NoiseLevel,
  rng: Rng,
): boolean {
  restoreSim(sim, ref.states.get(t0)!);
  const p = sim.players[0]!;
  const lag = rng.nextInt(noise.lag + 1);
  let rot = 0;
  let scale = 1;
  // The window holding the goal gets a second of slack to roll in behind the solution.
  const last = ref.goal >= 0 && t1 > ref.goal;
  const stop = last ? t1 + TICK_HZ : t1;
  const n = ref.x.length - 1;
  for (let t = t0; t < stop; t++) {
    if ((t - t0) % 8 === 0) {
      rot = (rng.next() * 2 - 1) * noise.deg * DEG;
      scale = 1 + (rng.next() * 2 - 1) * noise.mag;
    }
    const m = p.marble;
    let ux = 0;
    let uy = 0;
    if (m.status === "alive") {
      const r = Math.min(n, Math.max(t0, t - lag));
      const at = Math.min(n, t);
      ux = ref.qx[r]! / 127 + KP * (ref.x[at]! - m.x) + KV * (ref.vx[at]! - m.vx - m.carrierVx);
      uy = ref.qy[r]! / 127 + KP * (ref.y[at]! - m.y) + KV * (ref.vy[at]! - m.vy - m.carrierVy);
      const c = dcos(rot) * scale;
      const s = dsin(rot) * scale;
      const rx = ux * c - uy * s;
      uy = ux * s + uy * c;
      ux = rx;
    }
    const q = quantizeInt(ux, uy);
    const ev = sim.step([dequantize(q[0], q[1])]);
    for (const e of ev) {
      if (e.t === "death") return false;
      if (e.t === "goal") return true;
    }
  }
  if (last) return false;
  const m = p.marble;
  if (m.status !== "alive" && m.status !== "transit" && m.status !== "windup") return false;
  const dx = m.x - ref.x[t1]!;
  const dy = m.y - ref.y[t1]!;
  return dx * dx + dy * dy <= 1.5 * 1.5;
}

/** Success share per window at a noise level. */
export function windowSuccess(
  level: PlayableLevel,
  runs: readonly number[],
  noise: NoiseLevel,
  seed: number,
): number[] {
  const sim = new RaceSim(level, { players: 1 });
  const ref = reference(level, runs, sim);
  return windowsOf(sim, ref, noise, new Rng(seed));
}

function windowsOf(sim: RaceSim, ref: Ref, noise: NoiseLevel, rng: Rng): number[] {
  const end = ref.goal >= 0 ? ref.goal + 1 : ref.x.length;
  const out: number[] = [];
  for (let t0 = 0; t0 < end; t0 += WINDOW_TICKS) {
    // The last window runs to the goal (at least half a window long; shorter tails merge back).
    let t1 = Math.min(end, t0 + WINDOW_TICKS);
    if (end - t1 < WINDOW_TICKS / 2) t1 = end;
    let ok = 0;
    for (let i = 0; i < noise.trials; i++) if (trial(sim, ref, t0, t1, noise, rng)) ok++;
    out.push(ok / noise.trials);
    if (t1 === end) break;
  }
  return out;
}

const RAY_STEP = 0.05;
const RAY_MAX = 4.5;

/** Corridor width across (ux, uy)'s perpendicular at (x, y): ground with no step or fall. */
function corridor(sim: RaceSim, x: number, y: number, ux: number, uy: number): number {
  const t = sim.terrain;
  const g0 = t.baseGroundAt(x, y, 0);
  if (!g0) return 0;
  let w = 0;
  for (const side of [1, -1]) {
    const px = -uy * side;
    const py = ux * side;
    let z = g0.z;
    let cx = Math.floor(x);
    let cy = Math.floor(y);
    let d = 0;
    for (; d < RAY_MAX; d += RAY_STEP) {
      const nx = x + px * (d + RAY_STEP);
      const ny = y + py * (d + RAY_STEP);
      const g = t.baseGroundAt(nx, ny, 0);
      if (!g || Math.abs(g.z - z) > 0.6) break;
      const ncx = Math.floor(nx);
      const ncy = Math.floor(ny);
      if (ncx !== cx && t.isWall(cx, cy, ncx > cx ? 1 : 3)) break;
      if (ncy !== cy && t.isWall(ncx, cy, ncy > cy ? 2 : 0)) break;
      cx = ncx;
      cy = ncy;
      z = g.z;
    }
    w += d;
  }
  return w;
}

/** All metrics for a level and its solution replay. `seed` drives the noise. */
export function measureCourse(
  level: PlayableLevel,
  runs: readonly number[],
  seed: number,
): CourseMetrics {
  const sim = new RaceSim(level, { players: 1 });
  const ref = reference(level, runs, sim);
  const end = ref.goal >= 0 ? ref.goal + 1 : ref.x.length;

  // Geometry along the reference path (static terrain only).
  const t = sim.terrain;
  let minWidth = Infinity;
  let samples = 0;
  let narrow = 0;
  const cells = new Set<number>();
  let open = 0;
  let overVoid = 0;
  let airborne = 0;
  let airTicks = 0;
  const replay = new RaceSim(level, { players: 1 });
  const p = replay.players[0]!;
  for (let k = 0; k < end; k++) {
    const m = p.marble;
    const alive = m.status === "alive";
    if (alive && !t.baseGroundAt(m.x, m.y, 0)) overVoid++;
    if (alive && !m.grounded) airTicks++;
    else {
      if (airTicks >= 18) airborne++;
      airTicks = 0;
    }
    if (alive && m.grounded && !m.carrierVx && !m.carrierVy && t.baseGroundAt(m.x, m.y, 0)) {
      const cx = Math.floor(m.x);
      const cy = Math.floor(m.y);
      const i = t.index(cx, cy);
      if (!cells.has(i)) {
        cells.add(i);
        const h = t.hRaw(cx, cy);
        for (let e = 0; e < 4; e++) {
          const nx = cx + (e === 1 ? 1 : e === 3 ? -1 : 0);
          const ny = cy + (e === 2 ? 1 : e === 0 ? -1 : 0);
          const nh = t.hRaw(nx, ny);
          if ((nh < 0 || h - nh >= 5) && !t.isWall(cx, cy, e as 0 | 1 | 2 | 3)) {
            open++;
            break;
          }
        }
      }
      const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      if (k % 6 === 0 && sp > 1) {
        const w = corridor(replay, m.x, m.y, m.vx / sp, m.vy / sp);
        if (w > 0) {
          samples++;
          if (w <= 1.5) narrow++;
          if (w < minWidth) minWidth = w;
        }
      }
    }
    replay.step([dequantize(ref.qx[k]!, ref.qy[k]!)]);
  }
  if (airTicks >= 18) airborne++;

  // Input complexity: mean stick per 0.1 s while steering on the ground.
  let changes = 0;
  let windows = 0;
  let diag = 0;
  let centre: number | null = null;
  for (let k0 = 0; k0 + 12 <= end; k0 += 12) {
    let sx = 0;
    let sy = 0;
    for (let k = k0; k < k0 + 12; k++) {
      sx += ref.qx[k]! / 127;
      sy += ref.qy[k]! / 127;
    }
    sx /= 12;
    sy /= 12;
    if (sx * sx + sy * sy < 0.25 * 0.25) continue;
    const a = datan2(sy, sx);
    const sector = Math.round(a / (PI / 4));
    windows++;
    if ((((sector % 2) + 2) & 1) === 1) diag++;
    if (centre === null) centre = sector * (PI / 4);
    else {
      let d = Math.abs(a - centre);
      if (d > PI) d = 2 * PI - d;
      if (d > (PI / 8) * 1.5) {
        changes++;
        centre = sector * (PI / 4);
      }
    }
  }

  const rng = new Rng(seed >>> 0);
  const hi = windowsOf(sim, ref, FRAGILITY_NOISE, rng);
  const lo = windowsOf(sim, ref, ROBUST_NOISE, rng);
  let survive = 1;
  for (const s of hi) survive *= s;
  const seconds = end / TICK_HZ;
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return {
    seconds: Math.round(seconds * 100) / 100,
    fragility: pct(1 - survive),
    robustness: pct(lo.length > 0 ? Math.min(...lo) : 1),
    dirChanges: Math.round((changes / Math.max(seconds, 1e-9)) * 100) / 100,
    offAxis: pct(windows > 0 ? diag / windows : 0),
    minWidth: minWidth === Infinity ? 0 : Math.round(minWidth * 10) / 10,
    narrow: pct(samples > 0 ? narrow / samples : 0),
    railless: pct(cells.size > 0 ? open / cells.size : 0),
    overVoid: pct(end > 0 ? overVoid / end : 0),
    airborne,
  };
}
