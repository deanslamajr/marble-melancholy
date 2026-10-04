// Level data model (§5). Source format mm-level-source/1, compiled format mm-level/1.

export type Cell = [x: number, y: number];
export type Rect = [x0: number, y0: number, x1: number, y1: number];
export type Vec3 = [dx: number, dy: number, dz: number];

export const THEME_IDS = [
  "practice",
  "descent",
  "clockwork",
  "skyways",
  "topsy",
  "lastledge",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const MUSIC_IDS = [
  "m1-first-steps",
  "m2-long-drop",
  "m3-clockwork",
  "m4-skyways",
  "m5-upside",
  "m6-last-ledge",
] as const;
export type MusicId = (typeof MUSIC_IDS)[number];

export interface ThemeOverride {
  base: ThemeId;
  top?: string;
  sideLight?: string;
  sideDark?: string;
  rail?: string;
  bgTop?: string;
  bgBottom?: string;
  accent?: string;
}

export interface ResolvedTheme {
  id: ThemeId;
  top: string;
  sideLight: string;
  sideDark: string;
  rail: string;
  bgTop: string;
  bgBottom: string;
  accent: string;
}

export interface CheckpointSource {
  at: Cell;
  radius?: number;
  respawnAt?: Cell;
}

export interface SteelieSource {
  type: "steelie";
  at: Cell;
  mode?: "patrol" | "hunt";
  path?: Cell[];
  speed?: number;
  aggroRadius?: number;
}
export interface MuncherSource {
  type: "muncher";
  at: Cell;
  triggerRadius?: number;
  path?: Cell[];
  speed?: number;
  digestTime?: number;
}
export interface HooverSource {
  type: "hoover";
  at: Cell;
  pullRadius?: number;
  pullStrength?: number;
  killRadius?: number;
  onTime?: number;
  offTime?: number;
  phase?: number;
}
export interface HammerSource {
  type: "hammer";
  at: Cell;
  period?: number;
  phase?: number;
}
export interface CatapultSource {
  type: "catapult";
  at: Cell;
  launch: Vec3;
  windup?: number;
}
export interface WaveSource {
  type: "wave";
  rect: Rect;
  amplitude?: number;
  wavelength?: number;
  speed?: number;
  dir?: [number, number];
}
export interface PlatformSource {
  type: "platform";
  at: Cell;
  size?: [w: number, h: number];
  top: number;
  path: Cell[];
  speed?: number;
  pause?: number;
  phase?: number;
}
export interface PipeSource {
  type: "pipe";
  entry: Cell;
  exit: Cell;
  exitVelocity?: Vec3;
  travelTime?: number;
}
export interface FunnelSource {
  type: "funnel";
  at: Cell;
  radius?: number;
  depth?: number;
  exit: Cell;
  exitVelocity?: Vec3;
  travelTime?: number;
}

export type EntitySource =
  | SteelieSource
  | MuncherSource
  | HooverSource
  | HammerSource
  | CatapultSource
  | WaveSource
  | PlatformSource
  | PipeSource
  | FunnelSource;

export type EntityType = EntitySource["type"];

export const ENTITY_TYPES: readonly EntityType[] = [
  "steelie",
  "muncher",
  "hoover",
  "hammer",
  "catapult",
  "wave",
  "platform",
  "pipe",
  "funnel",
];

export interface Waypoint {
  at: Cell;
  speed?: number;
  radius?: number;
  hold?: number;
}
export interface ScriptSegment {
  ticks: number;
  dir: [ax: number, ay: number];
}

export type SolutionSource =
  | { kind: "waypoints"; points: Waypoint[]; maxTicks?: number }
  | { kind: "script"; segments: ScriptSegment[] }
  | { kind: "replay"; runs: number[]; expectedTicks: number };

export interface LevelSource {
  format: "mm-level-source/1";
  id: string;
  name: string;
  author?: string;
  course?: { slot: number };
  theme: ThemeId | ThemeOverride;
  music: MusicId;
  seed?: number;
  grid: { width: number; height: number };
  layers: {
    heights: string;
    slopes?: string;
    surfaces?: string;
    walls?: string;
  };
  start: { p1: Cell; p2: Cell };
  goal: { at: Cell; radius?: number };
  checkpoints?: CheckpointSource[];
  entities?: EntitySource[];
  timing: { timeLimit: number; par: number; timeBonus?: number };
  scoring?: { progress?: number; goal?: number; perSecond?: number; firstHome?: number };
  physics?: { slopeGravityScale?: number; frictionScale?: number; inputScale?: number };
  solution?: SolutionSource;
}

// ---------- compiled ----------

type Resolved<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

export type CompiledSteelie = Resolved<SteelieSource> & { index: number };
export type CompiledMuncher = Resolved<MuncherSource> & { index: number };
export type CompiledHoover = Resolved<HooverSource> & { index: number };
export type CompiledHammer = Resolved<HammerSource> & { index: number };
export type CompiledCatapult = Resolved<CatapultSource> & { index: number };
export type CompiledWave = Resolved<WaveSource> & { index: number };
export type CompiledPlatform = Resolved<PlatformSource> & { index: number };
export type CompiledPipe = Resolved<PipeSource> & { index: number };
export type CompiledFunnel = Resolved<FunnelSource> & { index: number };

export type CompiledEntity =
  | CompiledSteelie
  | CompiledMuncher
  | CompiledHoover
  | CompiledHammer
  | CompiledCatapult
  | CompiledWave
  | CompiledPlatform
  | CompiledPipe
  | CompiledFunnel;

export interface CompiledCheckpoint {
  at: Cell;
  radius: number;
  respawnAt: Cell;
}

export interface Stamp {
  builder: "mmlevel";
  version: string;
  sourceHash: string;
  contentHash: string;
}

export interface CompiledSolution {
  runs: number[];
  ticks: number;
  deaths: number;
  stateHash: string;
}

export interface LevelBounds {
  minSx: number;
  minSy: number;
  maxSx: number;
  maxSy: number;
}

/** Everything in a compiled level except solution and stamp. */
export interface UnstampedLevel {
  format: "mm-level/1";
  id: string;
  name: string;
  author: string;
  course: { slot: number } | null;
  theme: ResolvedTheme;
  music: MusicId;
  seed: number;
  grid: { width: number; height: number };
  cells: {
    heights: number[];
    slopes: number[];
    surfaces: number[];
    walls: number[];
    progress: number[];
  };
  start: { p1: Cell; p2: Cell };
  goal: { at: Cell; radius: number };
  checkpoints: CompiledCheckpoint[];
  entities: CompiledEntity[];
  timing: { timeLimit: number; par: number; timeBonus: number };
  scoring: { progress: number; goal: number; perSecond: number; firstHome: number };
  physics: { slopeGravityScale: number; frictionScale: number; inputScale: number };
  bounds: LevelBounds;
}

export interface CompiledLevel extends UnstampedLevel {
  solution: CompiledSolution;
  stamp: Stamp;
}

/** Live-preview compile result (GUI only). Never loadable by LevelLoader. */
export interface DraftCompiled extends UnstampedLevel {
  solution: CompiledSolution | null;
  stamp: null;
}

/** Anything the sim can run: stamped, draft, or unstamped. */
export type PlayableLevel = UnstampedLevel;

// Numeric codes in compiled cells.
export const SLOPE = { flat: 0, N: 1, E: 2, S: 3, W: 4, n: 5, e: 6, s: 7, w: 8 } as const;
export const SURFACE = {
  normal: 0,
  ice: 1,
  acid: 2,
  speedN: 3,
  speedE: 4,
  speedS: 5,
  speedW: 6,
} as const;
export const WALL = { N: 1, E: 2, S: 4, W: 8 } as const;

export type SurfaceId = "normal" | "ice" | "acid" | "speed";
