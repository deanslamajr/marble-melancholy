// Death animations, respawn/goal flashes and particle drawing (§7.11).
import type { DeathCause } from "../../sim/types";
import { type Particle, ParticleKind } from "../particles";
import { withAlpha } from "../themes";
import { type Ctx2D, ISO_RX, ISO_RY } from "./cell";

export interface MarblePose {
  visible: boolean;
  x: number;
  y: number;
  z: number;
  scale: number;
  squash: number;
  tint: number;
  alpha: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Pose of a dying marble `t` seconds into its death animation. `target` is the muncher mouth or
 * hoover nozzle when relevant. Mutates and returns `out`.
 */
export function dyingPose(
  out: MarblePose,
  cause: DeathCause | null,
  t: number,
  base: Point3,
  target: Point3 | null,
): MarblePose {
  out.x = base.x;
  out.y = base.y;
  out.z = base.z;
  out.scale = 1;
  out.squash = 1;
  out.tint = 0;
  out.alpha = 1;
  out.visible = false;
  switch (cause) {
    case "acid": {
      const u = t / 0.6;
      if (u >= 1) return out;
      out.visible = true;
      out.scale = 1 - u;
      out.tint = Math.min(1, t / 0.15);
      out.z = base.z - 0.15 * u;
      return out;
    }
    case "munch": {
      const u = t / 0.3;
      if (u >= 1 || !target) return out;
      out.visible = true;
      const e = u * u * (3 - 2 * u);
      out.x = base.x + (target.x - base.x) * e;
      out.y = base.y + (target.y - base.y) * e;
      out.z = base.z + (target.z - base.z) * e;
      out.scale = 1 - 0.6 * u;
      return out;
    }
    case "hammer": {
      if (t >= 0.5) return out;
      out.visible = true;
      const u = Math.min(1, t / 0.08);
      out.squash = 1 - 0.8 * u;
      out.z = base.z - 0.25 * u;
      if (t > 0.3) out.alpha = 1 - (t - 0.3) / 0.2;
      return out;
    }
    case "hoover": {
      const u = t / 0.5;
      if (u >= 1 || !target) return out;
      out.visible = true;
      const dx = base.x - target.x;
      const dy = base.y - target.y;
      const a = u * u * 9;
      const k = 1 - u;
      const c = Math.cos(a);
      const s = Math.sin(a);
      out.x = target.x + (dx * c - dy * s) * k;
      out.y = target.y + (dx * s + dy * c) * k;
      out.z = base.z + (target.z - base.z) * u;
      out.scale = 1 - 0.85 * u;
      return out;
    }
    default:
      return out;
  }
}

function px(x: number, y: number): number {
  return (x - y) * 32;
}
function py(x: number, y: number, z: number): number {
  return (x + y) * 16 - z * 32;
}

export function drawParticle(ctx: Ctx2D, p: Particle): void {
  if (p.age < 0) return;
  const t = p.age / p.life;
  const fade = 1 - t;
  const X = px(p.x, p.y);
  const Y = py(p.x, p.y, p.z);
  switch (p.kind) {
    case ParticleKind.Shard: {
      const s = p.size;
      const c = Math.cos(p.rot);
      const n = Math.sin(p.rot);
      ctx.beginPath();
      ctx.moveTo(X + c * s, Y + n * s);
      ctx.lineTo(X - c * s * 0.6 - n * s * 0.5, Y - n * s * 0.6 + c * s * 0.5);
      ctx.lineTo(X - c * s * 0.4 + n * s * 0.7, Y - n * s * 0.4 - c * s * 0.7);
      ctx.closePath();
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case ParticleKind.Bubble: {
      ctx.beginPath();
      ctx.arc(X, Y, p.size * (0.6 + 0.4 * t), 0, Math.PI * 2);
      ctx.globalAlpha = fade;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case ParticleKind.Sparkle: {
      const s = p.size * (1 - 0.5 * t);
      const c = Math.cos(p.rot) * s;
      const n = Math.sin(p.rot) * s;
      ctx.globalAlpha = fade;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X - c, Y - n);
      ctx.lineTo(X + c, Y + n);
      ctx.moveTo(X + n, Y - c);
      ctx.lineTo(X - n, Y + c);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case ParticleKind.Dust: {
      ctx.beginPath();
      ctx.arc(X, Y, p.size * (0.6 + t), 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(p.color, 0.45 * fade);
      ctx.fill();
      return;
    }
    case ParticleKind.Ring: {
      const r = p.size * (0.25 + 0.75 * t);
      ctx.beginPath();
      ctx.ellipse(X, Y, r * ISO_RX, r * ISO_RY, 0, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(p.color, 0.9 * fade);
      ctx.lineWidth = 3 * fade + 0.5;
      ctx.stroke();
      return;
    }
  }
}
