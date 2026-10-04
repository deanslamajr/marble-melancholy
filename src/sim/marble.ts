// One marble's per-tick integration (§7.4 step 3).
import type { PlayableLevel } from "../level/types";
import { resolveWalls, type WallProvider } from "./collision";
import {
  AIR_INPUT_AUTHORITY,
  BOUNCE_MIN_VZ,
  DT,
  FALL_START_THRESHOLD,
  GRAVITY,
  INPUT_ACCEL,
  INPUT_MAX_SPEED,
  LAND_RESTITUTION,
  LAND_SNAP,
  LINEAR_DRAG,
  MARBLE_RADIUS,
  MAX_SPEED,
  ROLL_FRICTION,
  SHATTER_FALL_HEIGHT,
  SPEED_STRIP_ACCEL,
  SPEED_STRIP_MAX,
} from "./constants";
import type { SimContext, SimEntity } from "./entities/base";
import type { Terrain } from "./terrain";
import type { InputFrame, MarbleState, PlayerState } from "./types";

/** Speed strip unit directions by surface code 3–6 (N, E, S, W). */
const STRIP_DIR: Record<number, [number, number]> = {
  3: [0, -1],
  4: [1, 0],
  5: [0, 1],
  6: [-1, 0],
};

export interface MarbleWorld extends SimContext {
  readonly terrain: Terrain;
  readonly entities: readonly SimEntity[];
  readonly wallProviders: readonly WallProvider[];
  readonly killPlane: number;
  readonly level: PlayableLevel;
}

export function newMarble(x: number, y: number, z: number): MarbleState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    fallStartZ: z,
    surface: "normal",
    carrierVx: 0,
    carrierVy: 0,
    status: "alive",
    statusTicks: 0,
    deathCause: null,
    catapultFlight: false,
    respawnDrop: false,
    inputLocked: false,
    rollPhase: 0,
    holder: -1,
    lastStrip: -1,
    frozen: false,
  };
}

/** Integrate an alive (or settling finished) marble for one tick. */
export function integrateMarble(world: MarbleWorld, p: PlayerState, input: InputFrame): void {
  const m = p.marble;
  const phys = world.level.physics;
  const tick = world.tick;
  const finished = m.status === "finished";

  // a. input
  let ax = 0;
  let ay = 0;
  if (!m.inputLocked && !finished) {
    ax = input.ax;
    ay = input.ay;
  }
  const authority = m.grounded ? 1 : AIR_INPUT_AUTHORITY;

  // b. accelerations
  let accX = 0;
  let accY = 0;
  const inMag = Math.sqrt(ax * ax + ay * ay);
  if (inMag > 0) {
    const ux = ax / inMag;
    const uy = ay / inMag;
    const along = m.vx * ux + m.vy * uy;
    if (along < INPUT_MAX_SPEED) {
      const k = INPUT_ACCEL * phys.inputScale * authority;
      accX += ax * k;
      accY += ay * k;
    }
  }
  let ground = m.grounded ? world.terrain.groundAt(m.x, m.y, tick) : null;
  if (m.grounded && ground) {
    accX += -GRAVITY * ground.gradX * phys.slopeGravityScale;
    accY += -GRAVITY * ground.gradY * phys.slopeGravityScale;
    const strip = STRIP_DIR[ground.surfaceCode];
    if (strip) {
      if (m.vx * strip[0] + m.vy * strip[1] < SPEED_STRIP_MAX) {
        accX += SPEED_STRIP_ACCEL * strip[0];
        accY += SPEED_STRIP_ACCEL * strip[1];
      }
    }
  }
  for (const e of world.entities) {
    if (!e.pull) continue;
    const a = e.pull(world, m);
    if (a) {
      accX += a[0];
      accY += a[1];
    }
  }

  // c. integrate velocity, friction, drag, cap
  m.vx += accX * DT;
  m.vy += accY * DT;
  if (m.grounded && ground) {
    const decel = ROLL_FRICTION[ground.surface] * phys.frictionScale;
    const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
    if (sp < decel * DT) {
      m.vx = 0;
      m.vy = 0;
    } else if (sp > 0) {
      m.vx -= (m.vx / sp) * decel * DT;
      m.vy -= (m.vy / sp) * decel * DT;
    }
    const drag = 1 - LINEAR_DRAG * DT;
    m.vx *= drag;
    m.vy *= drag;
  }
  const hs = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
  if (hs > MAX_SPEED) {
    m.vx = (m.vx / hs) * MAX_SPEED;
    m.vy = (m.vy / hs) * MAX_SPEED;
  }

  // d. position
  m.x += (m.vx + m.carrierVx) * DT;
  m.y += (m.vy + m.carrierVy) * DT;

  // e. walls (two passes)
  let impact = resolveWalls(m, world.terrain, world.wallProviders, tick);
  impact = Math.max(impact, resolveWalls(m, world.terrain, world.wallProviders, tick));
  if (impact > 0) world.emit({ t: "clack", player: p.index, impact });

  // f. vertical
  ground = world.terrain.groundAt(m.x, m.y, tick);
  if (m.grounded) {
    if (!ground || ground.z < m.z - FALL_START_THRESHOLD) {
      m.grounded = false;
      m.fallStartZ = m.z;
      m.vz = 0;
      // Leaving a moving platform keeps its velocity (DECISIONS M06).
      m.vx += m.carrierVx;
      m.vy += m.carrierVy;
      m.carrierVx = 0;
      m.carrierVy = 0;
    } else {
      m.z = ground.z;
    }
  } else {
    m.vz -= GRAVITY * DT;
    const zPrev = m.z;
    m.z += m.vz * DT;
    // Only land when crossing the surface from above; a marble under a platform keeps falling.
    if (ground && m.z <= ground.z && m.vz <= 0 && zPrev >= ground.z - LAND_SNAP) {
      const fall = m.fallStartZ - ground.z;
      if (fall >= SHATTER_FALL_HEIGHT && !m.catapultFlight && !m.respawnDrop) {
        m.z = ground.z;
        world.die(p, "shatter");
        return;
      }
      const vzBefore = -m.vz;
      m.z = ground.z;
      if (vzBefore > BOUNCE_MIN_VZ) {
        m.vz = vzBefore * LAND_RESTITUTION;
        m.fallStartZ = m.z;
      } else {
        m.vz = 0;
        m.grounded = true;
        m.catapultFlight = false;
        if (m.respawnDrop) {
          m.respawnDrop = false;
          if (!finished) m.inputLocked = false;
        }
      }
      world.emit({ t: "land", player: p.index, impact: vzBefore });
    }
  }
  if (m.z < world.killPlane) {
    world.die(p, "fall");
    return;
  }

  // g. surface
  if (m.grounded && ground) {
    m.surface = ground.surface;
    if (ground.surface === "acid" && !finished) {
      world.die(p, "acid");
      return;
    }
    if (ground.surface === "speed") {
      if (m.lastStrip !== ground.surfaceCode) {
        m.lastStrip = ground.surfaceCode;
        world.emit({ t: "speedStrip", player: p.index });
      }
    } else {
      m.lastStrip = -1;
    }
  }

  // h. progress
  if (m.grounded && ground && !finished) {
    const i = world.terrain.index(ground.cx, ground.cy);
    const prog = i >= 0 ? world.level.cells.progress[i]! : -1;
    if (prog >= 0) {
      const v = 1000 - prog;
      if (v > p.progressBest) {
        p.progressBest = v;
        const credited = Math.round((p.progressBest * world.level.scoring.progress) / 1000);
        p.score += credited - p.progressScore;
        p.progressScore = credited;
      }
    }
  }

  // i. carrier
  if (m.grounded) {
    m.carrierVx = ground?.carrier ? ground.carrier.vx : 0;
    m.carrierVy = ground?.carrier ? ground.carrier.vy : 0;
  }

  m.rollPhase += (Math.sqrt(m.vx * m.vx + m.vy * m.vy) * DT) / MARBLE_RADIUS;
}
