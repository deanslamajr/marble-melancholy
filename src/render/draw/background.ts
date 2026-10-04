// Per-theme background gradient and drifting shapes (§7.11). Screen space, logical 960×540.
import { Rng } from "../../core/rng";
import type { ResolvedTheme } from "../../level/types";
import { VIEW_H, VIEW_W } from "../iso";
import { withAlpha } from "../themes";

interface Shape {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  depth: number;
  alpha: number;
  seed: number;
}

const MARGIN = 120;
const TAU = Math.PI * 2;

function wrap(v: number, span: number): number {
  return v - Math.floor(v / span) * span;
}

export class Background {
  private theme: ResolvedTheme | null = null;
  private gradient: CanvasGradient | null = null;
  private gradientCtx: CanvasRenderingContext2D | null = null;
  private shapes: Shape[] = [];
  private readonly rng = new Rng((Math.random() * 4294967296) >>> 0);
  private time = 0;

  setTheme(theme: ResolvedTheme): void {
    this.theme = theme;
    this.gradient = null;
    const r = this.rng;
    const count =
      theme.id === "lastledge" ? 40 : theme.id === "descent" ? 26 : theme.id === "skyways" ? 9 : 14;
    this.shapes = [];
    for (let n = 0; n < count; n++) {
      const depth = r.range(0.04, 0.18);
      const s: Shape = {
        x: r.range(0, VIEW_W + MARGIN * 2),
        y: r.range(0, VIEW_H + MARGIN * 2),
        size: r.range(0.5, 1),
        vx: 0,
        vy: 0,
        rot: r.range(0, TAU),
        vrot: r.range(-0.3, 0.3),
        depth,
        alpha: r.range(0.35, 1),
        seed: r.next() * 100,
      };
      switch (theme.id) {
        case "practice":
          s.vx = r.range(-6, 6);
          s.vy = r.range(-4, 4);
          s.size *= 90;
          break;
        case "descent":
          s.vy = r.range(40, 110);
          s.size *= 60;
          break;
        case "clockwork":
          s.size *= 70;
          s.vrot = r.range(-0.4, 0.4);
          break;
        case "skyways":
          s.vx = r.range(6, 16);
          s.size *= 70;
          break;
        case "topsy":
          s.vy = r.range(-18, -6);
          s.size *= 26;
          s.vrot = r.range(-0.8, 0.8);
          break;
        case "lastledge":
          s.vy = r.range(-45, -15);
          s.vx = r.range(-6, 6);
          s.size *= 3;
          break;
      }
      this.shapes.push(s);
    }
  }

  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, dt: number): void {
    const theme = this.theme;
    if (!theme) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      return;
    }
    if (!this.gradient || this.gradientCtx !== ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      g.addColorStop(0, theme.bgTop);
      g.addColorStop(1, theme.bgBottom);
      this.gradient = g;
      this.gradientCtx = ctx;
    }
    ctx.fillStyle = this.gradient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.time += dt;
    const spanX = VIEW_W + MARGIN * 2;
    const spanY = VIEW_H + MARGIN * 2;
    for (const s of this.shapes) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vrot * dt;
      const X = wrap(s.x - camX * s.depth, spanX) - MARGIN;
      const Y = wrap(s.y - camY * s.depth, spanY) - MARGIN;
      this.drawShape(ctx, theme, s, X, Y);
    }
  }

  private drawShape(
    ctx: CanvasRenderingContext2D,
    theme: ResolvedTheme,
    s: Shape,
    X: number,
    Y: number,
  ): void {
    switch (theme.id) {
      case "practice": {
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, s.size);
        g.addColorStop(0, withAlpha("#ffffff", 0.08 * s.alpha));
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(X - s.size, Y - s.size, s.size * 2, s.size * 2);
        return;
      }
      case "descent": {
        ctx.strokeStyle = withAlpha(theme.accent, 0.12 * s.alpha);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(X, Y);
        ctx.lineTo(X, Y + s.size);
        ctx.stroke();
        return;
      }
      case "clockwork": {
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(s.rot);
        ctx.strokeStyle = withAlpha(theme.accent, 0.08 * s.alpha);
        ctx.lineWidth = 3;
        const teeth = 10;
        ctx.beginPath();
        for (let t = 0; t <= teeth * 2; t++) {
          const a = (t / (teeth * 2)) * TAU;
          const r = t % 2 === 0 ? s.size : s.size * 0.82;
          if (t === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, s.size * 0.3, 0, TAU);
        ctx.stroke();
        ctx.restore();
        return;
      }
      case "skyways": {
        ctx.fillStyle = withAlpha("#ffffff", 0.35 * s.alpha);
        const r = s.size * 0.5;
        ctx.beginPath();
        ctx.ellipse(X, Y, r * 1.6, r * 0.6, 0, 0, TAU);
        ctx.ellipse(X - r * 0.6, Y - r * 0.3, r * 0.7, r * 0.55, 0, 0, TAU);
        ctx.ellipse(X + r * 0.5, Y - r * 0.4, r * 0.8, r * 0.65, 0, 0, TAU);
        ctx.fill();
        return;
      }
      case "topsy": {
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(s.rot);
        ctx.fillStyle = withAlpha(theme.accent, 0.1 * s.alpha);
        ctx.beginPath();
        ctx.moveTo(0, -s.size);
        ctx.lineTo(s.size * 0.7, 0);
        ctx.lineTo(0, s.size);
        ctx.lineTo(-s.size * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
      }
      case "lastledge": {
        const flicker = 0.6 + 0.4 * Math.sin(this.time * 9 + s.seed);
        ctx.fillStyle = withAlpha(theme.accent, 0.7 * s.alpha * flicker);
        ctx.beginPath();
        ctx.arc(X, Y, s.size * (0.6 + 0.4 * flicker), 0, TAU);
        ctx.fill();
        return;
      }
    }
  }
}
