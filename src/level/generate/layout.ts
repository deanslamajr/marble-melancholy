// Direction-aware course cursor. Segments are written in a local frame — v runs along the heading,
// u across it — so the same segment code builds south, east or west runs (DECISIONS L15). Every
// write is checked against the 128×128 scratch grid and earlier pieces; a segment that collides is
// rolled back so the planner can try something else (L16).
import type { Rng } from "../../core/rng";
import { GRAVITY } from "../../sim/constants";
import type { Cell, CheckpointSource, EntitySource, PipeSource, Waypoint } from "../types";
import {
  ARROW_TO,
  CourseGrid,
  DIR_BIT,
  DV,
  E,
  S,
  SLOPE_TO,
  STEEP_TO,
  turnDir,
  type Dir,
  type SurfaceChar,
} from "./grid";
import type { Difficulty, ForkRisk, Tier } from "./tiers";

export const SIZE = 128;

export interface CornerStyle {
  railless: boolean;
  ice: boolean;
}

type Route = "both" | "risky" | "safe";

export class Layout {
  readonly g = new CourseGrid(SIZE, SIZE);
  /** Waypoints taking every risky line; `safe` takes every safe line (L18). */
  readonly risky: Waypoint[] = [];
  readonly safe: Waypoint[] = [];
  readonly entities: EntitySource[] = [];
  readonly checkpoints: CheckpointSource[] = [];
  d: Dir = S;
  ox: number;
  oy = 1;
  /** Lane: u..u+w-1 across the heading; `v` is the next row along it. */
  u = 0;
  v = 0;
  w: number;
  h: number;
  /** A safe flat cell at the end of the last segment (checkpoint and pipe-exit candidate). */
  rest: Cell | null = null;
  piece = 0;
  turns = 0;
  forks = 0;
  riskHazards = 0;
  /** While a pipe shortcut is open, the risky route skips ahead and gets no waypoints. */
  pending: PipeSource | null = null;
  private bad: string | null = null;
  /** Why the most recent failed `attempt` was rolled back. */
  lastFail: string | null = null;

  constructor(
    readonly rng: Rng,
    readonly difficulty: Difficulty,
    readonly tier: Tier,
    readonly baseW: number,
    startH: number,
    startX: number,
  ) {
    this.w = baseW;
    this.h = startH;
    this.ox = startX;
  }

  // ---------- frame ----------

  get cu(): number {
    return this.u + (this.w >> 1);
  }

  get u1(): number {
    return this.u + this.w - 1;
  }

  /** Height may only drop while heading toward the camera (south or east), L17. */
  get canDrop(): boolean {
    return this.d === S || this.d === E;
  }

  get hard(): boolean {
    return this.difficulty === "hard" || this.difficulty === "expert";
  }

  cell(u: number, v: number): Cell {
    const f = DV[this.d]!;
    const l = DV[turnDir(this.d, 1)]!;
    return [this.ox + l[0] * u + f[0] * v, this.oy + l[1] * u + f[1] * v];
  }

  private vec(s: number): [number, number] {
    const f = DV[this.d]!;
    return [f[0] * s, f[1] * s];
  }

  private rect(u0: number, v0: number, u1: number, v1: number): [number, number, number, number] {
    const a = this.cell(u0, v0);
    const b = this.cell(u1, v1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }

  intIn(lo: number, hi: number): number {
    return lo + this.rng.nextInt(hi - lo + 1);
  }

  chance(p: number): boolean {
    return p > 0 && this.rng.next() < p;
  }

  setWidth(nw: number): void {
    this.u += (this.w - nw) >> 1;
    this.w = nw;
  }

  // ---------- transactions ----------

  /** Run `build`; if it collides or leaves the grid, undo everything it did and return false. */
  attempt(build: () => void): boolean {
    const keep = {
      d: this.d,
      ox: this.ox,
      oy: this.oy,
      u: this.u,
      v: this.v,
      w: this.w,
      h: this.h,
      rest: this.rest,
      piece: this.piece,
      turns: this.turns,
      forks: this.forks,
      riskHazards: this.riskHazards,
      pending: this.pending,
      risky: this.risky.length,
      safe: this.safe.length,
      entities: this.entities.length,
      checkpoints: this.checkpoints.length,
    };
    this.bad = null;
    this.piece++;
    this.g.begin();
    build();
    if (this.bad === null) {
      this.g.commit();
      return true;
    }
    this.g.rollback();
    this.lastFail = this.bad;
    Object.assign(this, {
      d: keep.d,
      ox: keep.ox,
      oy: keep.oy,
      u: keep.u,
      v: keep.v,
      w: keep.w,
      h: keep.h,
      rest: keep.rest,
      piece: keep.piece,
      turns: keep.turns,
      forks: keep.forks,
      riskHazards: keep.riskHazards,
      pending: keep.pending,
    });
    this.risky.length = keep.risky;
    this.safe.length = keep.safe;
    this.entities.length = keep.entities;
    this.checkpoints.length = keep.checkpoints;
    return false;
  }

  private fail(why: string): void {
    this.bad ??= why;
  }

  /** Pieces may touch their two predecessors (a fork's branches touch its hall and merge). */
  private related(o: number): boolean {
    return o === this.piece || o === this.piece - 1 || o === this.piece - 2;
  }

  private put(x: number, y: number, h: number): void {
    if (x < 1 || y < 1 || x > SIZE - 2 || y > SIZE - 2) return this.fail("bounds");
    if (h < 0) return this.fail("height");
    const g = this.g;
    const i = g.idx(x, y);
    if (g.heights[i]! >= 0 && g.owner[i] !== this.piece) return this.fail("overlap");
    for (const [dx, dy] of DV) {
      const j = g.idx(x + dx, y + dy);
      if (g.heights[j]! >= 0 && !this.related(g.owner[j]!)) return this.fail("touch");
    }
    g.setGround(x, y, h, this.piece);
  }

  // ---------- local drawing ----------

  fill(u0: number, v0: number, u1: number, v1: number, h: number): void {
    for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++)
      for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) {
        const [x, y] = this.cell(u, v);
        this.put(x, y, h);
      }
  }

  /** A ramp across u0..u1 descending along the heading from `hTop`; returns the height after it. */
  private rampRect(u0: number, u1: number, v0: number, rows: number, hTop: number, steep: boolean) {
    if (!this.canDrop) this.fail("level");
    const step = steep ? 2 : 1;
    const ch = steep ? STEEP_TO[this.d]! : SLOPE_TO[this.d]!;
    for (let r = 0; r < rows; r++) {
      this.fill(u0, v0 + r, u1, v0 + r, hTop - r * step);
      for (let u = u0; u <= u1; u++) {
        const [x, y] = this.cell(u, v0 + r);
        this.g.setSlope(x, y, ch);
      }
    }
    return hTop - rows * step;
  }

  /** `F` paints a speed strip pushing along the heading. */
  surf(u0: number, v0: number, u1: number, v1: number, s: SurfaceChar | "F"): void {
    const ch = s === "F" ? ARROW_TO[this.d]! : s;
    const [x0, y0, x1, y1] = this.rect(u0, v0, u1, v1);
    this.g.surface(x0, y0, x1, y1, ch);
  }

  /** Leave edges unrailed: F forward, B back, + and - the two sides. */
  open(u0: number, v0: number, u1: number, v1: number, sides: string): void {
    let bits = 0;
    if (sides.includes("F")) bits |= DIR_BIT[this.d]!;
    if (sides.includes("B")) bits |= DIR_BIT[turnDir(this.d, 2)]!;
    if (sides.includes("+")) bits |= DIR_BIT[turnDir(this.d, 1)]!;
    if (sides.includes("-")) bits |= DIR_BIT[turnDir(this.d, 3)]!;
    const [x0, y0, x1, y1] = this.rect(u0, v0, u1, v1);
    this.g.openEdges(x0, y0, x1, y1, bits);
  }

  /** Both sides of the lane rows v0..v1 without rails. */
  private railless(v0: number, v1: number): void {
    this.open(this.u, v0, this.u, v1, "-");
    this.open(this.u1, v0, this.u1, v1, "+");
  }

  wpAt(at: Cell, speed: number, radius?: number, route: Route = "both", timed = false): void {
    const p: Waypoint = { at, speed };
    if (radius !== undefined) p.radius = radius;
    if (timed) p.timed = true;
    if (route !== "safe" && !this.pending) this.risky.push(p);
    if (route !== "risky") this.safe.push({ ...p });
  }

  wp(u: number, v: number, speed: number, radius?: number, route: Route = "both"): void {
    this.wpAt(this.cell(u, v), speed, radius, route);
  }

  flat(rows: number): void {
    this.fill(this.u, this.v, this.u1, this.v + rows - 1, this.h);
    this.v += rows;
    this.rest = this.cell(this.cu, this.v - 1);
  }

  ramp(rows: number, steep: boolean): void {
    this.h = this.rampRect(this.u, this.u1, this.v, rows, this.h, steep);
    this.v += rows;
  }

  // ---------- course pieces ----------

  start(): [Cell, Cell] {
    this.setWidth(Math.max(this.baseW, 4));
    this.flat(4);
    return [this.cell(this.cu, 1), this.cell(this.cu - 1, 1)];
  }

  goal(width: number): Cell {
    this.setWidth(width);
    this.flat(5);
    const at = this.cell(this.cu, this.v - 3);
    this.wpAt(at, 0.6);
    return at;
  }

  /** A w×w corner square, then continue heading `nd` (a quarter turn either way). */
  turn(nd: Dir, style: CornerStyle): void {
    const d = this.d;
    const rel = (nd - d + 4) & 3;
    if (rel !== 1 && rel !== 3) return this.fail("turn");
    const w = this.w;
    const v0 = this.v;
    const careful = style.railless || style.ice;
    if (careful) this.wp(this.cu, v0 - 1, 0.55);
    this.fill(this.u, v0, this.u1, v0 + w - 1, this.h);
    if (style.ice) this.surf(this.u, v0, this.u1, v0 + w - 1, "i");
    if (style.railless) {
      this.open(this.u, v0 + w - 1, this.u1, v0 + w - 1, "F");
      if (rel === 1) this.open(this.u, v0, this.u, v0 + w - 1, "-");
      else this.open(this.u1, v0, this.u1, v0 + w - 1, "+");
    }
    const centre = this.cell(this.cu, v0 + (w >> 1));
    this.wpAt(centre, careful ? 0.45 : 0.5, 0.7);
    const f = DV[d]!;
    const l = DV[turnDir(d, 1)]!;
    const [px, py] = this.cell(this.u, v0);
    if (rel === 1) {
      this.ox = px + l[0] * w + f[0] * (w - 1);
      this.oy = py + l[1] * w + f[1] * (w - 1);
    } else {
      this.ox = px - l[0];
      this.oy = py - l[1];
    }
    this.d = nd;
    this.u = 0;
    this.v = 0;
    this.turns++;
    this.rest = centre;
  }

  /**
   * True when a lane of the current width, `margin` cells wider on each side, is free of ground
   * for `length` rows — straight ahead, or after a corner toward `nd`.
   */
  clearAhead(length: number, nd: Dir = this.d, margin = 1): boolean {
    const w = this.w;
    let d = this.d;
    let ox = this.ox;
    let oy = this.oy;
    let u0 = this.u;
    let v0 = this.v;
    if (nd !== d) {
      const rel = (nd - d + 4) & 3;
      if (rel !== 1 && rel !== 3) return false;
      const f = DV[d]!;
      const l = DV[turnDir(d, 1)]!;
      const [px, py] = this.cell(this.u, this.v);
      if (rel === 1) {
        ox = px + l[0] * w + f[0] * (w - 1);
        oy = py + l[1] * w + f[1] * (w - 1);
      } else {
        ox = px - l[0];
        oy = py - l[1];
      }
      d = nd;
      u0 = 0;
      v0 = 0;
    }
    const f = DV[d]!;
    const l = DV[turnDir(d, 1)]!;
    for (let v = v0; v < v0 + length; v++)
      for (let u = u0 - margin; u < u0 + w + margin; u++) {
        const x = ox + l[0] * u + f[0] * v;
        const y = oy + l[1] * u + f[1] * v;
        if (x < 1 || y < 1 || x > SIZE - 2 || y > SIZE - 2) return false;
        if (this.g.heights[this.g.idx(x, y)]! >= 0) return false;
      }
    return true;
  }

  // ---------- segments ----------

  slope(): void {
    this.setWidth(this.baseW);
    this.ramp(this.intIn(3, 6), false);
    this.flat(2);
    this.wp(this.cu, this.v - 1, 0.9);
  }

  steep(): void {
    // Steep runs stay two rows (1.0 drop each) so a marble launched off the crest never falls
    // the 2.5 that shatters it (L13).
    this.setWidth(this.baseW);
    this.ramp(2, true);
    this.flat(2);
    if (this.rng.next() < 0.5) {
      this.ramp(2, true);
      this.flat(2);
    }
    this.wp(this.cu, this.v - 1, 0.8);
  }

  ledge(): void {
    this.setWidth(this.baseW);
    this.flat(2);
    if (this.hard && this.chance(this.tier.railless * 0.5)) this.railless(this.v - 2, this.v - 1);
    this.h -= this.intIn(this.tier.ledgeDrop[0], this.tier.ledgeDrop[1]);
    this.setWidth(Math.max(this.baseW, 3));
    this.flat(3);
    this.wp(this.cu, this.v - 1, 0.8);
  }

  jump(): void {
    this.setWidth(Math.max(this.baseW, 3));
    const gap = this.intIn(this.tier.jumpGap[0], this.tier.jumpGap[1]);
    this.ramp(3, false);
    if (gap === 2) {
      this.flat(2);
      this.surf(this.u, this.v - 2, this.u1, this.v - 1, "F");
    }
    const edgeRow = this.v - 1;
    this.open(this.u, edgeRow, this.u1, edgeRow, "F");
    this.wp(this.cu, edgeRow, 1.0);
    this.v += gap;
    this.h -= gap === 1 ? 2 : this.intIn(3, 4);
    this.open(this.u, this.v, this.u1, this.v, "B");
    this.flat(4);
    this.wp(this.cu, this.v - 2, 0.9, 0.8);
  }

  jog(): void {
    this.setWidth(this.baseW);
    // Sideways shifts in east/west runs go south, away from the tier above.
    const south = this.d === E ? 1 : this.d === S ? 0 : -1;
    const dir = south !== 0 ? south : this.rng.next() < 0.5 ? -1 : 1;
    const du = dir * this.intIn(2, 4);
    const rows = this.w + 1;
    const mid = this.v + (rows >> 1);
    this.fill(Math.min(this.u, this.u + du), this.v, Math.max(this.u1, this.u1 + du), mid, this.h);
    this.fill(this.u + du, mid + 1, this.u1 + du, this.v + rows - 1, this.h);
    this.wp(this.cu, mid, 0.55, 0.7);
    this.u += du;
    this.wp(this.cu, mid, 0.55, 0.7);
    this.v += rows;
    this.rest = this.cell(this.cu, this.v - 1);
  }

  /** Returns true when the narrows lost their rails (a precision section). */
  narrows(allowBare: boolean): boolean {
    this.setWidth(this.hard ? 2 : 3);
    const v0 = this.v;
    if (this.canDrop) this.ramp(4, false);
    else this.flat(4);
    this.flat(2);
    const bare = allowBare && this.chance(this.tier.railless);
    if (bare) this.railless(v0, this.v - 1);
    this.wp(this.cu, this.v - 1, 0.8);
    return bare;
  }

  ice(): void {
    this.setWidth(this.baseW);
    const v0 = this.v;
    this.flat(2);
    if (this.canDrop && this.rng.next() < 0.5) this.ramp(2, false);
    this.flat(3);
    this.surf(this.u, v0, this.u1, this.v - 1, "i");
    this.flat(1);
    this.wp(this.cu, this.v - 1, 0.7);
  }

  wave(): void {
    this.setWidth(this.baseW);
    const v0 = this.v;
    this.flat(7);
    this.entities.push({
      type: "wave",
      rect: this.rect(this.u, v0 + 1, this.u1, v0 + 5),
      amplitude: this.tier.waveAmp,
      wavelength: 3,
      speed: 1.5,
      dir: this.vec(1),
    });
    this.wp(this.cu, this.v - 1, 0.8);
  }

  /** Signature set-piece: a long swell, without side rails on the harder tiers. */
  waveCrossing(allowBare: boolean): boolean {
    this.setWidth(Math.max(this.baseW, 3));
    const v0 = this.v;
    this.flat(11);
    const bare = allowBare && this.hard && this.chance(this.tier.railless);
    if (bare) this.railless(v0 + 1, v0 + 9);
    this.entities.push({
      type: "wave",
      rect: this.rect(this.u, v0 + 1, this.u1, v0 + 9),
      amplitude: Math.min(0.5, this.tier.waveAmp + 0.08),
      wavelength: 4,
      speed: 2,
      dir: this.vec(1),
    });
    this.wp(this.cu, v0 + 5, 0.7);
    this.wp(this.cu, this.v - 1, 0.7);
    return bare;
  }

  speed(): void {
    this.setWidth(this.baseW);
    this.flat(2);
    this.flat(3);
    this.surf(this.u, this.v - 3, this.u1, this.v - 1, "F");
    this.flat(3);
    this.wp(this.cu, this.v - 1, 0.9);
  }

  acid(): void {
    this.setWidth(Math.max(this.baseW, this.hard ? 4 : 5));
    const v0 = this.v;
    const { u, u1 } = this;
    if (this.hard) {
      // Two acid strips on alternate sides with two clean rows between, where the line crosses over.
      this.flat(8);
      const half = this.w >> 1;
      this.surf(u, v0 + 1, u + half - 1, v0 + 2, "a");
      this.surf(u1 - half + 1, v0 + 5, u1, v0 + 6, "a");
      this.weave(u1, u, v0, "both");
    } else {
      this.flat(7);
      this.surf(u, v0 + 1, u, v0 + 5, "a");
      this.surf(u1, v0 + 1, u1, v0 + 5, "a");
      this.wp(this.cu, v0 + 5, 0.7);
    }
    this.wp(this.cu, this.v - 1, 0.7);
  }

  /**
   * Down column `a` past acid in rows v0+1..2, across in clean rows v0+3..4, down `b` past rows
   * 5..6 into clean row 7 (needs 8 rows), so no leg cuts diagonally past a strip.
   */
  private weave(a: number, b: number, v0: number, route: Route): void {
    this.wp(a, v0 + 1, 0.5, undefined, route);
    this.wp(a, v0 + 3, 0.45, 0.5, route);
    this.wp(b, v0 + 4, 0.45, 0.5, route);
    this.wp(b, v0 + 7, 0.5, 0.5, route);
  }

  hammer(): void {
    this.setWidth(Math.max(this.baseW, 4));
    const v0 = this.v;
    this.flat(6);
    const left = this.rng.next() < 0.5;
    const hu = left ? this.u : this.u1;
    const su = left ? this.u1 : this.u;
    const period = (20 + this.rng.nextInt(9)) / 10;
    this.entities.push({
      type: "hammer",
      at: this.cell(hu, v0 + 2),
      period,
      phase: this.rng.nextInt(20) / 10,
    });
    if (this.hard)
      this.entities.push({
        type: "hammer",
        at: this.cell(hu, v0 + 4),
        period,
        phase: this.rng.nextInt(20) / 10,
      });
    this.wp(su, v0 + 1, 0.7);
    this.wp(su, v0 + 5, 0.7);
  }

  /**
   * Timed gauntlet: gates of hammers spanning the whole lane, three rows apart, so the marble must
   * wait for each to lift. Waypoints after a gate are `timed` (autopilot waits, DECISIONS M14).
   */
  gauntlet(): void {
    this.setWidth(Math.max(2, Math.min(this.baseW, 3)));
    const gates = this.tier.gauntletGates;
    const v0 = this.v;
    this.flat(2 + 3 * gates + 1);
    this.wp(this.cu, v0, 0.35, 0.4);
    for (let i = 0; i < gates; i++) {
      const gv = v0 + 2 + 3 * i;
      const period = (24 + this.rng.nextInt(9)) / 10;
      const phase = this.rng.nextInt(24) / 10;
      for (let u = this.u; u <= this.u1; u++)
        this.entities.push({ type: "hammer", at: this.cell(u, gv), period, phase });
      const last = i === gates - 1;
      this.wpAt(this.cell(this.cu, gv + 1), last ? 0.7 : 0.55, 0.4, "both", true);
    }
    this.wp(this.cu, this.v - 1, 0.7);
  }

  steelie(): void {
    const speed = (20 + this.rng.nextInt(10)) / 10;
    const narrow = this.difficulty === "expert" || (this.hard && this.rng.next() < 0.5);
    this.setWidth(narrow ? 3 : 5);
    const v0 = this.v;
    this.flat(7);
    if (!narrow && this.hard) {
      const a = this.cell(this.u, v0 + 3);
      const b = this.cell(this.u1, v0 + 3);
      this.entities.push({ type: "steelie", at: a, mode: "patrol", path: [a, b], speed });
      this.wp(this.cu, this.v - 1, 0.9);
      return;
    }
    const left = this.rng.next() < 0.5;
    const pu = left ? this.u : this.u1;
    const su = left ? this.u1 : this.u;
    const a = this.cell(pu, v0 + 1);
    const b = this.cell(pu, v0 + 5);
    this.entities.push({ type: "steelie", at: a, mode: "patrol", path: [a, b], speed });
    this.wp(su, v0 + 1, 0.7);
    this.wp(su, v0 + 5, 0.7);
    this.wp(this.cu, this.v - 1, 0.7);
  }

  /** A two-cell alcove beside a straight; returns its outer and inner cells and the far lane column. */
  private alcove(): { outer: number; inner: number; far: number; v0: number } {
    this.setWidth(Math.max(this.baseW, 3));
    const v0 = this.v;
    this.flat(6);
    const left = this.rng.next() < 0.5;
    const a0 = left ? this.u - 2 : this.u1 + 1;
    this.fill(a0, v0 + 2, a0 + 1, v0 + 4, this.h);
    return {
      outer: left ? this.u - 2 : this.u1 + 2,
      inner: left ? this.u - 1 : this.u1 + 1,
      far: left ? this.u1 : this.u,
      v0,
    };
  }

  hoover(): void {
    const a = this.alcove();
    const reach = Math.abs(a.outer - a.far) + 1;
    this.entities.push({
      type: "hoover",
      at: this.cell(a.outer, a.v0 + 3),
      pullRadius: Math.min(6, reach),
      pullStrength: this.tier.hooverPull,
      killRadius: 0.4,
      onTime: 1.5,
      offTime: 1.5,
      phase: this.rng.nextInt(30) / 10,
    });
    this.wp(a.far, a.v0 + 1, 0.9);
    this.wp(a.far, a.v0 + 5, 0.9);
  }

  muncher(): void {
    const a = this.alcove();
    const gapCells = Math.abs(a.inner - a.far);
    this.entities.push({
      type: "muncher",
      at: this.cell(a.inner, a.v0 + 3),
      triggerRadius: Math.min(3, gapCells + 0.3),
      digestTime: 1.5,
    });
    this.wp(a.far, a.v0 + 1, 0.9);
    this.wp(a.far, a.v0 + 5, 0.9);
  }

  /** Landing row (local v) of a catapult launch from pad row `padV` that falls `drop` half-units. */
  private landingRow(padV: number, vy: number, vz: number, drop: number): number {
    const fall = drop / 2;
    const t = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * fall)) / GRAVITY;
    return Math.floor(padV + 0.5 + vy * t);
  }

  catapult(): void {
    this.setWidth(Math.max(this.baseW, 3));
    const v0 = this.v;
    this.flat(3);
    const padV = v0 + 1;
    const vy = this.hard ? 6 + this.rng.nextInt(3) : 5 + this.rng.nextInt(3);
    const vz = 6;
    const drop = this.intIn(2, 4);
    const landV = this.landingRow(padV, vy, vz, drop);
    const first = Math.max(this.v + 1, landV - 2);
    this.entities.push({
      type: "catapult",
      at: this.cell(this.cu, padV),
      launch: [...this.vec(vy), vz],
    });
    this.wp(this.cu, padV, 0.5, 0.2);
    this.v = first;
    this.h -= drop;
    this.flat(landV + 4 - first);
    this.wp(this.cu, this.v - 1, 0.7);
  }

  funnel(): void {
    this.setWidth(5);
    const v0 = this.v;
    this.flat(5);
    const centre = this.cell(this.cu, v0 + 2);
    this.v += 2;
    this.h -= this.intIn(2, 3);
    const exit = this.cell(this.cu, this.v + 1);
    this.flat(4);
    this.entities.push({
      type: "funnel",
      at: centre,
      radius: 2,
      depth: 1,
      exit,
      exitVelocity: [...this.vec(2), 0],
      travelTime: 0.8,
    });
    this.wpAt(centre, 0.6, 0.2);
    this.wp(this.cu, this.v - 1, 0.7);
  }

  /**
   * Signature set-piece: a wide room with two funnels. One drops to the landing below; the other
   * spits the marble back out at the room entrance (a time penalty, never a death).
   */
  funnelMaze(): void {
    this.setWidth(Math.max(this.baseW, 3));
    const v0 = this.v;
    const c = this.cu;
    this.fill(c - 5, v0, c + 5, v0 + 6, this.h);
    const good = this.rng.next() < 0.5 ? -3 : 3;
    const entryCell = this.cell(c, v0);
    this.v = v0 + 9;
    this.h -= this.intIn(2, 3);
    const landing = this.cell(c, this.v + 1);
    this.flat(4);
    for (const du of [good, -good]) {
      const ok = du === good;
      this.entities.push({
        type: "funnel",
        at: this.cell(c + du, v0 + 3),
        radius: 2,
        depth: 1,
        exit: ok ? landing : entryCell,
        exitVelocity: [...this.vec(ok ? 2 : 1.5), 0],
        travelTime: 0.8,
      });
    }
    this.wp(c, v0 + 1, 0.6);
    this.wp(c + good, v0 + 3, 0.6, 0.2);
    this.wp(this.cu, this.v - 1, 0.7);
  }

  pipe(): void {
    this.setWidth(this.baseW);
    const v0 = this.v;
    this.flat(3);
    const entry = this.cell(this.cu, v0 + 2);
    this.v += 2;
    this.h -= this.intIn(2, 3);
    const exit = this.cell(this.cu, this.v);
    this.flat(4);
    this.entities.push({
      type: "pipe",
      entry,
      exit,
      exitVelocity: [...this.vec(3), 0],
      travelTime: (8 + this.rng.nextInt(5)) / 10,
    });
    this.wpAt(entry, 0.4, 0.2);
    this.wp(this.cu, this.v - 1, 0.8);
  }

  /** A 2×2 platform ferrying the marble over a void gap; only its columns are unrailed. */
  ferry(): void {
    const t = this.tier.ferry;
    this.setWidth(Math.max(this.baseW, 3));
    this.flat(2);
    const edge = this.v - 1;
    const pu = this.u + ((this.w - 2) >> 1);
    const gap = this.intIn(t.gap[0], t.gap[1]);
    this.open(pu, edge, pu + 1, edge, "F");
    this.v += gap;
    const land = this.v;
    this.open(pu, land, pu + 1, land, "B");
    this.flat(3);
    const a = this.rect(pu, edge + 1, pu + 1, edge + 2);
    const b = this.rect(pu, land - 2, pu + 1, land - 1);
    this.entities.push({
      type: "platform",
      at: [a[0], a[1]],
      size: [2, 2],
      top: this.h,
      path: [
        [a[0], a[1]],
        [b[0], b[1]],
      ],
      speed: t.speed,
      pause: t.pause,
      phase: this.rng.nextInt(10) / 10,
    });
    this.wp(this.cu, edge, 0.6);
    // Board straight onto the deck's front row, so the marble is already over the far cell when
    // the platform docks and only has to roll off during the pause.
    this.wp(pu, edge, 0.4, 0.3);
    this.wp(pu, edge + 2, 0.4, 0.4);
    this.wp(pu, land - 1, 0.4, 0.45);
    this.wpAt(this.cell(this.cu, land + 1), 0.7, undefined, "both", true);
  }

  // ---------- branching ----------

  /**
   * Split and rejoin (L18): a short risky line straight ahead and a longer, railed safe line
   * offset to one side. Both end at the same height in a shared merge hall.
   */
  fork(risk: ForkRisk, side: 1 | -1): void {
    this.setWidth(Math.max(this.baseW, 3));
    const { u, u1 } = this;
    const lw = this.w;
    const gap = this.intIn(2, 3);
    const sw = Math.max(3, this.baseW);
    const s0 = side > 0 ? u1 + gap + 1 : u - gap - sw;
    const s1 = s0 + sw - 1;
    const scu = s0 + (sw >> 1);
    const hu0 = Math.min(u, s0);
    const hu1 = Math.max(u1, s1);
    const rw = risk === "ledge" || risk === "hammers" ? 2 : 3;
    const r0 = u + ((lw - rw) >> 1);
    const r1 = r0 + rw - 1;
    const rcu = r0 + (rw >> 1);
    const v0 = this.v;
    const h0 = this.h;
    this.fill(hu0, v0, hu1, v0 + 2, h0);
    this.wp(this.cu, v0 + 1, 0.7);
    const bv = v0 + 3;

    this.piece++;
    let len: number;
    let drop = 0;
    switch (risk) {
      case "ledge": {
        len = this.intIn(6, 8);
        drop = this.canDrop ? this.intIn(2, 3) : 0;
        this.fill(r0, bv, r1, bv, h0);
        if (drop > 0) this.rampRect(r0, r1, bv + 1, drop, h0, false);
        this.fill(r0, bv + 1 + drop, r1, bv + len - 1, h0 - drop);
        this.open(r0, bv, r0, bv + len - 1, "-");
        this.open(r1, bv, r1, bv + len - 1, "+");
        this.wp(rcu, bv, 0.7, undefined, "risky");
        this.wp(rcu, bv + len - 1, 0.85, undefined, "risky");
        break;
      }
      case "gap": {
        len = 9;
        drop = this.intIn(3, 4);
        if (!this.canDrop) this.fail("level");
        this.fill(r0, bv, r1, bv + 2, h0);
        this.surf(r0, bv + 1, r1, bv + 2, "F");
        this.open(r0, bv + 2, r1, bv + 2, "F");
        this.fill(r0, bv + 5, r1, bv + len - 1, h0 - drop);
        this.open(r0, bv + 5, r1, bv + 5, "B");
        this.wp(rcu, bv, 0.8, undefined, "risky");
        this.wp(rcu, bv + 2, 1.0, undefined, "risky");
        this.wp(rcu, bv + 6, 0.9, 0.8, "risky");
        break;
      }
      case "acid": {
        len = 8;
        this.fill(r0, bv, r1, bv + len - 1, h0);
        const strip = r1 - r0 - 1;
        this.surf(r0, bv + 1, r0 + strip, bv + 2, "a");
        this.surf(r1 - strip, bv + 5, r1, bv + 6, "a");
        this.weave(r1, r0, bv, "risky");
        this.riskHazards++;
        break;
      }
      case "hammers": {
        len = 7;
        this.fill(r0, bv, r1, bv + len - 1, h0);
        const period = (20 + this.rng.nextInt(9)) / 10;
        this.entities.push({
          type: "hammer",
          at: this.cell(r0, bv + 2),
          period,
          phase: this.rng.nextInt(20) / 10,
        });
        this.entities.push({
          type: "hammer",
          at: this.cell(r1, bv + 4),
          period,
          phase: this.rng.nextInt(20) / 10,
        });
        this.wp(r1, bv + 1, 0.6, undefined, "risky");
        this.wp(r1, bv + 2, 0.6, undefined, "risky");
        this.wp(r0, bv + 3, 0.6, undefined, "risky");
        this.wp(r0, bv + 5, 0.6, undefined, "risky");
        this.riskHazards++;
        break;
      }
      case "catapult": {
        if (!this.canDrop) this.fail("level");
        drop = this.intIn(2, 4);
        const padV = bv + 1;
        const vy = 6 + this.rng.nextInt(2);
        const landV = this.landingRow(padV, vy, 6, drop);
        const first = Math.max(bv + 4, landV - 2);
        len = landV + 4 - bv;
        this.fill(r0, bv, r1, bv + 2, h0);
        this.fill(r0, first, r1, bv + len - 1, h0 - drop);
        this.entities.push({
          type: "catapult",
          at: this.cell(rcu, padV),
          launch: [...this.vec(vy), 6],
        });
        this.wp(rcu, padV, 0.5, 0.2, "risky");
        break;
      }
    }
    this.wp(rcu, bv + len - 1, 0.8, undefined, "risky");
    if (len < drop + 2) this.fail("fork");

    this.piece++;
    this.fill(s0, bv, s1, bv, h0);
    if (drop > 0) this.rampRect(s0, s1, bv + 1, drop, h0, false);
    this.fill(s0, bv + 1 + drop, s1, bv + len - 1, h0 - drop);
    this.wp(scu, v0 + 1, 0.6, undefined, "safe");
    this.wp(scu, bv + len - 1, 0.8, undefined, "safe");

    this.piece++;
    const mv = bv + len;
    this.h = h0 - drop;
    this.fill(hu0, mv, hu1, mv + 2, this.h);
    this.wp(scu, mv + 1, 0.6, undefined, "safe");
    this.v = mv + 3;
    this.rest = this.cell(this.cu, this.v - 1);
    this.wp(this.cu, mv + 2, 0.7);
    this.forks++;
  }

  /**
   * Pipe shortcut (L18): a short unrailed spur beside the lane ends in a pipe whose exit is placed
   * a few segments later by `closeShortcut`. The risky route takes it; the safe route goes around.
   */
  shortcut(side: 1 | -1): void {
    this.setWidth(Math.max(this.baseW, 3));
    const v0 = this.v;
    this.flat(4);
    const len = this.intIn(2, 3);
    const a0 = side > 0 ? this.u1 + 1 : this.u - len;
    const a1 = a0 + len - 1;
    this.fill(a0, v0 + 1, a1, v0 + 2, this.h);
    const near = side > 0 ? a0 : a1;
    const end = side > 0 ? a1 : a0;
    if (this.difficulty !== "easy") {
      this.open(a0, v0 + 1, a1, v0 + 1, "B");
      this.open(a0, v0 + 2, a1, v0 + 2, "F");
      this.open(end, v0 + 1, end, v0 + 2, side > 0 ? "+" : "-");
    }
    const entry = this.cell(end, v0 + 1);
    const pipe: PipeSource = {
      type: "pipe",
      entry,
      exit: entry,
      exitVelocity: [0, 0, 0],
      travelTime: (8 + this.rng.nextInt(5)) / 10,
    };
    this.entities.push(pipe);
    this.wp(this.cu, v0 + 1, 0.6, undefined, "risky");
    this.wp(near, v0 + 1, 0.45, 0.4, "risky");
    this.wpAt(entry, 0.4, 0.2, "risky");
    this.wp(this.cu, v0 + 3, 0.8, undefined, "safe");
    this.pending = pipe;
    this.forks++;
  }

  /** Put the open shortcut's exit at the current rest cell, rolling on along the heading. */
  closeShortcut(): boolean {
    const p = this.pending;
    if (!p || !this.rest) return false;
    p.exit = this.rest;
    p.exitVelocity = [...this.vec(2.5), 0];
    this.pending = null;
    return true;
  }

  /**
   * Finale set-piece (L21): a tight inward spiral of four corners ending at the goal. Drops happen
   * only on the two legs that head toward the camera; the inner legs are level so nothing hides.
   */
  spiral(): Cell | null {
    if (!this.canDrop || this.h < 8) {
      this.fail("spiral");
      return null;
    }
    const k = this.d === S ? 3 : 1;
    const corner: CornerStyle = { railless: false, ice: false };
    this.setWidth(3);
    this.ramp(4, false);
    this.flat(4);
    this.wp(this.cu, this.v - 1, 0.7);
    this.turn(turnDir(this.d, k), corner);
    this.ramp(2, false);
    this.flat(4);
    this.wp(this.cu, this.v - 1, 0.7);
    this.turn(turnDir(this.d, k), corner);
    this.flat(4);
    this.turn(turnDir(this.d, k), corner);
    this.flat(2);
    this.turn(turnDir(this.d, k), corner);
    this.flat(3);
    const at = this.cell(this.cu, this.v - 2);
    this.wpAt(at, 0.6);
    return at;
  }
}
