import type { Fnv } from "../../core/hash";
import type { CompiledWave } from "../../level/types";
import type { EntitySnapshot } from "../types";
import type { SimEntity } from "./base";

/** Wave floors are pure terrain modifiers (applied in Terrain); this entity only snapshots. */
export class WaveEntity implements SimEntity {
  readonly type = "wave" as const;
  readonly index: number;

  constructor(readonly def: CompiledWave) {
    this.index = def.index;
  }

  update(): void {}
  interact(): void {}
  hashInto(_h: Fnv): void {}

  snapshot(): EntitySnapshot {
    return { type: "wave", index: this.index, rect: this.def.rect };
  }
}
