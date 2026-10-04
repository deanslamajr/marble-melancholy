import type { Fnv } from "../../core/hash";
import type { Rng } from "../../core/rng";
import type { EntityType, PlayableLevel } from "../../level/types";
import type { Segment } from "../collision";
import type { Ground, Terrain } from "../terrain";
import type { DeathCause, EntitySnapshot, MarbleState, PlayerState, SimEvent } from "../types";

/** The slice of RaceSim that entities may use. */
export interface SimContext {
  /** Race tick being simulated (0 = first tick after GO). */
  readonly tick: number;
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly players: readonly PlayerState[];
  readonly level: PlayableLevel;
  emit(e: SimEvent): void;
  die(p: PlayerState, cause: DeathCause): void;
}

export interface SimEntity {
  readonly index: number;
  readonly type: EntityType;
  update(sim: SimContext): void;
  interact(sim: SimContext, p: PlayerState): void;
  hashInto(h: Fnv): void;
  snapshot(sim: SimContext): EntitySnapshot;
  groundPatch?(x: number, y: number, baseZ: number | null): Ground | null;
  wallSegments?(x: number, y: number, z: number, out: Segment[]): void;
  /** Extra horizontal acceleration on a marble (hoover suction). */
  pull?(sim: SimContext, m: MarbleState): [number, number] | null;
  /** Called when a marble held by this entity (transit/windup) finishes its timer. */
  release?(sim: SimContext, p: PlayerState): void;
  /** Spawn-camping guard (§7.8). */
  onRespawn?(sim: SimContext, x: number, y: number): void;
}

/** Ping-pong walker along a list of cell centres at constant speed (steelie patrol, muncher). */
export class PathWalker {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  target = 1;
  dirSign = 1;

  constructor(
    readonly path: ReadonlyArray<readonly [number, number]>,
    readonly speed: number,
  ) {
    const p0 = path[0]!;
    this.x = p0[0] + 0.5;
    this.y = p0[1] + 0.5;
    if (path.length < 2) this.target = 0;
  }

  /** Proposed velocity for this tick (without moving). */
  desired(dt: number): [number, number] {
    if (this.path.length < 2 || this.speed <= 0) return [0, 0];
    const t = this.path[this.target]!;
    const dx = t[0] + 0.5 - this.x;
    const dy = t[1] + 0.5 - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-9) return [0, 0];
    const step = Math.min(this.speed, d / dt);
    return [(dx / d) * step, (dy / d) * step];
  }

  advanceTarget(): void {
    if (this.path.length < 2) return;
    const t = this.path[this.target]!;
    if (Math.abs(t[0] + 0.5 - this.x) < 1e-6 && Math.abs(t[1] + 0.5 - this.y) < 1e-6) {
      let next = this.target + this.dirSign;
      if (next >= this.path.length || next < 0) {
        this.dirSign = -this.dirSign;
        next = this.target + this.dirSign;
      }
      this.target = next;
    }
  }
}

/** Ground acceptance for walkers that never fall or climb walls (§7.10 steelie rule). */
export function walkableStep(
  terrain: Terrain,
  tick: number,
  z: number,
  nx: number,
  ny: number,
): Ground | null {
  const g = terrain.groundAt(nx, ny, tick);
  if (!g) return null;
  if (g.z < z - 1.0 || g.z > z + 0.15) return null;
  return g;
}
