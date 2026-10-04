import type { CompiledCheckpoint } from "../../level/types";
import type { PlayerState } from "../types";
import type { SimContext } from "./base";

/** Checkpoints are not in `entities[]`; RaceSim runs them after entity interactions (§7.4). */
export class CheckpointTrigger {
  owner = -1;

  constructor(
    readonly order: number,
    readonly def: CompiledCheckpoint,
  ) {}

  interact(sim: SimContext, p: PlayerState): void {
    const m = p.marble;
    if (m.status !== "alive") return;
    if (this.order <= p.activeCheckpoint) return;
    const dx = m.x - (this.def.at[0] + 0.5);
    const dy = m.y - (this.def.at[1] + 0.5);
    if (dx * dx + dy * dy >= this.def.radius * this.def.radius) return;
    p.activeCheckpoint = this.order;
    if (this.owner < 0) this.owner = p.index;
    sim.emit({ t: "checkpoint", player: p.index, index: this.order });
  }
}
