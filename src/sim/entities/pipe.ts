import type { Fnv } from "../../core/hash";
import type { Cell, CompiledPipe, Vec3 } from "../../level/types";
import { PIPE_ENTRY_RADIUS, TICK_HZ } from "../constants";
import type { EntitySnapshot, PlayerState } from "../types";
import type { SimContext, SimEntity } from "./base";

/** Shared transit behaviour for pipes and funnel holes. */
export function enterTransit(
  sim: SimContext,
  p: PlayerState,
  index: number,
  x: number,
  y: number,
  travelTime: number,
): void {
  const m = p.marble;
  m.status = "transit";
  m.statusTicks = Math.max(1, Math.round(travelTime * TICK_HZ));
  m.holder = index;
  m.x = x;
  m.y = y;
  m.vx = 0;
  m.vy = 0;
  m.vz = 0;
  void sim;
}

export function exitTransit(sim: SimContext, p: PlayerState, exit: Cell, v: Vec3): void {
  const m = p.marble;
  const x = exit[0] + 0.5;
  const y = exit[1] + 0.5;
  const g = sim.terrain.groundAt(x, y, sim.tick);
  m.status = "alive";
  m.holder = -1;
  m.x = x;
  m.y = y;
  m.z = g ? g.z : m.z;
  m.vx = v[0];
  m.vy = v[1];
  m.vz = v[2];
  m.fallStartZ = m.z;
  m.grounded = v[2] <= 0;
  if (m.grounded) m.vz = 0;
  m.catapultFlight = false;
  sim.emit({ t: "pipeExit", player: p.index });
}

export class PipeEntity implements SimEntity {
  readonly type = "pipe" as const;
  readonly index: number;
  readonly entryZ: number;
  readonly exitZ: number;

  constructor(
    readonly def: CompiledPipe,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.entryZ = sim.terrain.baseGroundAt(def.entry[0] + 0.5, def.entry[1] + 0.5, 0)?.z ?? 0;
    this.exitZ = sim.terrain.baseGroundAt(def.exit[0] + 0.5, def.exit[1] + 0.5, 0)?.z ?? 0;
  }

  update(): void {}

  interact(sim: SimContext, p: PlayerState): void {
    const m = p.marble;
    if (m.status !== "alive" || !m.grounded) return;
    const cx = this.def.entry[0] + 0.5;
    const cy = this.def.entry[1] + 0.5;
    const dx = m.x - cx;
    const dy = m.y - cy;
    if (dx * dx + dy * dy >= PIPE_ENTRY_RADIUS * PIPE_ENTRY_RADIUS) return;
    enterTransit(sim, p, this.index, cx, cy, this.def.travelTime);
    sim.emit({ t: "pipeEnter", player: p.index });
  }

  release(sim: SimContext, p: PlayerState): void {
    exitTransit(sim, p, this.def.exit, this.def.exitVelocity);
  }

  hashInto(_h: Fnv): void {}

  snapshot(): EntitySnapshot {
    return {
      type: "pipe",
      index: this.index,
      entry: this.def.entry,
      exit: this.def.exit,
      entryZ: this.entryZ,
      exitZ: this.exitZ,
    };
  }
}
