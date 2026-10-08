// Beam search over the deterministic sim (DECISIONS L25). Finds a per-tick input replay for
// courses whose margins are too fine for the waypoint autopilot. Each decision runs one closed-loop
// controller mode (pursue the guide line at some speed and lateral offset, hold, or a raw stick
// direction) for a chunk of ticks; candidates are scored by arc length along the guide polyline,
// deduplicated on quantized position and velocity, and kept diverse per cell and speed band. When
// every candidate dies, the search backs up a few decisions and widens. The budget is counted in
// simulated ticks, never in wall-clock time, so the result is the same on every machine.
import { datan2, dcos, dsin, PI } from "../../core/dmath";
import {
  GRAVITY,
  INPUT_ACCEL,
  INPUT_MAX_SPEED,
  LAND_SNAP,
  SHATTER_FALL_HEIGHT,
  TICK_HZ,
} from "../../sim/constants";
import { dequantize, quantizeInt } from "../../sim/quantize";
import { RaceSim } from "../../sim/race";
import { captureSim, restoreSim, type SimState } from "../../sim/simState";
import type { MarbleState } from "../../sim/types";
import type { PlayableLevel } from "../types";
import { encodeRuns } from "./replay";

export interface SearchOptions {
  /** Guide polyline in world units (cell centres), from the start to the goal. */
  guide: ReadonlyArray<readonly [number, number]>;
  /** Candidates kept per decision (default 10). */
  beam?: number;
  /** Ticks per decision (default 10). */
  chunk?: number;
  /** Give up past this tick (default the level's time limit). */
  maxTicks?: number;
  /** Simulated-tick budget for the whole search (default 1 500 000). */
  budget?: number;
  /** Most backtracks before giving up (default 24). */
  maxBacktracks?: number;
}

export interface SearchProgress {
  /** Race tick of the current decision layer. */
  tick: number;
  /** Best arc-length progress along the guide, 0..1. */
  progress: number;
  /** Simulated ticks spent so far. */
  spent: number;
}

export type SearchResult =
  | { ok: true; runs: number[]; ticks: number; spent: number; backtracks: number }
  | {
      ok: false;
      reason: "budget" | "stuck" | "timeout";
      spent: number;
      backtracks: number;
      progress: number;
      pos: [number, number];
    };

const GAIN = 0.6;
/** Pursuit modes: [speed as a share of the input top speed, lateral offset in cells]. */
const PURSUIT: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0.8, 0],
  [0.55, 0],
  [0.3, 0],
  [0, 0],
  [1, 0.28],
  [1, -0.28],
  [0.6, 0.28],
  [0.6, -0.28],
];
/** Raw stick directions, tried only while widened after a dead end. */
const RAW = 8;
const DOOM_PENALTY = 1000;
/** Progress (cells) traded per cell of distance from the guide line. */
const LATERAL = 0.25;
/** Decisions without 0.5 cells of new progress before the search counts as stuck. */
const STALL_LAYERS = 60;

// ---------- guide polyline ----------

export class Guide {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly cum: number[] = [0];
  readonly total: number;
  /** Turn angle at each vertex (0 at the ends). */
  readonly turns: number[] = [];

  constructor(points: ReadonlyArray<readonly [number, number]>) {
    for (const [x, y] of points) {
      const n = this.xs.length;
      if (n > 0 && Math.abs(this.xs[n - 1]! - x) < 1e-9 && Math.abs(this.ys[n - 1]! - y) < 1e-9)
        continue;
      this.xs.push(x);
      this.ys.push(y);
    }
    if (this.xs.length === 1) {
      this.xs.push(this.xs[0]! + 1e-3);
      this.ys.push(this.ys[0]!);
    }
    for (let i = 1; i < this.xs.length; i++) {
      const dx = this.xs[i]! - this.xs[i - 1]!;
      const dy = this.ys[i]! - this.ys[i - 1]!;
      this.cum.push(this.cum[i - 1]! + Math.sqrt(dx * dx + dy * dy));
    }
    this.total = this.cum[this.cum.length - 1]!;
    for (let i = 0; i < this.xs.length; i++) this.turns.push(this.turnAngle(i));
  }

  get segments(): number {
    return this.xs.length - 1;
  }

  private onSeg(i: number, x: number, y: number): { t: number; d2: number; len: number } {
    const ax = this.xs[i]!;
    const ay = this.ys[i]!;
    const dx = this.xs[i + 1]! - ax;
    const dy = this.ys[i + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    return { t, d2: px * px + py * py, len: Math.sqrt(len2) };
  }

  /** Nearest point near segment `hint`; searches further ahead when the marble was teleported. */
  project(x: number, y: number, hint: number): { seg: number; s: number; lat: number } {
    const n = this.segments;
    let best = -1;
    let bt = 0;
    let bd = Infinity;
    const scan = (lo: number, hi: number) => {
      for (let i = Math.max(0, lo); i <= Math.min(n - 1, hi); i++) {
        const r = this.onSeg(i, x, y);
        if (r.d2 < bd - 1e-9 || (Math.abs(r.d2 - bd) <= 1e-9 && i > best)) {
          bd = r.d2;
          best = i;
          bt = r.t;
        }
      }
    };
    scan(hint - 1, hint + 3);
    if (bd > 2.25) scan(hint, n - 1);
    const i = best;
    const dx = this.xs[i + 1]! - this.xs[i]!;
    const dy = this.ys[i + 1]! - this.ys[i]!;
    const len = this.cum[i + 1]! - this.cum[i]!;
    const lat = len > 0 ? ((x - this.xs[i]!) * dy - (y - this.ys[i]!) * dx) / len : 0;
    return { seg: i, s: this.cum[i]! + bt * len, lat };
  }

  /** Point and unit tangent at arc length `s`, starting the scan at segment `from`. */
  at(s: number, from: number): [x: number, y: number, tx: number, ty: number, seg: number] {
    let i = Math.max(0, Math.min(from, this.segments - 1));
    while (i < this.segments - 1 && this.cum[i + 1]! < s) i++;
    const len = this.cum[i + 1]! - this.cum[i]!;
    const dx = this.xs[i + 1]! - this.xs[i]!;
    const dy = this.ys[i + 1]! - this.ys[i]!;
    const tx = len > 0 ? dx / len : 1;
    const ty = len > 0 ? dy / len : 0;
    const u = len > 0 ? Math.min(1, Math.max(0, (s - this.cum[i]!) / len)) : 0;
    return [this.xs[i]! + dx * u, this.ys[i]! + dy * u, tx, ty, i];
  }

  /** Turn angle (radians, 0..π) at vertex `i` (between segments i-1 and i). */
  turnAt(i: number): number {
    return this.turns[i] ?? 0;
  }

  private turnAngle(i: number): number {
    if (i <= 0 || i >= this.xs.length - 1) return 0;
    const a = datan2(this.ys[i]! - this.ys[i - 1]!, this.xs[i]! - this.xs[i - 1]!);
    const b = datan2(this.ys[i + 1]! - this.ys[i]!, this.xs[i + 1]! - this.xs[i]!);
    let d = Math.abs(b - a);
    if (d > PI) d = 2 * PI - d;
    return d;
  }
}

// ---------- controller ----------

/** Slope, wave, funnel and hoover acceleration on the marble right now (for feed-forward). */
export function externalAccel(sim: RaceSim, m: MarbleState): [number, number] {
  let ax = 0;
  let ay = 0;
  if (m.grounded) {
    const g = sim.terrain.groundAt(m.x, m.y, sim.tick);
    if (g) {
      const k = GRAVITY * sim.level.physics.slopeGravityScale;
      ax -= k * g.gradX;
      ay -= k * g.gradY;
    }
  }
  for (const e of sim.entities) {
    if (!e.pull) continue;
    const a = e.pull(sim, m);
    if (a) {
      ax += a[0];
      ay += a[1];
    }
  }
  return [ax, ay];
}

export type Mode = { kind: "pursue"; speed: number; offset: number } | { kind: "raw"; dir: number };

function modeFor(a: number): Mode {
  if (a < PURSUIT.length) {
    const [speed, offset] = PURSUIT[a]!;
    return { kind: "pursue", speed, offset };
  }
  return { kind: "raw", dir: a - PURSUIT.length };
}

/** One tick of controller output for `mode`, as the quantized input pair. */
export function controlInput(
  sim: RaceSim,
  m: MarbleState,
  guide: Guide,
  hint: number,
  mode: Mode,
): [number, number] {
  return control(sim, m, guide, hint, mode, null);
}

function control(
  sim: RaceSim,
  m: MarbleState,
  guide: Guide,
  hint: number,
  mode: Mode,
  seg: { seg: number } | null,
): [number, number] {
  if (m.status !== "alive" || m.inputLocked) return [0, 0];
  if (mode.kind === "raw") {
    const ang = (mode.dir * 2 * PI) / RAW;
    return quantizeInt(dcos(ang), dsin(ang));
  }
  const wvx = m.vx + m.carrierVx;
  const wvy = m.vy + m.carrierVy;
  let desX = m.carrierVx;
  let desY = m.carrierVy;
  if (mode.speed > 0) {
    const pr = guide.project(m.x, m.y, hint);
    if (seg) seg.seg = pr.seg;
    const v = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
    let look = Math.min(1.4, Math.max(0.5, 0.45 + 0.1 * v));
    // Do not cut a sharp corner of the guide: aim at the vertex until the marble is close to it.
    const next = pr.seg + 1;
    if (next < guide.segments && guide.turnAt(next) > 0.7) {
      const toVertex = guide.cum[next]! - pr.s;
      if (toVertex > 0.3 && toVertex < look) look = toVertex;
    }
    const [px, py, tx, ty] = guide.at(pr.s + look, pr.seg);
    const gx = px - ty * mode.offset;
    const gy = py + tx * mode.offset;
    const dx = gx - m.x;
    const dy = gy - m.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      const sp = INPUT_MAX_SPEED * mode.speed;
      desX += (dx / d) * sp;
      desY += (dy / d) * sp;
    }
  }
  let rx = (desX - wvx) * GAIN;
  let ry = (desY - wvy) * GAIN;
  if (m.grounded) {
    const [ex, ey] = externalAccel(sim, m);
    const k = INPUT_ACCEL * sim.level.physics.inputScale;
    rx -= ex / k;
    ry -= ey / k;
  }
  return quantizeInt(rx, ry);
}

/** Zero-input ballistic look-ahead: will this airborne marble fall to its death? */
export function doomed(sim: RaceSim, m: MarbleState): boolean {
  if (m.status !== "alive" || m.grounded) return false;
  let x = m.x;
  let y = m.y;
  let z = m.z;
  let vz = m.vz;
  const vx = m.vx;
  const vy = m.vy;
  const dt = 2 / TICK_HZ;
  for (let k = 0; k < 120; k++) {
    const zPrev = z;
    x += vx * dt;
    y += vy * dt;
    vz -= GRAVITY * dt;
    z += vz * dt;
    const g = sim.terrain.groundAt(x, y, sim.tick + 2 * k);
    if (g && vz <= 0 && z <= g.z && zPrev >= g.z - LAND_SNAP - 0.3) {
      return m.fallStartZ - g.z >= SHATTER_FALL_HEIGHT && !m.catapultFlight && !m.respawnDrop;
    }
    if (z < sim.killPlane) return true;
  }
  return false;
}

// ---------- search ----------

interface Node {
  parent: Node | null;
  /** Quantized inputs of this node's chunk, flattened [qx, qy, …]. */
  inputs: number[];
  /** Controller mode index that produced the chunk. */
  action: number;
  state: SimState | null;
  tick: number;
  hint: number;
  s: number;
  score: number;
  grounded: boolean;
  free: boolean;
  key: string;
  bucket: string;
}

function inputsOf(node: Node): number[] {
  const chunks: number[][] = [];
  for (let n: Node | null = node; n; n = n.parent) chunks.push(n.inputs);
  const out: number[] = [];
  for (let i = chunks.length - 1; i >= 0; i--) for (const v of chunks[i]!) out.push(v);
  return out;
}

function pairs(flat: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/**
 * Generator form, so callers can run it to completion (`searchSolve`) or in slices between
 * progress updates. Yields every few decision layers.
 */
export function* searchSteps(
  level: PlayableLevel,
  opts: SearchOptions,
): Generator<SearchProgress, SearchResult, void> {
  const guide = new Guide(opts.guide);
  const width = opts.beam ?? 10;
  const chunk = opts.chunk ?? 10;
  const maxTicks = Math.min(opts.maxTicks ?? Infinity, level.timing.timeLimit * TICK_HZ);
  const budget = opts.budget ?? 1_500_000;
  const maxBacktracks = opts.maxBacktracks ?? 24;
  const sim = new RaceSim(level, { players: 1 });
  const p = sim.players[0]!;
  let spent = 0;
  let backtracks = 0;
  let bestS = 0;
  let bestPos: [number, number] = [p.marble.x, p.marble.y];

  const root: Node = {
    parent: null,
    inputs: [],
    action: 0,
    state: captureSim(sim),
    tick: 0,
    hint: 0,
    s: 0,
    score: 0,
    grounded: true,
    free: true,
    key: "",
    bucket: "",
  };

  /** Restore a node's state into `sim`, rebuilding it from its parent when it was not kept. */
  const load = (node: Node): void => {
    if (node.state) {
      restoreSim(sim, node.state);
      return;
    }
    load(node.parent!);
    for (let i = 0; i + 1 < node.inputs.length; i += 2)
      sim.step([dequantize(node.inputs[i]!, node.inputs[i + 1]!)]);
    spent += node.inputs.length >> 1;
    node.state = captureSim(sim);
  };

  const layers: Node[][] = [[root]];
  /** Ranked candidates per layer (beyond the kept beam), used when backtracking. */
  const pools: Node[][] = [[root]];
  let k = 0;
  let widen = 0;
  const tries = new Map<number, number>();
  /** Best progress of each kept layer, to notice a stalled frontier. */
  const frontier: number[] = [0];

  for (;;) {
    const beam = layers[k]!;
    const wide = widen > 0;
    const children: Node[] = [];
    for (const node of beam) {
      load(node);
      const base = node.state!;
      const m0 = p.marble;
      const free = m0.status === "alive" && m0.grounded && !m0.inputLocked;
      const nActions = free ? PURSUIT.length + (wide ? RAW : 0) : 1;
      for (let a = 0; a < nActions; a++) {
        if (a > 0) restoreSim(sim, base);
        const mode = modeFor(free ? a : 0);
        const inputs: number[] = [];
        let dead = false;
        let goal = -1;
        const hold = { seg: node.hint };
        for (let t = 0; t < chunk; t++) {
          const m = p.marble;
          const q = control(sim, m, guide, hold.seg, mode, hold);
          inputs.push(q[0], q[1]);
          const ev = sim.step([dequantize(q[0], q[1])]);
          spent++;
          for (const e of ev) {
            if (e.t === "death") dead = true;
            else if (e.t === "goal") goal = e.tick;
          }
          if (dead || goal >= 0) break;
        }
        const hint = hold.seg;
        if (dead) continue;
        if (goal >= 0) {
          const flat = inputsOf(node);
          for (const v of inputs) flat.push(v);
          const runs = encodeRuns(pairs(flat));
          return { ok: true, runs, ticks: goal, spent, backtracks };
        }
        const m = p.marble;
        const pr = guide.project(m.x, m.y, hint);
        let score = pr.s - LATERAL * Math.abs(pr.lat);
        if (doomed(sim, m)) score -= DOOM_PENALTY;
        const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
        const band = sp < 1 ? 0 : sp < 3.5 ? 1 : sp < 6 ? 2 : 3;
        const qv = (v: number) => Math.round(v / 0.4);
        children.push({
          parent: node,
          inputs,
          action: a,
          state: null,
          tick: sim.tick,
          hint: pr.seg,
          s: pr.s,
          score,
          grounded: m.grounded,
          free,
          key: `${Math.round(m.x / 0.12)},${Math.round(m.y / 0.12)},${qv(m.vx)},${qv(m.vy)},${m.status},${m.grounded ? 1 : 0}`,
          bucket: `${Math.floor(m.x)},${Math.floor(m.y)},${band},${m.status}`,
        });
      }
    }

    children.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const perBucket = new Map<string, number>();
    const kept: Node[] = [];
    const pool: Node[] = [];
    const cap = wide ? 3 * width : width;
    for (const c of children) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      const nb = perBucket.get(c.bucket) ?? 0;
      if (kept.length < cap && nb < 2) {
        kept.push(c);
        perBucket.set(c.bucket, nb + 1);
      } else if (pool.length < 2 * width) pool.push(c);
    }
    // Fill the beam from the overflow if diversity left room.
    while (kept.length < cap && pool.length > 0) kept.push(pool.shift()!);
    for (const c of kept) {
      if (c.s > bestS && c.score > -DOOM_PENALTY / 2) {
        bestS = c.s;
        load(c);
        bestPos = [p.marble.x, p.marble.y];
      }
    }

    let top = -Infinity;
    for (const c of kept) if (c.score > -DOOM_PENALTY / 2 && c.s > top) top = c.s;
    const stalled = k >= STALL_LAYERS && top - frontier[k - STALL_LAYERS + 1]! < 0.5;
    if (
      stalled ||
      kept.length === 0 ||
      kept.every((c) => c.score < -DOOM_PENALTY / 2 && !c.grounded)
    ) {
      // Dead end or a frontier that stopped moving: back up and retry wider.
      backtracks++;
      if (backtracks > maxBacktracks)
        return {
          ok: false,
          reason: "stuck",
          spent,
          backtracks,
          progress: bestS / guide.total,
          pos: bestPos,
        };
      const n = (tries.get(k) ?? 0) + 1;
      tries.set(k, n);
      const back = Math.min(k, (stalled ? STALL_LAYERS : 3) + 5 * n);
      k -= back;
      layers.length = k + 1;
      pools.length = k + 1;
      frontier.length = k + 1;
      // Re-open the ranked overflow of the layer we return to.
      const merged = [...layers[k]!, ...pools[k]!];
      layers[k] = merged.slice(0, 3 * width);
      pools[k] = merged.slice(3 * width);
      widen = back + 8;
      continue;
    }

    k++;
    layers[k] = kept;
    pools[k] = pool;
    frontier[k] = Math.max(top, frontier[k - 1]!);
    // Drop states far behind the frontier; they can be rebuilt from their parents if needed.
    if (k > 40) for (const old of pools[k - 40]!) old.state = null;
    if (widen > 0) widen--;
    const tick = kept[0]!.tick;
    if (tick >= maxTicks)
      return {
        ok: false,
        reason: "timeout",
        spent,
        backtracks,
        progress: bestS / guide.total,
        pos: bestPos,
      };
    if (spent > budget)
      return {
        ok: false,
        reason: "budget",
        spent,
        backtracks,
        progress: bestS / guide.total,
        pos: bestPos,
      };
    if (k % 6 === 0) yield { tick, progress: Math.min(1, bestS / guide.total), spent };
  }
}

/** Run the search to completion. */
export function searchSolve(level: PlayableLevel, opts: SearchOptions): SearchResult {
  const it = searchSteps(level, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
