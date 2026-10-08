// Difficulty tiers, segment metadata and theme flavour for the course generator (DECISIONS L15–L30).
import type { ThemeId } from "../types";

export const DIFFICULTIES = ["easy", "medium", "hard", "expert", "insane", "nightmare"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

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
  | "gauntlet"
  | "steelie"
  | "hoover"
  | "muncher"
  | "catapult"
  | "funnel"
  | "pipe"
  | "ferry"
  | "funnelMaze"
  | "waveCrossing"
  | "fork"
  | "shortcut"
  | "spiral"
  // v3 precision pieces (L26)
  | "rope"
  | "diagonal"
  | "camber"
  | "sbend"
  | "runup"
  | "kicker"
  | "chicane"
  | "hairpin"
  | "chain"
  | "waveRope"
  | "hooverRope"
  | "steelieBridge"
  | "hammerRope"
  | "funnelRope"
  | "pipeTarget";

export interface KindInfo {
  /** Worst-case height (half-units) the segment consumes. */
  drop: number;
  /** Counts toward the tier's hazard cap. */
  hazard: boolean;
  /** Needs precise steering or timing; chains of these are limited (L19). */
  precision: boolean;
  /** Leaves the marble airborne or teleported; the next segment may not be a hazard (L19). */
  airborne: boolean;
  /** Allowed while heading west or north, where the route must stay level (L17). */
  level: boolean;
  /** Worst-case entities added. */
  entities: number;
}

const k = (
  drop: number,
  flags: Partial<Omit<KindInfo, "drop" | "entities">> = {},
  entities = 0,
): KindInfo => ({
  drop,
  hazard: flags.hazard ?? false,
  precision: flags.precision ?? false,
  airborne: flags.airborne ?? false,
  level: flags.level ?? false,
  entities,
});

export const KIND_INFO: Record<SegmentKind, KindInfo> = {
  slope: k(6),
  steep: k(8),
  ledge: k(4, { airborne: true }),
  jump: k(7, { precision: true, airborne: true }),
  jog: k(0, { level: true }),
  narrows: k(4, { level: true }),
  ice: k(2, { level: true }),
  wave: k(0, { level: true }, 1),
  speed: k(0, { level: true }),
  acid: k(0, { hazard: true, level: true }),
  hammer: k(0, { hazard: true, level: true }, 2),
  gauntlet: k(0, { hazard: true, precision: true, level: true }, 9),
  steelie: k(0, { hazard: true, level: true }, 1),
  hoover: k(0, { hazard: true, level: true }, 1),
  muncher: k(0, { hazard: true, level: true }, 1),
  catapult: k(4, { precision: true, airborne: true }, 1),
  funnel: k(3, { airborne: true }, 1),
  pipe: k(3, { airborne: true }, 1),
  ferry: k(0, { precision: true, level: true }, 1),
  funnelMaze: k(3, { airborne: true }, 2),
  waveCrossing: k(0, { level: true }, 1),
  fork: k(4, { precision: true, level: true }, 3),
  shortcut: k(0, { precision: true, level: true }, 1),
  spiral: k(6),
  rope: k(2, { precision: true, level: true }),
  diagonal: k(0, { precision: true, level: true }),
  camber: k(2, { precision: true, level: true }),
  sbend: k(8, { precision: true, level: true }),
  runup: k(4, { precision: true, airborne: true }),
  kicker: k(0, { precision: true, level: true }),
  chicane: k(0, { precision: true, level: true }),
  hairpin: k(0, { precision: true, level: true }),
  chain: k(0, { precision: true, level: true }, 2),
  waveRope: k(0, { precision: true, level: true }, 1),
  hooverRope: k(0, { hazard: true, precision: true, level: true }, 1),
  steelieBridge: k(0, { hazard: true, precision: true, level: true }, 2),
  hammerRope: k(0, { hazard: true, precision: true, level: true }, 4),
  funnelRope: k(3, { precision: true, airborne: true }, 1),
  pipeTarget: k(3, { precision: true, airborne: true }, 1),
};

/** Kinds that read as a named set-piece in stats and the variety metric. */
export const SET_PIECES: ReadonlySet<SegmentKind> = new Set([
  "funnelMaze",
  "waveCrossing",
  "ferry",
  "gauntlet",
  "shortcut",
  "spiral",
  "catapult",
  "chain",
  "hammerRope",
  "steelieBridge",
  "hooverRope",
  "funnelRope",
  "pipeTarget",
  "runup",
]);

/** Corner risks; `both` is the share of corners that are rail-less and iced at once (L26). */
export type CornerRisk = { railless: number; ice: number; both?: number };

export interface Tier {
  segments: [min: number, max: number];
  widths: [min: number, max: number];
  startHeight: number;
  maxHazards: number;
  /** Consecutive precision segments allowed before a breather (L19). */
  maxChain: number;
  /** Probability of each fork slot count: forks[i] = chance of at least i+1 forks. */
  forks: readonly number[];
  /** Share of forks that become a pipe shortcut instead of a split-and-rejoin. */
  shortcutShare: number;
  corner: CornerRisk;
  /** Probability that narrows and wave crossings lose their side rails. */
  railless: number;
  jumpGap: [min: number, max: number];
  ledgeDrop: [min: number, max: number];
  waveAmp: number;
  hooverPull: number;
  gauntletGates: number;
  ferry: { gap: [min: number, max: number]; speed: number; pause: number };
  spiralChance: number;
  goalScore: number;
  weights: Partial<Record<SegmentKind, number>>;
  // ---- v3 (L26–L30) ----
  /** Width of ropes, chicanes, bridges and kicker lanes. */
  narrowW: number;
  rope: [min: number, max: number];
  /** Chance a rope is iced. */
  iceRope: number;
  camberW: number;
  /** Diagonal staircase slopes (cells across per row) to pick from. */
  diagSlopes: readonly number[];
  /** Landing width after run-up gaps and catapults. */
  landW: number;
  /** Run-up gap drop in half-units (smaller needs more speed). */
  runupDrop: number;
  /** Sideways speed-strip rows in a kicker. */
  kickers: number;
  waveRopeAmp: number;
  /** Platform-chain platform footprint across the heading. */
  chainSize: number;
  hooverRopePull: number;
  /** Corner square width; null keeps the v2 lane width (at least 3). */
  cornerW: number | null;
  /** Chance a plain lane segment loses its side rails. */
  bareLanes: number;
  /** Chance the whole course has inverted slope gravity (physics.slopeGravityScale −1). */
  inverted: number;
  /** A checkpoint after every n-th segment. */
  checkpointEvery: number;
  /** "search" solves with the beam search first (L25); "autopilot" keeps the v2 waypoint solve. */
  solver: "autopilot" | "search";
  beam: number;
  /** Simulated-tick budget for one search. */
  budget: number;
  /** Fairness floor: the worst 2 s window must succeed this often (%) under small noise (L28). */
  minRobust: number;
  /** Tier floor: courses less fragile than this (%) are rejected (L29). */
  minFragility: number;
  /** par = ceil(solution × factor + slack); limit = min(99, max(par + 5, ceil(par × limit))). */
  /**
   * `steer` (L29) adds a reaction allowance in seconds per stick direction change: a modelled
   * slowed human run, so extreme-tier par is not the superhuman solver line.
   */
  par: { factor: number; slack: number; limit: number; steer?: number };
}

/** Neutral v3 settings for the tiers that keep the v2 behaviour. */
const V2_BASE = {
  narrowW: 2,
  rope: [5, 6] as [number, number],
  iceRope: 0,
  camberW: 2,
  diagSlopes: [1],
  landW: 3,
  runupDrop: 4,
  kickers: 1,
  waveRopeAmp: 0.15,
  chainSize: 2,
  hooverRopePull: 10,
  cornerW: null,
  bareLanes: 0,
  inverted: 0,
  checkpointEvery: 3,
  solver: "autopilot" as const,
  beam: 8,
  budget: 600_000,
  minRobust: 0,
  minFragility: 0,
};

export const TIERS: Record<Difficulty, Tier> = {
  easy: {
    ...V2_BASE,
    par: { factor: 1.2, slack: 3, limit: 1.6 },
    segments: [6, 7],
    widths: [4, 5],
    startHeight: 30,
    maxHazards: 2,
    maxChain: 1,
    forks: [0.35],
    shortcutShare: 0,
    corner: { railless: 0, ice: 0 },
    railless: 0,
    jumpGap: [1, 1],
    ledgeDrop: [2, 3],
    waveAmp: 0.22,
    hooverPull: 6,
    gauntletGates: 2,
    ferry: { gap: [4, 4], speed: 2, pause: 1 },
    spiralChance: 0.2,
    goalScore: 1000,
    weights: {
      slope: 2,
      steep: 1.5,
      ledge: 2,
      jump: 2,
      jog: 1,
      narrows: 1,
      speed: 1,
      ice: 1,
      wave: 1,
      acid: 1,
      hammer: 1,
      pipe: 1,
      funnel: 0.5,
      ferry: 0.6,
    },
  },
  medium: {
    ...V2_BASE,
    par: { factor: 1.12, slack: 2, limit: 1.45 },
    segments: [8, 9],
    widths: [3, 4],
    startHeight: 33,
    maxHazards: 4,
    maxChain: 1,
    forks: [0.8],
    shortcutShare: 0.3,
    corner: { railless: 0.1, ice: 0.1 },
    railless: 0.3,
    jumpGap: [1, 2],
    ledgeDrop: [2, 4],
    waveAmp: 0.28,
    hooverPull: 7,
    gauntletGates: 2,
    ferry: { gap: [4, 5], speed: 2, pause: 1 },
    spiralChance: 0.2,
    goalScore: 1500,
    weights: {
      slope: 1,
      steep: 2,
      ledge: 1,
      jump: 3,
      jog: 1,
      narrows: 2,
      ice: 1,
      wave: 1,
      speed: 1,
      acid: 2,
      hammer: 2,
      gauntlet: 0.6,
      steelie: 1,
      hoover: 1,
      catapult: 1,
      funnel: 1,
      pipe: 1,
      ferry: 1,
      funnelMaze: 0.6,
      waveCrossing: 0.6,
    },
  },
  hard: {
    segments: [10, 11],
    widths: [2, 3],
    startHeight: 35,
    maxHazards: 7,
    maxChain: 2,
    forks: [1, 0.3],
    shortcutShare: 0.3,
    corner: { railless: 0.45, ice: 0.25, both: 0 },
    railless: 0.8,
    jumpGap: [2, 2],
    ledgeDrop: [3, 4],
    waveAmp: 0.35,
    hooverPull: 9,
    gauntletGates: 2,
    ferry: { gap: [5, 6], speed: 2.5, pause: 0.8 },
    spiralChance: 0.2,
    goalScore: 2000,
    weights: {
      steep: 1.5,
      ledge: 0.7,
      jump: 1.5,
      jog: 0.5,
      narrows: 1,
      ice: 0.7,
      acid: 1.5,
      hammer: 1,
      gauntlet: 1,
      steelie: 1.5,
      hoover: 1,
      muncher: 1,
      catapult: 0.8,
      funnel: 0.5,
      ferry: 1,
      funnelMaze: 0.6,
      waveCrossing: 0.6,
      rope: 2,
      camber: 2,
      kicker: 1.5,
      chicane: 1.5,
      diagonal: 1,
      runup: 1.2,
      waveRope: 0.8,
      steelieBridge: 0.8,
    },
    narrowW: 2,
    rope: [5, 7],
    iceRope: 0,
    camberW: 2,
    diagSlopes: [1],
    landW: 3,
    runupDrop: 4,
    kickers: 1,
    waveRopeAmp: 0.18,
    chainSize: 2,
    hooverRopePull: 12,
    cornerW: null,
    bareLanes: 0,
    inverted: 0,
    checkpointEvery: 3,
    solver: "search",
    beam: 8,
    budget: 900_000,
    minRobust: 37.5,
    minFragility: 0,
    par: { factor: 1.1, slack: 1.5, limit: 1.45, steer: 0.04 },
  },
  expert: {
    segments: [11, 12],
    widths: [2, 2],
    startHeight: 35,
    maxHazards: 9,
    maxChain: 3,
    forks: [1, 0.4],
    shortcutShare: 0.3,
    corner: { railless: 0.6, ice: 0.3, both: 0.1 },
    railless: 1,
    jumpGap: [2, 2],
    ledgeDrop: [3, 4],
    waveAmp: 0.4,
    hooverPull: 10,
    gauntletGates: 3,
    ferry: { gap: [5, 7], speed: 3, pause: 0.8 },
    spiralChance: 0.2,
    goalScore: 2500,
    weights: {
      steep: 1.2,
      ledge: 0.5,
      jump: 1.2,
      jog: 0.4,
      narrows: 0.8,
      ice: 0.5,
      acid: 1.2,
      hammer: 0.8,
      gauntlet: 1,
      steelie: 1,
      hoover: 0.8,
      muncher: 0.8,
      catapult: 1,
      ferry: 1,
      funnelMaze: 0.5,
      waveCrossing: 0.6,
      rope: 2.5,
      camber: 2,
      sbend: 1.2,
      kicker: 1.5,
      chicane: 2,
      diagonal: 1.5,
      runup: 1.5,
      hairpin: 1,
      chain: 0.8,
      waveRope: 1,
      hooverRope: 1,
      steelieBridge: 1,
      hammerRope: 0.8,
      funnelRope: 0.6,
      pipeTarget: 0.6,
    },
    narrowW: 1,
    rope: [5, 7],
    iceRope: 0.1,
    camberW: 2,
    diagSlopes: [1],
    landW: 3,
    runupDrop: 3,
    kickers: 1,
    waveRopeAmp: 0.22,
    chainSize: 2,
    hooverRopePull: 14,
    cornerW: 2,
    bareLanes: 0.1,
    inverted: 0.15,
    checkpointEvery: 3,
    solver: "search",
    beam: 10,
    budget: 1_200_000,
    minRobust: 25,
    minFragility: 0,
    par: { factor: 1.1, slack: 1.5, limit: 1.5, steer: 0.06 },
  },
  insane: {
    segments: [11, 13],
    widths: [2, 2],
    startHeight: 35,
    maxHazards: 10,
    maxChain: 4,
    forks: [0.6],
    shortcutShare: 0.2,
    corner: { railless: 0.8, ice: 0.4, both: 0.3 },
    railless: 1,
    jumpGap: [2, 2],
    ledgeDrop: [3, 4],
    waveAmp: 0.45,
    hooverPull: 12,
    gauntletGates: 3,
    ferry: { gap: [5, 7], speed: 3, pause: 0.7 },
    spiralChance: 0.1,
    goalScore: 3000,
    weights: {
      steep: 1,
      jump: 0.8,
      acid: 0.6,
      gauntlet: 0.6,
      steelie: 0.5,
      catapult: 1,
      ferry: 0.6,
      waveCrossing: 0.4,
      rope: 2.5,
      camber: 2,
      sbend: 2,
      kicker: 2,
      chicane: 2.5,
      diagonal: 2.5,
      runup: 2,
      hairpin: 1.5,
      chain: 1.2,
      waveRope: 1.5,
      hooverRope: 1.5,
      steelieBridge: 1.5,
      hammerRope: 1.2,
      funnelRope: 1,
      pipeTarget: 1,
    },
    narrowW: 1,
    rope: [6, 9],
    iceRope: 0.3,
    camberW: 1,
    diagSlopes: [1, 1, 0.5],
    landW: 2,
    runupDrop: 3,
    kickers: 2,
    waveRopeAmp: 0.26,
    chainSize: 2,
    hooverRopePull: 16,
    cornerW: 2,
    bareLanes: 0.3,
    inverted: 0.3,
    checkpointEvery: 2,
    solver: "search",
    beam: 12,
    budget: 2_400_000,
    minRobust: 25,
    minFragility: 0,
    par: { factor: 1.1, slack: 2, limit: 1.9, steer: 0.1 },
  },
  nightmare: {
    segments: [12, 13],
    widths: [2, 2],
    startHeight: 35,
    maxHazards: 12,
    maxChain: 6,
    forks: [0.3],
    shortcutShare: 0,
    corner: { railless: 1, ice: 0.5, both: 0.45 },
    railless: 1,
    jumpGap: [2, 2],
    ledgeDrop: [3, 4],
    waveAmp: 0.5,
    hooverPull: 14,
    gauntletGates: 3,
    ferry: { gap: [6, 7], speed: 3.5, pause: 0.6 },
    spiralChance: 0,
    goalScore: 4000,
    weights: {
      steep: 1,
      catapult: 0.8,
      rope: 2.5,
      camber: 2,
      sbend: 2.5,
      kicker: 2,
      chicane: 2.5,
      diagonal: 2.5,
      runup: 2,
      hairpin: 2,
      chain: 1.2,
      waveRope: 1.5,
      hooverRope: 1.5,
      steelieBridge: 1.5,
      hammerRope: 1.2,
      funnelRope: 1,
      pipeTarget: 1,
    },
    narrowW: 1,
    rope: [8, 11],
    iceRope: 0.5,
    camberW: 1,
    diagSlopes: [1, 0.5, 2],
    landW: 2,
    runupDrop: 2,
    kickers: 2,
    waveRopeAmp: 0.3,
    chainSize: 1,
    hooverRopePull: 18,
    cornerW: 2,
    bareLanes: 0.6,
    inverted: 0.5,
    checkpointEvery: 1,
    solver: "search",
    beam: 14,
    budget: 2_400_000,
    minRobust: 12.5,
    minFragility: 0,
    par: { factor: 1.1, slack: 2, limit: 2, steer: 0.12 },
  },
};

/** Theme flavour: weight multipliers and preferred fork risks (L22). */
export const THEME_FLAVOUR: Record<
  ThemeId,
  { weights: Partial<Record<SegmentKind, number>>; risks: readonly ForkRisk[]; spiral: number }
> = {
  practice: {
    weights: { slope: 1.5, ledge: 1.3, jump: 1.2, steelie: 0.6, muncher: 0.5, gauntlet: 0.6 },
    risks: ["ledge", "gap"],
    spiral: 1,
  },
  descent: {
    weights: { steep: 1.6, ledge: 1.5, jump: 1.3, funnel: 1.3, funnelMaze: 1.6 },
    risks: ["gap", "ledge", "catapult"],
    spiral: 2,
  },
  clockwork: {
    weights: { hammer: 1.8, gauntlet: 2, ferry: 1.5, steelie: 1.3 },
    risks: ["hammers", "ledge"],
    spiral: 1,
  },
  skyways: {
    weights: { ferry: 2, catapult: 1.6, jump: 1.4, narrows: 1.3, waveCrossing: 1.2 },
    risks: ["catapult", "gap", "ledge"],
    spiral: 1,
  },
  topsy: {
    weights: { ice: 1.8, wave: 1.6, waveCrossing: 1.6, speed: 1.5, pipe: 1.5, funnel: 1.3 },
    risks: ["acid", "gap"],
    spiral: 1.5,
  },
  lastledge: {
    weights: { narrows: 1.6, acid: 1.5, hoover: 1.5, muncher: 1.4, steelie: 1.3 },
    risks: ["acid", "ledge", "hammers"],
    spiral: 1,
  },
};

/** What the short line of a fork risks (L18). */
export type ForkRisk = "ledge" | "gap" | "acid" | "hammers" | "catapult";
export const FORK_RISKS: readonly ForkRisk[] = ["ledge", "gap", "acid", "hammers", "catapult"];
/** Risks that drop height, so they need a heading toward the camera. */
export const DROPPING_RISKS: ReadonlySet<ForkRisk> = new Set(["gap", "catapult"]);
