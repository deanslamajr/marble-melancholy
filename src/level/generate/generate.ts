// Procedural course generator: seed + difficulty (+ theme) → LevelSource with waypoint routes.
// Pure and deterministic (D06, D07): mulberry32 only, no transcendental Math, no clocks.
// Generator v2 (DECISIONS L15–L24): switchback layouts on the full grid, forks, set-pieces.
import { fnv1a32 } from "../../core/hash";
import { Rng } from "../../core/rng";
import {
  MUSIC_IDS,
  THEME_IDS,
  type Cell,
  type EntitySource,
  type LevelSource,
  type MusicId,
  type ThemeId,
  type Waypoint,
} from "../types";
import { E, S, W, turnDir, type Dir } from "./grid";
import { Layout, SIZE, type CornerStyle } from "./layout";
import {
  DIFFICULTIES,
  DROPPING_RISKS,
  FORK_RISKS,
  KIND_INFO,
  SET_PIECES,
  THEME_FLAVOUR,
  TIERS,
  type Difficulty,
  type ForkRisk,
  type SegmentKind,
  type Tier,
} from "./tiers";

export { DIFFICULTIES, TIERS, type Difficulty, type SegmentKind };

/** Bumped whenever the same seed may produce a different course (L24). */
export const GENERATOR_VERSION = 2;

export interface GenerateOptions {
  seed: number;
  difficulty: Difficulty;
  theme?: ThemeId;
}

export type LayoutShape = "straight" | "L" | "zigzag" | "stairs" | "wander";

export interface CourseStats {
  shape: LayoutShape;
  turns: number;
  forks: number;
  hazards: number;
  distinctKinds: number;
  setPieces: SegmentKind[];
}

export interface GeneratedSource {
  /** The course with the first route as its solution. */
  source: LevelSource;
  segments: SegmentKind[];
  /** The seed this layout was built from (the requested seed or a derived retry seed). */
  layoutSeed: number;
  /** Waypoint routes in the order the pipeline tries them: every risky line, then every safe one. */
  routes: Waypoint[][];
  stats: CourseStats;
  /** Set when the layout was abandoned (the pipeline then tries the next attempt seed). */
  problem: string | null;
}

/** Placeholder timing; `generateLevel` replaces it with values derived from the solution time. */
export const DRAFT_TIMING = { timeLimit: 99, par: 98, timeBonus: 5 } as const;

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
  return `gen-v${GENERATOR_VERSION}-${difficulty}-${seed >>> 0}`;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.nextInt(items.length)]!;
}

function intIn(rng: Rng, lo: number, hi: number): number {
  return lo + rng.nextInt(hi - lo + 1);
}

/** Weighted draw without replacement: up to `n` distinct items, most likely first. */
function drawOrder<T>(rng: Rng, weighted: ReadonlyArray<[T, number]>, n: number): T[] {
  const pool = weighted.filter(([, w]) => w > 0).slice();
  const out: T[] = [];
  while (pool.length > 0 && out.length < n) {
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = rng.next() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i]![1];
      if (r < 0) break;
    }
    out.push(pool[i]![0]);
    pool.splice(i, 1);
  }
  return out;
}

/** Classify the realised route by its east/west runs. */
export function classifyShape(laterals: readonly Dir[]): LayoutShape {
  if (laterals.length === 0) return "straight";
  if (laterals.length === 1) return "L";
  let alternating = true;
  let same = true;
  for (let i = 1; i < laterals.length; i++) {
    if (laterals[i] === laterals[i - 1]) alternating = false;
    else same = false;
  }
  return alternating ? "zigzag" : same ? "stairs" : "wander";
}

function shiftCell(c: Cell, dx: number, dy: number): Cell {
  return [c[0] - dx, c[1] - dy];
}

function shiftEntity(e: EntitySource, dx: number, dy: number): EntitySource {
  const s = (c: Cell) => shiftCell(c, dx, dy);
  switch (e.type) {
    case "wave":
      return { ...e, rect: [e.rect[0] - dx, e.rect[1] - dy, e.rect[2] - dx, e.rect[3] - dy] };
    case "pipe":
      return { ...e, entry: s(e.entry), exit: s(e.exit) };
    case "funnel":
      return { ...e, at: s(e.at), exit: s(e.exit) };
    case "platform":
      return { ...e, at: s(e.at), path: e.path.map(s) };
    case "steelie":
    case "muncher":
      return e.path ? { ...e, at: s(e.at), path: e.path.map(s) } : { ...e, at: s(e.at) };
    default:
      return { ...e, at: s(e.at) };
  }
}

interface Plan {
  L: Layout;
  start: [Cell, Cell];
  goal: Cell | null;
  segments: SegmentKind[];
  laterals: Dir[];
  hazards: number;
}

/** Lay out one course: legs of segments joined by corners, forks in planned slots, a finale. */
function planCourse(rng: Rng, difficulty: Difficulty, tier: Tier, theme: ThemeId): Plan {
  const flavour = THEME_FLAVOUR[theme];
  const baseW = intIn(rng, tier.widths[0], tier.widths[1]);
  const shapeRoll = rng.next();
  const planned: LayoutShape = shapeRoll < 0.5 ? "zigzag" : shapeRoll < 0.75 ? "stairs" : "wander";
  const firstLateral: Dir = rng.next() < 0.5 ? E : W;
  // Heading south, the lane spans x ∈ [startX - w + 1, startX].
  const startX =
    planned === "stairs"
      ? firstLateral === E
        ? 10 + rng.nextInt(10)
        : SIZE - 12 - rng.nextInt(10)
      : 50 + rng.nextInt(28);
  const L = new Layout(rng, difficulty, tier, baseW, tier.startHeight, startX);
  let start: [Cell, Cell] = [
    [0, 0],
    [0, 0],
  ];
  L.attempt(() => {
    start = L.start();
  });

  const count = intIn(rng, tier.segments[0], tier.segments[1]);
  const forkSlots = new Set<number>();
  let forkN = 0;
  for (const p of tier.forks) {
    if (rng.next() < p) forkN++;
    else break;
  }
  for (let tries = 0; forkSlots.size < forkN && tries < 20; tries++) {
    const i = 2 + rng.nextInt(Math.max(1, count - 3));
    if ([...forkSlots].every((j) => Math.abs(j - i) >= 3)) forkSlots.add(i);
  }

  const segments: SegmentKind[] = [];
  const uses = new Map<SegmentKind, number>();
  const cap = count >= 11 ? 3 : 2;
  const laterals: Dir[] = [];
  let hazards = 0;
  let chain = 0;
  let lastAirborne = false;
  let legLeft = 1 + rng.nextInt(2);
  let closeAt = -1;
  let stuck = 0;
  let extend = 0;

  const side = (): 1 | -1 => (L.d === E ? 1 : L.d === W ? -1 : rng.next() < 0.5 ? 1 : -1);

  const record = (kind: SegmentKind, precision: boolean, hazard: boolean, airborne: boolean) => {
    segments.push(kind);
    uses.set(kind, (uses.get(kind) ?? 0) + 1);
    if (hazard) hazards++;
    chain = precision ? chain + 1 : 0;
    lastAirborne = airborne;
  };

  const tryFork = (): boolean => {
    if (chain >= tier.maxChain || L.entities.length > 56) return false;
    if (rng.next() < tier.shortcutShare) {
      const s = side();
      if (L.attempt(() => L.shortcut(s)) || (L.d === S && L.attempt(() => L.shortcut(-s as 1 | -1)))) {
        record("shortcut", true, false, false);
        closeAt = segments.length + 2 + rng.nextInt(2);
        return true;
      }
    }
    const risks = FORK_RISKS.filter(
      (r) =>
        (L.canDrop || !DROPPING_RISKS.has(r)) &&
        (difficulty !== "easy" || r === "ledge" || r === "gap") &&
        !((r === "acid" || r === "hammers") && (hazards >= tier.maxHazards || lastAirborne)),
    );
    const order = drawOrder(
      rng,
      risks.map((r): [ForkRisk, number] => [r, flavour.risks.includes(r) ? 3 : 1]),
      3,
    );
    for (const risk of order) {
      const s = side();
      if (L.attempt(() => L.fork(risk, s)) || (L.d === S && L.attempt(() => L.fork(risk, -s as 1 | -1)))) {
        record(
          "fork",
          true,
          risk === "acid" || risk === "hammers",
          risk === "gap" || risk === "catapult",
        );
        return true;
      }
    }
    return false;
  };

  const tryRegular = (): boolean => {
    const last = segments[segments.length - 1];
    const recent = segments.slice(-3);
    const options = (Object.entries(tier.weights) as Array<[SegmentKind, number]>)
      .filter(([k]) => {
        const info = KIND_INFO[k];
        return (
          k !== last &&
          (uses.get(k) ?? 0) < cap &&
          (L.canDrop || info.level) &&
          info.drop <= L.h - 1 &&
          (!info.hazard || hazards < tier.maxHazards) &&
          (!info.precision || chain < tier.maxChain) &&
          !(lastAirborne && info.hazard) &&
          L.entities.length + info.entities <= 60
        );
      })
      .map(([k, w]): [SegmentKind, number] => [
        k,
        w * (flavour.weights[k] ?? 1) * (recent.includes(k) ? 0.35 : 1),
      ]);
    const allowBare = chain < tier.maxChain;
    for (const k of drawOrder(rng, options, 6)) {
      const info = KIND_INFO[k];
      let precision = info.precision;
      const ok = L.attempt(() => {
        switch (k) {
          case "narrows":
            precision = L.narrows(allowBare) || precision;
            break;
          case "waveCrossing":
            precision = L.waveCrossing(allowBare) || precision;
            break;
          default:
            L[k as Exclude<SegmentKind, "narrows" | "waveCrossing" | "fork" | "shortcut" | "spiral">]();
        }
      });
      if (ok) {
        record(k, precision, info.hazard, info.airborne);
        return true;
      }
    }
    return false;
  };

  const corner = (): CornerStyle => {
    const prev = segments[segments.length - 1];
    const fast = prev === "speed" || prev === "steep" || prev === "slope" || prev === "jump";
    const iceP = tier.corner.ice * (theme === "topsy" ? 1.5 : 1);
    const ice = !fast && rng.next() < iceP;
    const railless = !fast && !ice && chain < tier.maxChain && rng.next() < tier.corner.railless;
    return { ice, railless };
  };

  while (segments.length < count && stuck < 6) {
    if (legLeft <= 0) {
      const lateralLeg = L.d !== S;
      const choices: Dir[] = [];
      if (lateralLeg) choices.push(S);
      else {
        const prev = laterals[laterals.length - 1];
        const want: Dir =
          prev === undefined
            ? firstLateral
            : planned === "zigzag"
              ? turnDir(prev, 2)
              : planned === "stairs"
                ? prev
                : rng.next() < 0.5
                  ? E
                  : W;
        choices.push(want, turnDir(want, 2));
      }
      // Look ahead before committing: a run that would soon hit earlier ground (a fork's detour,
      // the tier above) is extended by one more segment instead (at most twice per corner).
      const clear = choices.filter((nd) => {
        L.setWidth(Math.max(baseW, 3));
        return L.clearAhead(nd === S ? 10 : 16, nd, 2);
      });
      if (clear.length === 0 && extend < 2) {
        extend++;
        legLeft = 1;
        continue;
      }
      extend = 0;
      const style = corner();
      let turned = false;
      for (const nd of [...clear, ...choices.filter((c) => !clear.includes(c))]) {
        if (
          L.attempt(() => {
            L.setWidth(Math.max(baseW, 3));
            L.turn(nd, style);
          })
        ) {
          turned = true;
          if (nd !== S) laterals.push(nd);
          break;
        }
      }
      if (!turned) {
        stuck++;
        legLeft = 1;
        continue;
      }
      if (style.railless) chain++;
      legLeft = L.d === S ? (rng.next() < 0.3 ? 2 : 1) : 2 + rng.nextInt(3);
      continue;
    }
    const i = segments.length;
    // Turn before running into the grid edge or earlier ground; the last segment also needs room
    // for the goal pad after it.
    const room = (L.d === S ? 10 : 14) + (i === count - 1 ? 8 : 0);
    if (i > 0 && extend === 0 && !L.clearAhead(room)) {
      legLeft = 0;
      extend = 2;
      continue;
    }
    let placed = false;
    if (forkSlots.has(i) && !L.pending) {
      placed = tryFork();
      if (!placed && i + 1 < count - 1) forkSlots.add(i + 1);
    }
    if (!placed) placed = tryRegular();
    if (!placed) {
      stuck++;
      legLeft = 0;
      continue;
    }
    stuck = 0;
    legLeft--;
    if (i % 3 === 2 && L.rest && L.checkpoints.length < 12)
      L.checkpoints.push({ at: L.rest, radius: 1 });
    if (L.pending && segments[segments.length - 1] !== "shortcut" && segments.length >= closeAt) {
      L.closeShortcut();
      lastAirborne = true;
    }
  }
  if (L.pending) L.closeShortcut();

  // `attempt` undoes the geometry of a failed build, so only keep a goal whose build succeeded.
  let goal: Cell | null = null;
  let built: Cell | null = null;
  if (rng.next() < tier.spiralChance * flavour.spiral) {
    if (L.attempt(() => (built = L.spiral()))) {
      goal = built;
      segments.push("spiral");
    }
  }
  for (const w of [Math.max(baseW, 5), Math.max(baseW, 3)]) {
    if (goal) break;
    if (L.attempt(() => (built = L.goal(w)))) goal = built;
  }
  // Boxed in: one last corner toward open ground, then the goal.
  const exits: Dir[] = L.d === S ? [E, W] : [S];
  for (const nd of exits) {
    if (goal) break;
    if (
      L.attempt(() => {
        L.setWidth(Math.max(baseW, 3));
        L.turn(nd, { railless: false, ice: false });
        built = L.goal(Math.max(baseW, 3));
      })
    )
      goal = built;
  }
  return { L, start, goal, segments, laterals, hazards };
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

  const plan = planCourse(rng, opts.difficulty, tier, theme);
  const { L, segments } = plan;
  let problem: string | null = null;
  if (!plan.goal) problem = `no room for the goal (${L.lastFail})`;
  else if (segments.length < tier.segments[0] - 1) problem = `only ${segments.length} segments fit`;

  L.g.autoRails();
  const b = L.g.bounds() ?? [1, 1, 4, 4];
  const dx = b[0] - 1;
  const dy = b[1] - 1;
  const g = L.g.crop(dx, dy, b[2] - b[0] + 3, b[3] - b[1] + 3);
  const sh = (c: Cell) => shiftCell(c, dx, dy);
  const route = (pts: Waypoint[]) => pts.map((p) => ({ ...p, at: sh(p.at) }));
  const risky = route(L.risky);
  const safe = route(L.safe);
  const routes = JSON.stringify(risky) === JSON.stringify(safe) ? [risky] : [risky, safe];
  const goal = sh(plan.goal ?? [1, 1]);
  const entities = L.entities.map((e) => shiftEntity(e, dx, dy));
  const checkpoints = L.checkpoints.map((c) => ({ ...c, at: sh(c.at) }));

  const source: LevelSource = {
    format: "mm-level-source/1",
    id: generatedId(opts.difficulty, opts.seed),
    name,
    author: `Generator v${GENERATOR_VERSION}`,
    theme,
    music,
    grid: { width: g.width, height: g.height },
    layers: g.toLayers(),
    start: { p1: sh(plan.start[0]), p2: sh(plan.start[1]) },
    goal: { at: goal, radius: 0.8 },
    ...(checkpoints.length > 0 ? { checkpoints } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    timing: { ...DRAFT_TIMING },
    scoring: { progress: 500, goal: tier.goalScore, perSecond: 50, firstHome: 500 },
    solution: { kind: "waypoints", points: risky },
  };
  const stats: CourseStats = {
    shape: classifyShape(plan.laterals),
    turns: L.turns,
    forks: L.forks,
    hazards: plan.hazards,
    distinctKinds: new Set(segments).size,
    setPieces: segments.filter((k) => SET_PIECES.has(k)),
  };
  return { source, segments, layoutSeed, routes, stats, problem };
}
