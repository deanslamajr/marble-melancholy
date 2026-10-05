import { mod } from "../../core/dmath";
import type { Fnv } from "../../core/hash";
import type { CompiledHammer } from "../../level/types";
import type { Segment } from "../collision";
import {
  DT,
  HAMMER_DOWN,
  HAMMER_DROP,
  HAMMER_HEAD_REST,
  HAMMER_LIFT,
  HAMMER_WALL_HEIGHT,
} from "../constants";
import type { EntitySnapshot, PlayerState } from "../types";
import type { SimContext, SimEntity } from "./base";

type HammerPhase = "up" | "drop" | "down" | "lift";
const PHASE_CODES: Record<HammerPhase, number> = { up: 0, drop: 1, down: 2, lift: 3 };

export class HammerEntity implements SimEntity {
  readonly type = "hammer" as const;
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
  phase: HammerPhase;
  headHeight = HAMMER_HEAD_REST;
  private struck = false;

  constructor(
    readonly def: CompiledHammer,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.cx = def.at[0];
    this.cy = def.at[1];
    this.z = sim.terrain.baseGroundAt(this.cx + 0.5, this.cy + 0.5, 0)?.z ?? 0;
    this.phase = this.phaseAt(-1).phase;
  }

  /** Phase and head height at `tick`; a pure function of the definition (M14 reads it). */
  phaseAt(tick: number): { phase: HammerPhase; height: number } {
    const P = this.def.period;
    const tau = mod(tick * DT + this.def.phase, P);
    const upEnd = P - (HAMMER_DROP + HAMMER_DOWN + HAMMER_LIFT);
    const dropEnd = upEnd + HAMMER_DROP;
    const downEnd = dropEnd + HAMMER_DOWN;
    if (tau < upEnd) return { phase: "up", height: HAMMER_HEAD_REST };
    if (tau < dropEnd) {
      return { phase: "drop", height: HAMMER_HEAD_REST * (1 - (tau - upEnd) / HAMMER_DROP) };
    }
    if (tau < downEnd) return { phase: "down", height: 0 };
    return { phase: "lift", height: (HAMMER_HEAD_REST * (tau - downEnd)) / HAMMER_LIFT };
  }

  update(sim: SimContext): void {
    const prev = this.phase;
    const now = this.phaseAt(sim.tick);
    this.phase = now.phase;
    this.headHeight = now.height;
    this.struck = prev !== "down" && now.phase === "down";
    if (this.struck) sim.emit({ t: "hammerDown", entity: this.index });
  }

  interact(sim: SimContext, p: PlayerState): void {
    if (!this.struck) return;
    const m = p.marble;
    if (m.status !== "alive") return;
    if (m.x < this.cx || m.x >= this.cx + 1 || m.y < this.cy || m.y >= this.cy + 1) return;
    if (m.z >= this.z + HAMMER_WALL_HEIGHT) return;
    sim.die(p, "hammer");
  }

  wallSegments(_x: number, _y: number, z: number, out: Segment[]): void {
    if (this.phase !== "down" || z >= this.z + HAMMER_WALL_HEIGHT) return;
    const x0 = this.cx;
    const y0 = this.cy;
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    out.push({ ax: x0, ay: y0, bx: x1, by: y0 });
    out.push({ ax: x1, ay: y0, bx: x1, by: y1 });
    out.push({ ax: x1, ay: y1, bx: x0, by: y1 });
    out.push({ ax: x0, ay: y1, bx: x0, by: y0 });
  }

  hashInto(h: Fnv): void {
    h.int(PHASE_CODES[this.phase]).fixed(this.headHeight);
  }

  snapshot(): EntitySnapshot {
    return {
      type: "hammer",
      index: this.index,
      x: this.cx + 0.5,
      y: this.cy + 0.5,
      z: this.z,
      headHeight: this.headHeight,
      phase: this.phase,
    };
  }
}
