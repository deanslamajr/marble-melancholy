import { mod } from "../../core/dmath";
import type { Fnv } from "../../core/hash";
import type { CompiledHoover } from "../../level/types";
import { DT, HOOVER_NOZZLE_HEIGHT } from "../constants";
import type { EntitySnapshot, MarbleState, PlayerState } from "../types";
import type { SimContext, SimEntity } from "./base";

export class HooverEntity implements SimEntity {
  readonly type = "hoover" as const;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  active = true;

  constructor(
    readonly def: CompiledHoover,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.x = def.at[0] + 0.5;
    this.y = def.at[1] + 0.5;
    this.z = sim.terrain.baseGroundAt(this.x, this.y, 0)?.z ?? 0;
  }

  update(sim: SimContext): void {
    const { onTime, offTime, phase } = this.def;
    if (onTime <= 0) {
      this.active = true;
      return;
    }
    const t = sim.tick * DT + phase;
    this.active = mod(t, onTime + offTime) < onTime;
  }

  pull(_sim: SimContext, m: MarbleState): [number, number] | null {
    if (!this.active) return null;
    const dx = this.x - m.x;
    const dy = this.y - m.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= this.def.pullRadius || d < 1e-6) return null;
    if (Math.abs(m.z - (this.z + HOOVER_NOZZLE_HEIGHT)) > 2.5) return null;
    const a = this.def.pullStrength * (1 - d / this.def.pullRadius);
    return [(dx / d) * a, (dy / d) * a];
  }

  interact(sim: SimContext, p: PlayerState): void {
    if (!this.active) return;
    const m = p.marble;
    if (m.status !== "alive") return;
    const dx = this.x - m.x;
    const dy = this.y - m.y;
    if (dx * dx + dy * dy >= this.def.killRadius * this.def.killRadius) return;
    if (Math.abs(m.z - this.z) > 1.0) return;
    sim.die(p, "hoover");
  }

  hashInto(h: Fnv): void {
    h.bool(this.active);
  }

  snapshot(): EntitySnapshot {
    return {
      type: "hoover",
      index: this.index,
      x: this.x,
      y: this.y,
      z: this.z,
      active: this.active,
      pullRadius: this.def.pullRadius,
    };
  }
}
