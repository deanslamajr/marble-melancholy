// Marble / steelie sphere and drop shadow (§7.11). Coordinates are zoom-1 projected pixels.
import { mixColor, parseHex, rgba } from "../themes";
import type { Ctx2D } from "./cell";

/** Draw radius at zoom 1 (§7.7). */
export const MARBLE_PX = 12.6;

export interface MarbleLook {
  color: string;
  rollPhase: number;
  /** Screen-space roll direction (radians). */
  rollAngle: number;
  alpha: number;
  scale: number;
  /** Vertical squash (1 = round). */
  squash: number;
  /** 0..1 mix toward tintColor. */
  tint: number;
  tintColor: string;
  steelie: boolean;
}

export function defaultLook(color: string): MarbleLook {
  return {
    color,
    rollPhase: 0,
    rollAngle: 0,
    alpha: 1,
    scale: 1,
    squash: 1,
    tint: 0,
    tintColor: "#3fae4a",
    steelie: false,
  };
}

export function drawShadow(
  ctx: Ctx2D,
  gx: number,
  gy: number,
  heightAbove: number,
  alpha = 0.35,
  scale = 1,
): void {
  const f = (1 - Math.min(0.6, Math.max(0, heightAbove) / 3)) * scale;
  ctx.beginPath();
  ctx.ellipse(gx, gy, MARBLE_PX * f, MARBLE_PX * 0.5 * f, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
  ctx.fill();
}

const gradients = new WeakMap<object, Map<string, CanvasGradient>>();

function bodyGradient(ctx: Ctx2D, color: string, steelie: boolean): CanvasGradient {
  let m = gradients.get(ctx);
  if (!m) {
    m = new Map();
    gradients.set(ctx, m);
  }
  const key = color + (steelie ? "s" : "g");
  let g = m.get(key);
  if (!g) {
    const [r, gg, b] = parseHex(color);
    g = ctx.createRadialGradient(-0.35, -0.35, 0, -0.1, -0.1, 1.12);
    if (steelie) {
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.12, "rgba(190,190,200,1)");
      g.addColorStop(0.35, rgba(r * 1.6 + 30, gg * 1.6 + 30, b * 1.6 + 34));
      g.addColorStop(0.8, color);
      g.addColorStop(1, "rgb(4,4,6)");
    } else {
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(
        0.22,
        rgba(r + (255 - r) * 0.35, gg + (255 - gg) * 0.35, b + (255 - b) * 0.35),
      );
      g.addColorStop(0.62, color);
      g.addColorStop(1, rgba(r * 0.35, gg * 0.35, b * 0.35));
    }
    m.set(key, g);
  }
  return g;
}

/** Sphere centred at projected (sx, sy). */
export function drawMarble(ctx: Ctx2D, sx: number, sy: number, look: MarbleLook): void {
  const R = MARBLE_PX * look.scale;
  if (R <= 0.2 || look.alpha <= 0.01) return;
  const color =
    look.tint > 0
      ? mixColor(look.color, look.tintColor, Math.round(look.tint * 8) / 8)
      : look.color;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * look.alpha * (look.steelie ? 1 : 0.92);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(R * (look.squash < 1 ? 1 + (1 - look.squash) * 0.5 : 1), R * look.squash);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fillStyle = bodyGradient(ctx, color, look.steelie);
  ctx.fill();

  if (!look.steelie) {
    ctx.rotate(look.rollAngle);
    const phi = look.rollPhase;
    ctx.lineWidth = 2.2 / R;
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    swirl(ctx, phi);
    swirl(ctx, phi + Math.PI / 2);
    ctx.rotate(-look.rollAngle);
  }

  ctx.beginPath();
  ctx.ellipse(
    -0.38,
    -0.42,
    look.steelie ? 0.12 : 0.2,
    look.steelie ? 0.09 : 0.14,
    -0.6,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = look.steelie ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)";
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = prevAlpha;
}

/** Visible half of a great circle tilted by phi about the vertical axis. */
function swirl(ctx: Ctx2D, phi: number): void {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const rx = Math.abs(s) * 0.82;
  if (rx < 0.02) return;
  const right = s * c >= 0;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    rx,
    0.82,
    0,
    right ? -Math.PI / 2 : Math.PI / 2,
    right ? Math.PI / 2 : Math.PI * 1.5,
  );
  ctx.stroke();
}
