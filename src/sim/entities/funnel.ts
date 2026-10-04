import type { Fnv } from "../../core/hash";
import type { CompiledFunnel } from "../../level/types";
import { FUNNEL_HOLE_RADIUS } from "../constants";
import type { EntitySnapshot, PlayerState } from "../types";
import type { SimContext, SimEntity } from "./base";
import { enterTransit, exitTransit } from "./pipe";

/** Cone terrain is applied by Terrain; this entity handles the centre hole. */
export class FunnelEntity implements SimEntity {
  readonly type = "funnel" as const;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;

  constructor(
    readonly def: CompiledFunnel,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.x = def.at[0] + 0.5;
    this.y = def.at[1] + 0.5;
    const base = sim.terrain.hRaw(def.at[0], def.at[1]);
    this.z = base >= 0 ? base * 0.5 : 0;
  }

  update(): void {}

  interact(sim: SimContext, p: PlayerState): void {
    const m = p.marble;
    if (m.status !== "alive" || !m.grounded) return;
    const dx = m.x - this.x;
    const dy = m.y - this.y;
    if (dx * dx + dy * dy >= FUNNEL_HOLE_RADIUS * FUNNEL_HOLE_RADIUS) return;
    enterTransit(sim, p, this.index, this.x, this.y, this.def.travelTime);
    sim.emit({ t: "funnelEnter", player: p.index });
  }

  release(sim: SimContext, p: PlayerState): void {
    exitTransit(sim, p, this.def.exit, this.def.exitVelocity);
  }

  hashInto(_h: Fnv): void {}

  snapshot(): EntitySnapshot {
    return {
      type: "funnel",
      index: this.index,
      x: this.x,
      y: this.y,
      z: this.z,
      radius: this.def.radius,
      depth: this.def.depth,
    };
  }
}
