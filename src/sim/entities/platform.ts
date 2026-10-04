import { mod } from "../../core/dmath";
import type { Fnv } from "../../core/hash";
import type { CompiledPlatform } from "../../level/types";
import type { Segment } from "../collision";
import { DT, MARBLE_RADIUS, PLATFORM_THICKNESS, WALL_STEP_THRESHOLD } from "../constants";
import type { Ground } from "../terrain";
import type { EntitySnapshot } from "../types";
import type { SimContext, SimEntity } from "./base";

interface Leg {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  travel: number;
}

/** Moving slab following its path ping-pong with pauses (§7.10). Position is a pure function of tick. */
export class PlatformEntity implements SimEntity {
  readonly type = "platform" as const;
  readonly index: number;
  readonly w: number;
  readonly h: number;
  readonly topZ: number;
  readonly cycle: number;
  private legs: Leg[] = [];
  x: number;
  y: number;
  vx = 0;
  vy = 0;

  constructor(readonly def: CompiledPlatform) {
    this.index = def.index;
    this.w = def.size[0];
    this.h = def.size[1];
    this.topZ = def.top * 0.5;
    const pts = def.path;
    const order: number[] = [];
    for (let i = 0; i < pts.length; i++) order.push(i);
    for (let i = pts.length - 2; i >= 1; i--) order.push(i);
    let cycle = 0;
    if (pts.length >= 2) {
      for (let k = 0; k < order.length; k++) {
        const a = pts[order[k]!]!;
        const b = pts[order[(k + 1) % order.length]!]!;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const travel = Math.sqrt(dx * dx + dy * dy) / def.speed;
        this.legs.push({ fx: a[0], fy: a[1], tx: b[0], ty: b[1], travel });
        cycle += def.pause + travel;
      }
    }
    this.cycle = cycle;
    this.x = pts[0]![0];
    this.y = pts[0]![1];
    this.positionAt(0);
  }

  positionAt(tick: number): void {
    if (this.legs.length === 0 || this.cycle <= 0) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    let tau = mod(tick * DT + this.def.phase * this.cycle, this.cycle);
    for (const leg of this.legs) {
      if (tau < this.def.pause) {
        this.x = leg.fx;
        this.y = leg.fy;
        this.vx = 0;
        this.vy = 0;
        return;
      }
      tau -= this.def.pause;
      if (tau < leg.travel) {
        const u = tau / leg.travel;
        this.x = leg.fx + (leg.tx - leg.fx) * u;
        this.y = leg.fy + (leg.ty - leg.fy) * u;
        this.vx = (leg.tx - leg.fx) / leg.travel;
        this.vy = (leg.ty - leg.fy) / leg.travel;
        return;
      }
      tau -= leg.travel;
    }
    const last = this.legs[this.legs.length - 1]!;
    this.x = last.tx;
    this.y = last.ty;
    this.vx = 0;
    this.vy = 0;
  }

  update(sim: SimContext): void {
    this.positionAt(sim.tick);
  }

  interact(): void {}

  contains(x: number, y: number): boolean {
    return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
  }

  groundPatch(x: number, y: number, baseZ: number | null): Ground | null {
    if (!this.contains(x, y)) return null;
    if (baseZ !== null && baseZ > this.topZ) return null;
    return {
      z: this.topZ,
      surface: "normal",
      surfaceCode: 0,
      cx: Math.floor(x),
      cy: Math.floor(y),
      carrier: this,
      gradX: 0,
      gradY: 0,
    };
  }

  wallSegments(_x: number, _y: number, z: number, out: Segment[]): void {
    if (z >= this.topZ - WALL_STEP_THRESHOLD) return;
    if (z + 2 * MARBLE_RADIUS < this.topZ - PLATFORM_THICKNESS) return;
    const x0 = this.x;
    const y0 = this.y;
    const x1 = x0 + this.w;
    const y1 = y0 + this.h;
    out.push({ ax: x0, ay: y0, bx: x1, by: y0 });
    out.push({ ax: x1, ay: y0, bx: x1, by: y1 });
    out.push({ ax: x1, ay: y1, bx: x0, by: y1 });
    out.push({ ax: x0, ay: y1, bx: x0, by: y0 });
  }

  hashInto(h: Fnv): void {
    h.fixed(this.x).fixed(this.y);
  }

  snapshot(): EntitySnapshot {
    return {
      type: "platform",
      index: this.index,
      x: this.x,
      y: this.y,
      w: this.w,
      h: this.h,
      topZ: this.topZ,
      vx: this.vx,
      vy: this.vy,
    };
  }
}
