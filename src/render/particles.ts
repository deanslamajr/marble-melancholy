// Render-only particle system. Uses an unseeded RNG (D07): visuals are free-running.
import { Rng } from "../core/rng";

export const ParticleKind = {
  Shard: 0,
  Bubble: 1,
  Sparkle: 2,
  Dust: 3,
  Ring: 4,
} as const;
export type ParticleKind = (typeof ParticleKind)[keyof typeof ParticleKind];

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  color: string;
  rot: number;
  vrot: number;
  gravity: number;
  /** Ground height to bounce off (shards), or -Infinity. */
  floor: number;
}

const MAX_PARTICLES = 600;
const TAU = Math.PI * 2;

export class Particles {
  readonly list: Particle[] = [];
  private readonly pool: Particle[] = [];
  readonly rng = new Rng((Math.random() * 4294967296) >>> 0);

  spawn(kind: ParticleKind, x: number, y: number, z: number): Particle {
    let p = this.pool.pop();
    if (!p) {
      p = {
        kind,
        x,
        y,
        z,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 1,
        size: 1,
        color: "#ffffff",
        rot: 0,
        vrot: 0,
        gravity: 0,
        floor: -Infinity,
      };
    }
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.age = 0;
    p.life = 1;
    p.size = 1;
    p.rot = 0;
    p.vrot = 0;
    p.gravity = 0;
    p.floor = -Infinity;
    if (this.list.length >= MAX_PARTICLES) this.recycle(0);
    this.list.push(p);
    return p;
  }

  /** 12 triangular shards, radial 2–5 u/s, gravity, 0.7 s fade (§7.11). */
  shatter(x: number, y: number, z: number, color: string, floor: number | null): void {
    const r = this.rng;
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * TAU + r.range(-0.25, 0.25);
      const s = r.range(2, 5);
      const p = this.spawn(ParticleKind.Shard, x, y, z + 0.35);
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.vz = r.range(2, 6);
      p.life = 0.7;
      p.size = r.range(3, 6.5);
      p.color = color;
      p.rot = r.range(0, TAU);
      p.vrot = r.range(-14, 14);
      p.gravity = 24;
      p.floor = floor ?? -Infinity;
    }
  }

  bubbles(x: number, y: number, z: number, count: number): void {
    const r = this.rng;
    for (let n = 0; n < count; n++) {
      const p = this.spawn(ParticleKind.Bubble, x + r.range(-0.3, 0.3), y + r.range(-0.3, 0.3), z);
      p.vz = r.range(0.4, 1.0);
      p.vx = r.range(-0.15, 0.15);
      p.vy = r.range(-0.15, 0.15);
      p.life = r.range(0.5, 0.9);
      p.size = r.range(2, 4.5);
      p.color = "#9cf08a";
      p.age = -n * 0.05;
    }
  }

  sparkle(x: number, y: number, z: number, count: number, color: string, speed = 3): void {
    const r = this.rng;
    for (let n = 0; n < count; n++) {
      const a = r.range(0, TAU);
      const s = r.range(0.4, 1) * speed;
      const p = this.spawn(ParticleKind.Sparkle, x, y, z + 0.3);
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.vz = r.range(1, 4);
      p.life = r.range(0.5, 1.0);
      p.size = r.range(2, 4);
      p.color = color;
      p.gravity = 6;
      p.rot = r.range(0, TAU);
      p.vrot = r.range(-6, 6);
    }
  }

  dust(x: number, y: number, z: number, count: number, spread = 1.5, color = "#d8d0c0"): void {
    const r = this.rng;
    for (let n = 0; n < count; n++) {
      const a = r.range(0, TAU);
      const s = r.range(0.3, 1) * spread;
      const p = this.spawn(ParticleKind.Dust, x, y, z + 0.05);
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.vz = r.range(0.2, 0.8);
      p.life = r.range(0.35, 0.6);
      p.size = r.range(3, 6);
      p.color = color;
    }
  }

  ring(x: number, y: number, z: number, color: string, life = 0.4, size = 0.9): void {
    const p = this.spawn(ParticleKind.Ring, x, y, z + 0.02);
    p.life = life;
    p.size = size;
    p.color = color;
  }

  update(dt: number): void {
    const list = this.list;
    for (let n = list.length - 1; n >= 0; n--) {
      const p = list[n]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.recycle(n);
        continue;
      }
      if (p.age < 0) continue;
      p.vz -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.vrot * dt;
      if (p.z < p.floor && p.vz < 0) {
        p.z = p.floor;
        p.vz = -p.vz * 0.35;
        p.vx *= 0.6;
        p.vy *= 0.6;
        p.vrot *= 0.5;
      }
      if (p.kind === ParticleKind.Dust || p.kind === ParticleKind.Bubble) {
        const damp = Math.exp(-3 * dt);
        p.vx *= damp;
        p.vy *= damp;
      }
    }
  }

  private recycle(n: number): void {
    const list = this.list;
    const p = list[n]!;
    const last = list.pop()!;
    if (n < list.length) list[n] = last;
    this.pool.push(p);
  }

  clear(): void {
    while (this.list.length) this.pool.push(this.list.pop()!);
  }
}
