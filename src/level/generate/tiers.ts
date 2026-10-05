// Difficulty tiers, segment metadata and theme flavour for the course generator (DECISIONS L15–L24).
import type { ThemeId } from "../types";

export const DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;
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
  | "spiral";

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
]);

export type CornerRisk = { railless: number; ice: number };

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
}

export const TIERS: Record<Difficulty, Tier> = {
  easy: {
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
    widths: [3, 3],
    startHeight: 35,
    maxHazards: 7,
    maxChain: 2,
    forks: [1, 0.4],
    shortcutShare: 0.35,
    corner: { railless: 0.35, ice: 0.2 },
    railless: 0.7,
    jumpGap: [2, 2],
    ledgeDrop: [3, 4],
    waveAmp: 0.35,
    hooverPull: 9,
    gauntletGates: 2,
    ferry: { gap: [5, 6], speed: 2.5, pause: 0.8 },
    spiralChance: 0.25,
    goalScore: 2000,
    weights: {
      slope: 0.5,
      steep: 2,
      ledge: 1,
      jump: 3,
      jog: 1,
      narrows: 2,
      ice: 1,
      wave: 1,
      acid: 2,
      hammer: 1.5,
      gauntlet: 1.5,
      steelie: 2,
      hoover: 1,
      muncher: 1,
      catapult: 1,
      funnel: 1,
      ferry: 1.5,
      funnelMaze: 1,
      waveCrossing: 1,
    },
  },
  expert: {
    segments: [12, 13],
    widths: [2, 3],
    startHeight: 35,
    maxHazards: 10,
    maxChain: 2,
    forks: [1, 0.6],
    shortcutShare: 0.4,
    corner: { railless: 0.5, ice: 0.3 },
    railless: 1,
    jumpGap: [2, 2],
    ledgeDrop: [3, 4],
    waveAmp: 0.4,
    hooverPull: 10,
    gauntletGates: 3,
    ferry: { gap: [5, 7], speed: 3, pause: 0.8 },
    spiralChance: 0.25,
    goalScore: 2500,
    weights: {
      steep: 2,
      ledge: 1,
      jump: 3,
      jog: 1,
      narrows: 3,
      ice: 1,
      wave: 0.5,
      acid: 2,
      hammer: 1,
      gauntlet: 2.5,
      steelie: 2,
      hoover: 1.5,
      muncher: 1,
      catapult: 1.5,
      funnel: 0.5,
      ferry: 2,
      funnelMaze: 1,
      waveCrossing: 1.5,
    },
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
