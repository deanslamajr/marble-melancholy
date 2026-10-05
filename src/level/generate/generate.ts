// Procedural course generator: seed + difficulty (+ theme) → LevelSource with a waypoint solution.
// Pure and deterministic (D06, D07): mulberry32 only, no transcendental Math, no clocks.
import { fnv1a32 } from "../../core/hash";
import { Rng } from "../../core/rng";
import { GRAVITY } from "../../sim/constants";
import {
  MUSIC_IDS,
  THEME_IDS,
  type Cell,
  type CheckpointSource,
  type EntitySource,
  type LevelSource,
  type MusicId,
  type ThemeId,
  type Waypoint,
} from "../types";
import { CourseGrid, EDGE } from "./grid";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface GenerateOptions {
  seed: number;
  difficulty: Difficulty;
  theme?: ThemeId;
}

export type SegmentKind =
  | "slope"
  | "steep"
  | "ledge"
  | "jump"
  | "jog"
  | "narrows"
  | "ice"
  | "wave"
  | "speed"
  | "acid"
  | "hammer"
  | "steelie"
  | "hoover"
  | "muncher"
  | "catapult"
  | "funnel"
  | "pipe";

export interface GeneratedSource {
  source: LevelSource;
  segments: SegmentKind[];
  /** The seed this layout was built from (the requested seed or a derived retry seed). */
  layoutSeed: number;
}

/** Placeholder timing; `generateLevel` replaces it with values derived from the solution time. */
export const DRAFT_TIMING = { timeLimit: 99, par: 98, timeBonus: 5 } as const;

const GRID_W = 24;
const MAX_ROWS = 128;
const HAZARDS: ReadonlySet<SegmentKind> = new Set([
  "acid",
  "hammer",
  "steelie",
  "hoover",
  "muncher",
]);

interface Tier {
  segments: [min: number, max: number];
  widths: [min: number, max: number];
  startHeight: number;
  maxHazards: number;
  weights: Partial<Record<SegmentKind, number>>;
  goalScore: number;
}

const TIERS: Record<Difficulty, Tier> = {
  easy: {
    segments: [5, 6],
    widths: [5, 6],
    startHeight: 30,
    maxHazards: 1,
    goalScore: 1000,
    weights: {
      slope: 3,
      steep: 1,
      ledge: 2,
      jump: 2,
      jog: 2,
      speed: 1,
      ice: 1,
      wave: 1,
      acid: 1,
      pipe: 1,
    },
  },
  medium: {
    segments: [7, 8],
    widths: [4, 5],
    startHeight: 33,
    maxHazards: 3,
    goalScore: 1500,
    weights: {
      slope: 2,
      steep: 2,
      ledge: 1,
      jump: 3,
      jog: 2,
      narrows: 1,
      ice: 1,
      wave: 1,
      speed: 1,
      acid: 2,
      hammer: 2,
      steelie: 1,
      hoover: 1,
      catapult: 1,
      funnel: 1,
      pipe: 1,
    },
  },
  hard: {
    segments: [9, 10],
    widths: [3, 4],
    startHeight: 35,
    maxHazards: 6,
    goalScore: 2000,
    weights: {
      slope: 1,
      steep: 2,
      ledge: 1,
      jump: 3,
      jog: 2,
      narrows: 2,
      ice: 1,
      wave: 1,
      acid: 2,
      hammer: 2,
      steelie: 2,
      hoover: 1,
      muncher: 1,
      catapult: 1,
      funnel: 1,
    },
  },
};

/** Worst-case height (half-units) a segment may consume; the planner keeps the course above 0. */
const MAX_DROP: Record<SegmentKind, number> = {
  slope: 6,
  steep: 8,
  ledge: 3,
  jump: 7,
  jog: 0,
  narrows: 4,
  ice: 2,
  wave: 0,
  speed: 0,
  acid: 0,
  hammer: 0,
  steelie: 0,
  hoover: 0,
  muncher: 0,
  catapult: 4,
  funnel: 3,
  pipe: 3,
};

/** Worst-case rows a segment may use (catapult landings depend on the launch). */
const MAX_ROWS_PER: Record<SegmentKind, number> = {
  slope: 8,
  steep: 8,
  ledge: 5,
  jump: 11,
  jog: 7,
  narrows: 6,
  ice: 8,
  wave: 7,
  speed: 8,
  acid: 7,
  hammer: 6,
  steelie: 7,
  hoover: 6,
  muncher: 6,
  catapult: 16,
  funnel: 11,
  pipe: 9,
};

const ADJECTIVES = [
  "Grey",
  "Hollow",
  "Quiet",
  "Weeping",
  "Lonely",
  "Faded",
  "Sunken",
  "Drizzly",
  "Wistful",
  "Pale",
  "Sombre",
  "Misty",
  "Brittle",
  "Gloomy",
  "Lost",
  "Slow",
];
const NOUNS = [
  "Drift",
  "Spiral",
  "Gutter",
  "Terrace",
  "Causeway",
  "Hollow",
  "Steps",
  "Chute",
  "Ledges",
  "Slide",
  "Run",
  "Descent",
  "Cascade",
  "Track",
  "Lanes",
  "Fall",
];

/** Retry seeds: attempt 0 is the requested seed, later attempts hash it with the attempt number. */
export function attemptSeed(seed: number, attempt: number): number {
  return attempt === 0 ? seed >>> 0 : fnv1a32(`${seed >>> 0}:${attempt}`);
}

export function generatedId(difficulty: Difficulty, seed: number): string {
  return `gen-${difficulty}-${seed >>> 0}`;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.nextInt(items.length)]!;
}

function intIn(rng: Rng, lo: number, hi: number): number {
  return lo + rng.nextInt(hi - lo + 1);
}

function weighted(rng: Rng, weights: ReadonlyArray<[SegmentKind, number]>): SegmentKind {
  let total = 0;
  for (const [, w] of weights) total += w;
  let r = rng.next() * total;
  for (const [k, w] of weights) {
    r -= w;
    if (r < 0) return k;
  }
  return weights[weights.length - 1]![0];
}

class Layout {
  readonly g = new CourseGrid(GRID_W, MAX_ROWS);
  readonly points: Waypoint[] = [];
  readonly entities: EntitySource[] = [];
  readonly checkpoints: CheckpointSource[] = [];
  x: number;
  w: number;
  y = 1;
  h: number;
  /** A safe flat cell at the end of the last segment (checkpoint candidate). */
  rest: Cell | null = null;

  constructor(
    readonly rng: Rng,
    readonly difficulty: Difficulty,
    readonly baseW: number,
    startH: number,
  ) {
    this.w = baseW;
    this.x = Math.floor((GRID_W - baseW) / 2);
    this.h = startH;
  }

  get cx(): number {
    return this.x + (this.w >> 1);
  }

  get x1(): number {
    return this.x + this.w - 1;
  }

  setWidth(nw: number): void {
    let nx = this.x + Math.floor((this.w - nw) / 2);
    nx = Math.max(1, Math.min(GRID_W - 1 - nw, nx));
    this.x = nx;
    this.w = nw;
  }

  wp(x: number, y: number, speed: number, radius?: number): void {
    const p: Waypoint = { at: [x, y], speed };
    if (radius !== undefined) p.radius = radius;
    this.points.push(p);
  }

  flat(rows: number): void {
    this.g.fill(this.x, this.y, this.x1, this.y + rows - 1, this.h);
    this.y += rows;
    this.rest = [this.cx, this.y - 1];
  }

  ramp(rows: number, steep: boolean): void {
    this.h = this.g.rampS(this.x, this.x1, this.y, rows, this.h, steep);
    this.y += rows;
  }

  start(): void {
    this.setWidth(Math.max(this.baseW, 4));
    this.flat(4);
  }

  goal(): Cell {
    this.setWidth(Math.max(this.baseW, 5));
    this.flat(5);
    const at: Cell = [this.cx, this.y - 3];
    this.wp(at[0], at[1], 0.6);
    return at;
  }

  // ---------- segments ----------

  slope(): void {
    this.setWidth(this.baseW);
    this.ramp(intIn(this.rng, 3, 6), false);
    this.flat(2);
    this.wp(this.cx, this.y - 1, 0.9);
  }

  steep(): void {
    // Steep runs stay two rows (1.0 drop each) so a marble launched off the crest never falls
    // the 2.5 that shatters it.
    this.setWidth(this.baseW);
    this.ramp(2, true);
    this.flat(2);
    if (this.rng.next() < 0.5) {
      this.ramp(2, true);
      this.flat(2);
    }
    this.wp(this.cx, this.y - 1, 0.8);
  }

  ledge(): void {
    this.setWidth(this.baseW);
    this.flat(2);
    this.h -= intIn(this.rng, 2, 3);
    this.flat(3);
    this.wp(this.cx, this.y - 1, 0.8);
  }

  jump(): void {
    this.setWidth(this.baseW);
    const gap =
      this.difficulty === "easy" ? 1 : this.difficulty === "medium" ? intIn(this.rng, 1, 2) : 2;
    this.ramp(3, false);
    if (gap === 2) {
      this.flat(2);
      this.g.surface(this.x, this.y - 2, this.x1, this.y - 1, "v");
    }
    const edgeRow = this.y - 1;
    this.g.openEdges(this.x, edgeRow, this.x1, edgeRow, EDGE.S);
    this.wp(this.cx, edgeRow, 1.0);
    this.y += gap;
    this.h -= gap === 1 ? 2 : intIn(this.rng, 3, 4);
    this.g.openEdges(this.x, this.y, this.x1, this.y, EDGE.N);
    this.flat(4);
    this.wp(this.cx, this.y - 2, 0.9, 0.8);
  }

  jog(): void {
    this.setWidth(this.baseW);
    const room = { left: this.x - 1, right: GRID_W - 2 - this.x1 };
    let dir = this.rng.next() < 0.5 ? -1 : 1;
    if ((dir < 0 ? room.left : room.right) < 2) dir = -dir;
    const max = Math.min(5, dir < 0 ? room.left : room.right);
    if (max < 2) return this.ledge();
    const dx = dir * intIn(this.rng, 2, max);
    const rows = this.w + 1;
    const mid = this.y + (rows >> 1);
    this.g.fill(
      Math.min(this.x, this.x + dx),
      this.y,
      Math.max(this.x1, this.x1 + dx),
      this.y + rows - 1,
      this.h,
    );
    this.wp(this.cx, mid, 0.55, 0.7);
    this.x += dx;
    this.wp(this.cx, mid, 0.55, 0.7);
    this.y += rows;
    this.rest = [this.cx, this.y - 1];
  }

  narrows(): void {
    this.setWidth(this.difficulty === "hard" ? 2 : 3);
    this.ramp(4, false);
    this.flat(2);
    this.wp(this.cx, this.y - 1, 0.8);
  }

  ice(): void {
    this.setWidth(this.baseW);
    const y0 = this.y;
    this.flat(2);
    if (this.rng.next() < 0.5) this.ramp(2, false);
    this.flat(3);
    this.g.surface(this.x, y0, this.x1, this.y - 1, "i");
    this.flat(1);
    this.wp(this.cx, this.y - 1, 0.7);
  }

  wave(): void {
    this.setWidth(this.baseW);
    const y0 = this.y;
    this.flat(7);
    const amplitude = { easy: 0.2, medium: 0.28, hard: 0.35 }[this.difficulty];
    this.entities.push({
      type: "wave",
      rect: [this.x, y0 + 1, this.x1, y0 + 5],
      amplitude,
      wavelength: 3,
      speed: 1.5,
      dir: [0, 1],
    });
    this.wp(this.cx, this.y - 1, 0.8);
  }

  speed(): void {
    this.setWidth(this.baseW);
    this.flat(2);
    this.flat(3);
    this.g.surface(this.x, this.y - 3, this.x1, this.y - 1, "v");
    this.flat(3);
    this.wp(this.cx, this.y - 1, 0.9);
  }

  acid(): void {
    this.setWidth(Math.max(this.baseW, 5));
    const y0 = this.y;
    this.flat(7);
    const { x, x1 } = this;
    if (this.difficulty === "hard") {
      const half = this.w >> 1;
      this.g.surface(x, y0 + 1, x + half - 1, y0 + 2, "a");
      this.g.surface(x1 - half + 1, y0 + 4, x1, y0 + 5, "a");
      this.wp(x1 - 1, y0 + 1, 0.5);
      this.wp(x1 - 1, y0 + 2, 0.5);
      this.wp(x + 1, y0 + 4, 0.5);
      this.wp(x + 1, y0 + 5, 0.5);
    } else {
      this.g.surface(x, y0 + 1, x, y0 + 5, "a");
      this.g.surface(x1, y0 + 1, x1, y0 + 5, "a");
      this.wp(this.cx, y0 + 5, 0.7);
    }
    this.wp(this.cx, this.y - 1, 0.7);
  }

  hammer(): void {
    this.setWidth(Math.max(this.baseW, 4));
    const y0 = this.y;
    this.flat(6);
    const left = this.rng.next() < 0.5;
    const hc = left ? this.x : this.x1;
    const sc = left ? this.x1 : this.x;
    const period = (20 + this.rng.nextInt(9)) / 10;
    this.entities.push({
      type: "hammer",
      at: [hc, y0 + 2],
      period,
      phase: this.rng.nextInt(20) / 10,
    });
    if (this.difficulty === "hard")
      this.entities.push({
        type: "hammer",
        at: [hc, y0 + 4],
        period,
        phase: this.rng.nextInt(20) / 10,
      });
    this.wp(sc, y0 + 1, 0.7);
    this.wp(sc, y0 + 5, 0.7);
  }

  steelie(): void {
    this.setWidth(5);
    const y0 = this.y;
    this.flat(7);
    const speed = (20 + this.rng.nextInt(10)) / 10;
    if (this.difficulty === "hard") {
      this.entities.push({
        type: "steelie",
        at: [this.x, y0 + 3],
        mode: "patrol",
        path: [
          [this.x, y0 + 3],
          [this.x1, y0 + 3],
        ],
        speed,
      });
      this.wp(this.cx, this.y - 1, 0.9);
    } else {
      const left = this.rng.next() < 0.5;
      const pc = left ? this.x : this.x1;
      const sc = left ? this.x1 : this.x;
      this.entities.push({
        type: "steelie",
        at: [pc, y0 + 1],
        mode: "patrol",
        path: [
          [pc, y0 + 1],
          [pc, y0 + 5],
        ],
        speed,
      });
      this.wp(sc, y0 + 1, 0.7);
      this.wp(sc, y0 + 5, 0.7);
      this.wp(this.cx, this.y - 1, 0.7);
    }
  }

  /** A two-cell alcove beside a straight; returns its outer and inner cells and the far lane column. */
  private alcove(): { outer: Cell; inner: Cell; far: number; y0: number } {
    this.setWidth(this.baseW);
    const y0 = this.y;
    this.flat(6);
    const leftRoom = this.x - 1;
    const rightRoom = GRID_W - 2 - this.x1;
    const left = leftRoom >= 2 && (rightRoom < 2 || this.rng.next() < 0.5);
    const ax0 = left ? this.x - 2 : this.x1 + 1;
    this.g.fill(ax0, y0 + 2, ax0 + 1, y0 + 4, this.h);
    return {
      outer: [left ? this.x - 2 : this.x1 + 2, y0 + 3],
      inner: [left ? this.x - 1 : this.x1 + 1, y0 + 3],
      far: left ? this.x1 : this.x,
      y0,
    };
  }

  hoover(): void {
    const a = this.alcove();
    const reach = Math.abs(a.outer[0] - a.far) + 1;
    this.entities.push({
      type: "hoover",
      at: a.outer,
      pullRadius: Math.min(6, reach),
      pullStrength: this.difficulty === "hard" ? 9 : 6,
      killRadius: 0.4,
      onTime: 1.5,
      offTime: 1.5,
      phase: this.rng.nextInt(30) / 10,
    });
    this.wp(a.far, a.y0 + 1, 0.9);
    this.wp(a.far, a.y0 + 5, 0.9);
  }

  muncher(): void {
    const a = this.alcove();
    const gapCells = Math.abs(a.inner[0] - a.far);
    this.entities.push({
      type: "muncher",
      at: a.inner,
      triggerRadius: Math.min(3, gapCells + 0.3),
      digestTime: 1.5,
    });
    this.wp(a.far, a.y0 + 1, 0.9);
    this.wp(a.far, a.y0 + 5, 0.9);
  }

  catapult(): void {
    this.setWidth(Math.max(this.baseW, 3));
    const y0 = this.y;
    this.flat(3);
    const pad: Cell = [this.cx, y0 + 1];
    const vy = 5 + this.rng.nextInt(3);
    const vz = 6;
    const drop = intIn(this.rng, 2, 4);
    const fall = drop / 2;
    const t = (vz + Math.sqrt(vz * vz + 2 * GRAVITY * fall)) / GRAVITY;
    const landY = Math.floor(pad[1] + 0.5 + vy * t);
    const first = Math.max(this.y + 1, landY - 2);
    this.entities.push({ type: "catapult", at: pad, launch: [0, vy, vz] });
    this.wp(pad[0], pad[1], 0.5, 0.2);
    this.y = first;
    this.h -= drop;
    this.flat(landY + 4 - first);
    this.wp(this.cx, this.y - 1, 0.7);
  }

  funnel(): void {
    this.setWidth(5);
    const y0 = this.y;
    this.flat(5);
    const centre: Cell = [this.cx, y0 + 2];
    this.y += 2;
    this.h -= intIn(this.rng, 2, 3);
    const exit: Cell = [this.cx, this.y + 1];
    this.flat(4);
    this.entities.push({
      type: "funnel",
      at: centre,
      radius: 2,
      depth: 1,
      exit,
      exitVelocity: [0, 2, 0],
      travelTime: 0.8,
    });
    this.wp(centre[0], centre[1], 0.6, 0.2);
    this.wp(this.cx, this.y - 1, 0.7);
  }

  pipe(): void {
    this.setWidth(this.baseW);
    const y0 = this.y;
    this.flat(3);
    const entry: Cell = [this.cx, y0 + 2];
    this.y += 2;
    this.h -= intIn(this.rng, 2, 3);
    const exit: Cell = [this.cx, this.y];
    this.flat(4);
    this.entities.push({
      type: "pipe",
      entry,
      exit,
      exitVelocity: [0, 3, 0],
      travelTime: (8 + this.rng.nextInt(5)) / 10,
    });
    this.wp(entry[0], entry[1], 0.4, 0.2);
    this.wp(this.cx, this.y - 1, 0.8);
  }

  run(kind: SegmentKind): void {
    this[kind]();
  }
}

/** Choose the segment sequence: weighted picks, no repeats, hazard cap, height and row budgets. */
function plan(rng: Rng, tier: Tier): SegmentKind[] {
  const count = intIn(rng, tier.segments[0], tier.segments[1]);
  const kinds = Object.entries(tier.weights) as Array<[SegmentKind, number]>;
  const out: SegmentKind[] = [];
  let height = tier.startHeight - 1;
  let rows = 1 + 4 + 5 + 1;
  let hazards = 0;
  for (let i = 0; i < count; i++) {
    const allowed = kinds.filter(
      ([k]) =>
        k !== out[out.length - 1] &&
        MAX_DROP[k] <= height &&
        rows + MAX_ROWS_PER[k] <= MAX_ROWS &&
        (!HAZARDS.has(k) || hazards < tier.maxHazards),
    );
    if (allowed.length === 0) break;
    const k = weighted(rng, allowed);
    out.push(k);
    height -= MAX_DROP[k];
    rows += MAX_ROWS_PER[k];
    if (HAZARDS.has(k)) hazards++;
  }
  return out;
}

/** One layout attempt for `layoutSeed`; the id and name always come from the requested seed. */
export function generateSource(
  opts: GenerateOptions,
  layoutSeed: number = opts.seed,
): GeneratedSource {
  const tier = TIERS[opts.difficulty];
  const rng = new Rng(layoutSeed);
  const nameRng = new Rng(opts.seed);
  const theme: ThemeId = opts.theme ?? pick(nameRng, THEME_IDS);
  const music: MusicId = MUSIC_IDS[THEME_IDS.indexOf(theme)] ?? "m1-first-steps";
  const name = `${pick(nameRng, ADJECTIVES)} ${pick(nameRng, NOUNS)}`;

  const segments = plan(rng, tier);
  const baseW = intIn(rng, tier.widths[0], tier.widths[1]);
  const L = new Layout(rng, opts.difficulty, baseW, tier.startHeight);
  L.start();
  const p1: Cell = [L.cx - 1, 2];
  const p2: Cell = [L.cx, 2];
  segments.forEach((k, i) => {
    L.run(k);
    if (i % 3 === 2 && i < segments.length - 1 && L.rest)
      L.checkpoints.push({ at: L.rest, radius: 1 });
  });
  const goal = L.goal();
  L.g.autoRails();
  const g = L.g.cropRows(L.y + 1);

  const source: LevelSource = {
    format: "mm-level-source/1",
    id: generatedId(opts.difficulty, opts.seed),
    name,
    author: "Generator",
    theme,
    music,
    grid: { width: g.width, height: g.height },
    layers: g.toLayers(),
    start: { p1, p2 },
    goal: { at: goal, radius: 0.8 },
    ...(L.checkpoints.length > 0 ? { checkpoints: L.checkpoints } : {}),
    ...(L.entities.length > 0 ? { entities: L.entities } : {}),
    timing: { ...DRAFT_TIMING },
    scoring: { progress: 500, goal: tier.goalScore, perSecond: 50, firstHome: 500 },
    solution: { kind: "waypoints", points: L.points },
  };
  return { source, segments, layoutSeed };
}
