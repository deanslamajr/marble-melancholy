import type { Fnv } from "../../core/hash";
import type { CompiledCatapult } from "../../level/types";
import { CATAPULT_TRIGGER_RADIUS, TICK_HZ } from "../constants";
import type { EntitySnapshot, PlayerState } from "../types";
import type { SimContext, SimEntity } from "./base";

export class CatapultEntity implements SimEntity {
  readonly type = "catapult" as const;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly windupTicks: number;
  busy = -1;

  constructor(
    readonly def: CompiledCatapult,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.x = def.at[0] + 0.5;
    this.y = def.at[1] + 0.5;
    this.z = sim.terrain.baseGroundAt(this.x, this.y, 0)?.z ?? 0;
    this.windupTicks = Math.max(1, Math.round(def.windup * TICK_HZ));
  }

  update(): void {}

  interact(_sim: SimContext, p: PlayerState): void {
    if (this.busy >= 0) return;
    const m = p.marble;
    if (m.status !== "alive" || !m.grounded) return;
    const dx = m.x - this.x;
    const dy = m.y - this.y;
    if (dx * dx + dy * dy >= CATAPULT_TRIGGER_RADIUS * CATAPULT_TRIGGER_RADIUS) return;
    this.busy = p.index;
    m.status = "windup";
    m.statusTicks = this.windupTicks;
    m.holder = this.index;
    m.x = this.x;
    m.y = this.y;
    m.z = this.z;
    m.vx = 0;
    m.vy = 0;
    m.vz = 0;
  }

  release(sim: SimContext, p: PlayerState): void {
    const m = p.marble;
    m.status = "alive";
    m.holder = -1;
    m.vx = this.def.launch[0];
    m.vy = this.def.launch[1];
    m.vz = this.def.launch[2];
    m.grounded = false;
    m.fallStartZ = m.z;
    m.catapultFlight = true;
    this.busy = -1;
    sim.emit({ t: "catapult", player: p.index });
  }

  hashInto(h: Fnv): void {
    h.int(this.busy);
  }

  snapshot(sim: SimContext): EntitySnapshot {
    let compress = 0;
    if (this.busy >= 0) {
      const m = sim.players[this.busy]?.marble;
      if (m && m.status === "windup") compress = 1 - m.statusTicks / this.windupTicks;
    }
    return { type: "catapult", index: this.index, x: this.x, y: this.y, z: this.z, compress };
  }
}
