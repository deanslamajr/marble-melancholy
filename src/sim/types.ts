import type { Cell, EntityType, Rect, SurfaceId } from "../level/types";

export type { SurfaceId };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** World-space input, |(ax, ay)| ≤ 1, quantized to 1/127 (§7.6). */
export interface InputFrame {
  ax: number;
  ay: number;
}

export const ZERO_INPUT: InputFrame = Object.freeze({ ax: 0, ay: 0 });

export type DeathCause =
  "fall" | "shatter" | "acid" | "munch" | "hammer" | "hoover" | "left-behind";

export type MarbleStatus =
  "alive" | "dying" | "waiting" | "transit" | "windup" | "finished" | "eliminated";

export interface MarbleState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  fallStartZ: number;
  surface: SurfaceId;
  carrierVx: number;
  carrierVy: number;
  status: MarbleStatus;
  statusTicks: number;
  deathCause: DeathCause | null;
  catapultFlight: boolean;
  respawnDrop: boolean;
  inputLocked: boolean;
  rollPhase: number;
  /** Index of the entity holding the marble (pipe/funnel/catapult) during transit/windup, else -1. */
  holder: number;
  /** Strip direction last entered (to emit speedStrip once per entry), -1 when off strips. */
  lastStrip: number;
  /** Frozen after GOAL_SETTLE_TICKS. */
  frozen: boolean;
}

export interface PlayerState {
  index: 0 | 1;
  marble: MarbleState;
  timeTicks: number;
  score: number;
  /** Score accumulated before this race (session carry); race score = score − baseScore. */
  baseScore: number;
  progressBest: number;
  /** Progress points already credited (integer). */
  progressScore: number;
  activeCheckpoint: number;
  deaths: number;
  finishTick: number;
  eliminated: boolean;
  /** Set when this player finished first in a 2P race. */
  firstHome: boolean;
}

export type SimEvent =
  | { t: "clack"; player: number; impact: number }
  | { t: "land"; player: number; impact: number }
  | { t: "death"; player: number; cause: DeathCause; x: number; y: number; z: number }
  | { t: "respawn"; player: number }
  | { t: "checkpoint"; player: number; index: number }
  | { t: "goal"; player: number; tick: number; first: boolean }
  | { t: "timeout"; player: number }
  | { t: "pipeEnter" | "pipeExit" | "funnelEnter" | "catapult" | "speedStrip"; player: number }
  | { t: "hammerDown"; entity: number }
  | { t: "munchLunge"; entity: number }
  | { t: "steelieRam"; player: number }
  | { t: "go" }
  | { t: "countdown"; n: number }
  | { t: "raceOver" };

// ---------- render snapshots (plain data, no sim objects) ----------

export interface PlayerSnapshot {
  index: 0 | 1;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  status: MarbleStatus;
  deathCause: DeathCause | null;
  /** Ticks remaining in the current status (dying/waiting/transit/windup). */
  statusTicks: number;
  rollPhase: number;
  grounded: boolean;
  /** Ground height under the marble, null over void. */
  groundZ: number | null;
  eliminated: boolean;
  timeTicks: number;
  score: number;
  deaths: number;
  activeCheckpoint: number;
  progressBest: number;
}

export type EntitySnapshot =
  | { type: "steelie"; index: number; x: number; y: number; z: number; vx: number; vy: number }
  | {
      type: "muncher";
      index: number;
      x: number;
      y: number;
      z: number;
      headX: number;
      headY: number;
      state: "idle" | "lunge" | "swallow" | "digest" | "retract";
      stateTicks: number;
    }
  | {
      type: "hoover";
      index: number;
      x: number;
      y: number;
      z: number;
      active: boolean;
      pullRadius: number;
    }
  | {
      type: "hammer";
      index: number;
      x: number;
      y: number;
      z: number;
      /** Head bottom height above ground (2.0 up … 0 down). */
      headHeight: number;
      phase: "up" | "drop" | "down" | "lift";
    }
  | {
      type: "catapult";
      index: number;
      x: number;
      y: number;
      z: number;
      /** 0 at rest … 1 fully compressed during windup. */
      compress: number;
    }
  | {
      type: "wave";
      index: number;
      rect: Rect;
    }
  | {
      type: "platform";
      index: number;
      /** Top-left corner of the footprint in world units. */
      x: number;
      y: number;
      w: number;
      h: number;
      topZ: number;
      vx: number;
      vy: number;
    }
  | {
      type: "pipe";
      index: number;
      entry: Cell;
      exit: Cell;
      entryZ: number;
      exitZ: number;
    }
  | {
      type: "funnel";
      index: number;
      x: number;
      y: number;
      z: number;
      radius: number;
      depth: number;
    };

export interface SimSnapshot {
  /** Race tick (0 = first tick after GO). */
  tick: number;
  /** Countdown ticks remaining (0 once racing). */
  countdown: number;
  players: PlayerSnapshot[];
  entities: EntitySnapshot[];
  /** Per checkpoint: player index that first activated it, or -1. */
  checkpointOwners: number[];
}

export type { EntityType };
