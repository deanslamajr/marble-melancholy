import type { Fnv } from "../../core/hash";
import type { CompiledSteelie } from "../../level/types";
import { collideSpheres } from "../collision";
import {
  DT,
  MARBLE_MASS,
  MARBLE_RADIUS,
  SPAWN_CLEAR_RADIUS,
  STEELIE_ACCEL,
  STEELIE_MASS,
  STEELIE_RADIUS,
  STEELIE_RECOIL_TICKS,
  STEELIE_RESTITUTION,
  STEELIE_RAM_MIN_IMPACT,
} from "../constants";
import type { EntitySnapshot, PlayerState } from "../types";
import { PathWalker, walkableStep, type SimContext, type SimEntity } from "./base";

export class SteelieEntity implements SimEntity {
  readonly type = "steelie" as const;
  readonly index: number;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  private walker: PathWalker;
  private targetX: number;
  private targetY: number;
  /** Ticks left during which a hunter stops chasing after a ram, so it cannot pin a marble (DECISIONS M09). */
  recoil = 0;

  constructor(
    readonly def: CompiledSteelie,
    sim: Pick<SimContext, "terrain">,
  ) {
    this.index = def.index;
    this.walker = new PathWalker(def.path, def.speed);
    this.x = def.at[0] + 0.5;
    this.y = def.at[1] + 0.5;
    if (def.mode === "patrol") {
      this.x = this.walker.x;
      this.y = this.walker.y;
    }
    this.z = sim.terrain.groundAt(this.x, this.y, 0)?.z ?? 0;
    this.targetX = def.at[0] + 0.5;
    this.targetY = def.at[1] + 0.5;
  }

  update(sim: SimContext): void {
    if (this.def.mode === "patrol") {
      const [dvx, dvy] = this.walker.desired(DT);
      this.vx = dvx;
      this.vy = dvy;
    } else {
      this.huntSteer(sim);
    }
    const nx = this.x + this.vx * DT;
    const ny = this.y + this.vy * DT;
    const g = walkableStep(sim.terrain, sim.tick, this.z, nx, ny);
    if (!g) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    this.x = nx;
    this.y = ny;
    this.z = g.z;
    if (this.def.mode === "patrol") {
      this.walker.x = this.x;
      this.walker.y = this.y;
      this.walker.advanceTarget();
    }
  }

  private huntSteer(sim: SimContext): void {
    let tx = this.targetX;
    let ty = this.targetY;
    let best = this.def.aggroRadius;
    let chasing = false;
    if (this.recoil > 0) this.recoil--;
    for (const p of sim.players) {
      const m = p.marble;
      if (this.recoil > 0 || m.status !== "alive") continue;
      const d = Math.sqrt((m.x - this.x) * (m.x - this.x) + (m.y - this.y) * (m.y - this.y));
      if (d < best && Math.abs(m.z - this.z) < 1.5) {
        best = d;
        tx = m.x;
        ty = m.y;
        chasing = true;
      }
    }
    if (!chasing) {
      const dHome = Math.sqrt((tx - this.x) * (tx - this.x) + (ty - this.y) * (ty - this.y));
      if (dHome < 0.3) {
        const path = this.def.path;
        const pick = path[sim.rng.nextInt(path.length)]!;
        this.targetX = pick[0] + 0.5;
        this.targetY = pick[1] + 0.5;
        tx = this.targetX;
        ty = this.targetY;
      }
    }
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    let wantX = 0;
    let wantY = 0;
    if (d > 1e-6) {
      const s = chasing ? this.def.speed : Math.min(this.def.speed, d * 2);
      wantX = (dx / d) * s;
      wantY = (dy / d) * s;
    }
    let ax = wantX - this.vx;
    let ay = wantY - this.vy;
    const al = Math.sqrt(ax * ax + ay * ay);
    const maxDv = STEELIE_ACCEL * DT;
    if (al > maxDv) {
      ax = (ax / al) * maxDv;
      ay = (ay / al) * maxDv;
    }
    this.vx += ax;
    this.vy += ay;
    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (sp > this.def.speed * 1.5) {
      this.vx = (this.vx / sp) * this.def.speed * 1.5;
      this.vy = (this.vy / sp) * this.def.speed * 1.5;
    }
  }

  interact(sim: SimContext, p: PlayerState): void {
    const m = p.marble;
    if (m.status !== "alive") return;
    const hunt = this.def.mode === "hunt";
    const bx = this.x;
    const by = this.y;
    const impact = collideSpheres(
      m,
      this,
      MARBLE_RADIUS + STEELIE_RADIUS,
      1 / MARBLE_MASS,
      hunt ? 1 / STEELIE_MASS : 0,
      STEELIE_RESTITUTION,
    );
    if (!hunt) {
      this.x = bx;
      this.y = by;
    }
    if (impact > STEELIE_RAM_MIN_IMPACT) {
      if (hunt) this.recoil = STEELIE_RECOIL_TICKS;
      sim.emit({ t: "steelieRam", player: p.index });
    }
  }

  onRespawn(sim: SimContext, x: number, y: number): void {
    pushAway(this, sim, x, y);
    if (this.def.mode === "patrol") {
      this.walker.x = this.x;
      this.walker.y = this.y;
    }
  }

  hashInto(h: Fnv): void {
    h.fixed(this.x).fixed(this.y).fixed(this.z).fixed(this.vx).fixed(this.vy);
    h.int(this.walker.target).int(this.walker.dirSign);
    h.fixed(this.targetX).fixed(this.targetY).int(this.recoil);
  }

  snapshot(): EntitySnapshot {
    return {
      type: "steelie",
      index: this.index,
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vy: this.vy,
    };
  }
}

/** Move a walker 1 cell directly away from a respawn point if it is too close and ground allows. */
export function pushAway(
  e: { x: number; y: number; z: number },
  sim: SimContext,
  x: number,
  y: number,
): void {
  const dx = e.x - x;
  const dy = e.y - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= SPAWN_CLEAR_RADIUS) return;
  const nx = d > 1e-6 ? dx / d : 1;
  const ny = d > 1e-6 ? dy / d : 0;
  const tx = e.x + nx * SPAWN_CLEAR_RADIUS;
  const ty = e.y + ny * SPAWN_CLEAR_RADIUS;
  const g = sim.terrain.groundAt(tx, ty, sim.tick);
  if (!g || Math.abs(g.z - e.z) > 0.6) return;
  e.x = tx;
  e.y = ty;
  e.z = g.z;
}
