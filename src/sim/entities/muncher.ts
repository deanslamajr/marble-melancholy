import type { Fnv } from "../../core/hash";
import type { CompiledMuncher } from "../../level/types";
import {
  DT,
  MUNCHER_CATCH_RADIUS,
  MUNCHER_LUNGE_SPEED,
  MUNCHER_LUNGE_TICKS,
  MUNCHER_REACH,
  MUNCHER_RETRACT_TICKS,
  TICK_HZ,
} from "../constants";
import type { EntitySnapshot, PlayerState } from "../types";
import { PathWalker, walkableStep, type SimContext, type SimEntity } from "./base";
import { pushAway } from "./steelie";

type MuncherState = "idle" | "lunge" | "swallow" | "digest" | "retract";
const STATE_CODES: Record<MuncherState, number> = {
  idle: 0,
  lunge: 1,
  swallow: 2,
  digest: 3,
  retract: 4,
};
const SWALLOW_TICKS = 24;

export class MuncherEntity implements SimEntity {
  readonly type = "muncher" as const;
  readonly index: number;
  x: number;
  y: number;
  z: number;
  headX: number;
  headY: number;
  state: MuncherState = "idle";
  stateTicks = 0;
  targetPlayer = -1;
  private walker: PathWalker;

  constructor(
    readonly def: CompiledMuncher,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.walker = new PathWalker(def.path, def.speed);
    this.x = this.walker.x;
    this.y = this.walker.y;
    this.z = sim.terrain.groundAt(this.x, this.y, 0)?.z ?? 0;
    this.headX = this.x;
    this.headY = this.y;
  }

  update(sim: SimContext): void {
    switch (this.state) {
      case "idle": {
        const [vx, vy] = this.walker.desired(DT);
        if (vx !== 0 || vy !== 0) {
          const nx = this.x + vx * DT;
          const ny = this.y + vy * DT;
          const g = walkableStep(sim.terrain, sim.tick, this.z, nx, ny);
          if (g) {
            this.x = nx;
            this.y = ny;
            this.z = g.z;
            this.walker.x = nx;
            this.walker.y = ny;
            this.walker.advanceTarget();
          }
        }
        this.headX = this.x;
        this.headY = this.y;
        break;
      }
      case "lunge": {
        this.stateTicks++;
        const p = sim.players[this.targetPlayer];
        if (p && p.marble.status === "alive") {
          const dx = p.marble.x - this.headX;
          const dy = p.marble.y - this.headY;
          const d = Math.sqrt(dx * dx + dy * dy);
          const step = Math.min(MUNCHER_LUNGE_SPEED * DT, d);
          if (d > 1e-9) {
            this.headX += (dx / d) * step;
            this.headY += (dy / d) * step;
          }
          const rx = this.headX - this.x;
          const ry = this.headY - this.y;
          const r = Math.sqrt(rx * rx + ry * ry);
          if (r > MUNCHER_REACH) {
            this.headX = this.x + (rx / r) * MUNCHER_REACH;
            this.headY = this.y + (ry / r) * MUNCHER_REACH;
          }
        }
        if (this.stateTicks >= MUNCHER_LUNGE_TICKS) this.setState("retract");
        break;
      }
      case "swallow":
      case "digest": {
        this.stateTicks++;
        this.retractHead(SWALLOW_TICKS);
        if (this.state === "swallow" && this.stateTicks >= SWALLOW_TICKS) {
          this.state = "digest";
        }
        if (this.stateTicks >= Math.round(this.def.digestTime * TICK_HZ)) this.setState("idle");
        break;
      }
      case "retract": {
        this.stateTicks++;
        this.retractHead(MUNCHER_RETRACT_TICKS - this.stateTicks + 1);
        if (this.stateTicks >= MUNCHER_RETRACT_TICKS) this.setState("idle");
        break;
      }
    }
  }

  private retractHead(ticksLeft: number): void {
    const n = Math.max(1, ticksLeft);
    this.headX += (this.x - this.headX) / n;
    this.headY += (this.y - this.headY) / n;
  }

  private setState(s: MuncherState): void {
    this.state = s;
    this.stateTicks = 0;
    if (s === "idle") {
      this.headX = this.x;
      this.headY = this.y;
      this.targetPlayer = -1;
    }
  }

  interact(sim: SimContext, p: PlayerState): void {
    const m = p.marble;
    if (m.status !== "alive") return;
    if (Math.abs(m.z - this.z) > 1.0) return;
    if (this.state === "idle") {
      const dx = m.x - this.x;
      const dy = m.y - this.y;
      if (dx * dx + dy * dy < this.def.triggerRadius * this.def.triggerRadius) {
        this.setState("lunge");
        this.targetPlayer = p.index;
        sim.emit({ t: "munchLunge", entity: this.index });
      }
    } else if (this.state === "lunge") {
      const dx = m.x - this.headX;
      const dy = m.y - this.headY;
      if (dx * dx + dy * dy < MUNCHER_CATCH_RADIUS * MUNCHER_CATCH_RADIUS) {
        sim.die(p, "munch");
        this.state = "swallow";
        this.stateTicks = 0;
      }
    }
  }

  onRespawn(sim: SimContext, x: number, y: number): void {
    pushAway(this, sim, x, y);
    this.walker.x = this.x;
    this.walker.y = this.y;
    this.headX = this.x;
    this.headY = this.y;
  }

  hashInto(h: Fnv): void {
    h.fixed(this.x).fixed(this.y).fixed(this.z).fixed(this.headX).fixed(this.headY);
    h.int(STATE_CODES[this.state]).int(this.stateTicks).int(this.targetPlayer);
    h.int(this.walker.target).int(this.walker.dirSign);
  }

  snapshot(): EntitySnapshot {
    return {
      type: "muncher",
      index: this.index,
      x: this.x,
      y: this.y,
      z: this.z,
      headX: this.headX,
      headY: this.headY,
      state: this.state,
      stateTicks: this.stateTicks,
    };
  }
}
