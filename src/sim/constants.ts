// All physics numbers (§7.2).
import type { DeathCause } from "./types";

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

export const MARBLE_RADIUS = 0.35;
export const MARBLE_MASS = 1;
export const STEELIE_MASS = 3;
export const STEELIE_RADIUS = 0.35;
export const GRAVITY = 24;
export const INPUT_ACCEL = 18;
export const INPUT_MAX_SPEED = 7;
export const AIR_INPUT_AUTHORITY = 0.25;
export const MAX_SPEED = 14;
export const ROLL_FRICTION = { normal: 4.0, ice: 0.5, speed: 2.0, acid: 4.0 } as const;
export const LINEAR_DRAG = 0.15;
export const SPEED_STRIP_ACCEL = 30;
export const SPEED_STRIP_MAX = 12;
export const WALL_RESTITUTION = 0.5;
export const MARBLE_RESTITUTION = 0.8;
export const STEELIE_RESTITUTION = 0.9;
export const WALL_STEP_THRESHOLD = 0.15;
export const FALL_START_THRESHOLD = 0.05;
export const SHATTER_FALL_HEIGHT = 2.5;
export const BOUNCE_MIN_VZ = 1.5;
export const LAND_RESTITUTION = 0.3;
/** Max depth below a surface from which an airborne marble may still land on it (units). */
export const LAND_SNAP = 0.5;
export const KILL_PLANE_BELOW_MIN = 4;
export const CLACK_MIN_IMPACT = 1.5;
export const RAIL_HEIGHT = 0.3;

export const DEATH_ANIM_TICKS: Record<DeathCause, number> = {
  shatter: 84,
  fall: 84,
  acid: 72,
  munch: 96,
  hammer: 60,
  hoover: 60,
  "left-behind": 84,
};
export const RESPAWN_DELAY_TICKS = 120;
export const RESPAWN_DROP = 1.0;
export const GOAL_SETTLE_TICKS = 180;
export const COUNTDOWN_TICKS = 360;
export const FINISH_WINDOW_TICKS = 600;

/** Steelie / muncher acceleration numbers (§7.10). */
export const STEELIE_ACCEL = 12;
export const STEELIE_RECOIL_TICKS = 60;
export const STEELIE_RAM_MIN_IMPACT = 0.3;
export const MUNCHER_LUNGE_SPEED = 6;
export const MUNCHER_LUNGE_TICKS = 36;
export const MUNCHER_REACH = 1.5;
export const MUNCHER_CATCH_RADIUS = 0.45;
export const MUNCHER_RETRACT_TICKS = 48;

export const HAMMER_HEAD_REST = 2.0;
export const HAMMER_DROP = 0.15;
export const HAMMER_DOWN = 0.4;
export const HAMMER_LIFT = 0.25;
export const HAMMER_WALL_HEIGHT = 2.0;

export const PLATFORM_THICKNESS = 0.5;
export const PIPE_ENTRY_RADIUS = 0.3;
export const FUNNEL_HOLE_RADIUS = 0.3;
export const CATAPULT_TRIGGER_RADIUS = 0.4;
export const HOOVER_NOZZLE_HEIGHT = 0.3;
export const SPAWN_CLEAR_RADIUS = 1.0;
