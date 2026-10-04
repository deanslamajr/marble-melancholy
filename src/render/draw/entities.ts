// Entity art (§7.11). Positions are world units; drawing in zoom-1 projected pixels.
import type { ResolvedTheme } from "../../level/types";
import {
  lighten,
  mixColor,
  MUNCHER_DARK,
  MUNCHER_LIGHT,
  scaleHex,
  STEELIE_COLOR,
  withAlpha,
} from "../themes";
import { type Ctx2D, ISO_RX, ISO_RY } from "./cell";
import { defaultLook, drawMarble, drawShadow } from "./marble";

const TAU = Math.PI * 2;

function px(x: number, y: number): number {
  return (x - y) * 32;
}
function py(x: number, y: number, z: number): number {
  return (x + y) * 16 - z * 32;
}

function isoEllipse(ctx: Ctx2D, x: number, y: number, z: number, r: number): void {
  ctx.beginPath();
  ctx.ellipse(px(x, y), py(x, y, z), r * ISO_RX, r * ISO_RY, 0, 0, TAU);
}

function poly(ctx: Ctx2D, pts: readonly number[]): void {
  ctx.beginPath();
  for (let n = 0; n < pts.length; n += 3) {
    const X = px(pts[n]!, pts[n + 1]!);
    const Y = py(pts[n]!, pts[n + 1]!, pts[n + 2]!);
    if (n === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
  ctx.closePath();
}

export interface EntityPalette {
  platformTop: string;
  platformSouth: string;
  platformEast: string;
  platformEdge: string;
  padFill: string;
  arm: string;
  accent: string;
}

export function entityPalette(theme: ResolvedTheme): EntityPalette {
  return {
    platformTop: lighten(theme.sideDark, 0.35),
    platformSouth: theme.sideDark,
    platformEast: scaleHex(theme.sideDark, 0.78),
    platformEdge: withAlpha(lighten(theme.sideDark, 0.7), 0.8),
    padFill: withAlpha(scaleHex(theme.top, 0.55), 0.85),
    arm: mixColor(theme.rail, "#7a5a3a", 0.5),
    accent: theme.accent,
  };
}

const steelieLook = { ...defaultLook(STEELIE_COLOR), steelie: true };

export function drawSteelie(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  groundZ: number | null,
): void {
  if (groundZ !== null) drawShadow(ctx, px(x, y), py(x, y, groundZ), z - groundZ);
  drawMarble(ctx, px(x, y), py(x, y, z + 0.35), steelieLook);
}

export type MuncherState = "idle" | "lunge" | "swallow" | "digest" | "retract";

export function drawMuncher(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  headX: number,
  headY: number,
  state: MuncherState,
  time: number,
): void {
  let stretch = 1 + 0.06 * Math.sin(time * 4);
  if (state === "lunge") stretch = 1.35;
  else if (state === "swallow") stretch = 1.2;
  else if (state === "digest") stretch = 0.78 + 0.08 * Math.sin(time * 12);
  else if (state === "retract") stretch = 0.95;

  isoEllipse(ctx, x, y, z + 0.01, 0.42);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill();

  if (state === "lunge") {
    ctx.lineWidth = 1.5;
    for (let r = 1; r <= 3; r++) {
      const u = r / 3.5;
      const rx = x + (headX - x) * u;
      const ry = y + (headY - y) * u;
      isoEllipse(ctx, rx, ry, z + 0.3 + u * 0.3, 0.2 + 0.12 * r);
      ctx.strokeStyle = `rgba(160,255,160,${(0.45 - r * 0.1).toFixed(2)})`;
      ctx.stroke();
    }
  }

  let tx = x;
  let ty = y;
  let tz = z;
  for (let i = 0; i < 5; i++) {
    const u = i / 4;
    tx = x + (headX - x) * u;
    ty = y + (headY - y) * u;
    tz = z + 0.1 + i * 0.13 * stretch;
    let r = 0.34 - i * 0.025;
    if (state === "digest" && i === 2) r += 0.1;
    isoEllipse(ctx, tx, ty, tz, r);
    ctx.fillStyle = mixColor(MUNCHER_DARK, MUNCHER_LIGHT, u);
    ctx.fill();
    ctx.strokeStyle = "rgba(10,40,10,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const X = px(tx, ty);
  const Y = py(tx, ty, tz);
  const ddx = px(headX, headY) - px(x, y);
  const ddy = py(headX, headY, 0) - py(x, y, 0);
  const dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
  const lookX = state === "lunge" ? (ddx / dl) * 1.5 : 0;
  const lookY = state === "lunge" ? (ddy / dl) * 1.5 : 0.5;
  if (state === "lunge" || state === "swallow") {
    ctx.beginPath();
    ctx.ellipse(X, Y + 3, 6, state === "lunge" ? 4.5 : 3, 0, 0, TAU);
    ctx.fillStyle = "#102010";
    ctx.fill();
  }
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(X + side * 5, Y - 3, 3, 0, TAU);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X + side * 5 + lookX, Y - 3 + lookY, 1.5, 0, TAU);
    ctx.fillStyle = "#000000";
    ctx.fill();
  }
}

export function drawHoover(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  active: boolean,
  pullRadius: number,
  time: number,
): void {
  if (active) {
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    for (let n = 0; n < 3; n++) {
      const u = 1 - ((time * 0.9 + n / 3) % 1);
      isoEllipse(ctx, x, y, z + 0.02, pullRadius * u);
      ctx.strokeStyle = `rgba(220,230,255,${(0.5 * (1 - u) + 0.1).toFixed(3)})`;
      ctx.lineDashOffset = -time * 30;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  const r = 0.4;
  const h = 0.35;
  isoEllipse(ctx, x, y, z + 0.005, r + 0.05);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fill();
  const X = px(x, y);
  const Yb = py(x, y, z);
  const Yt = py(x, y, z + h);
  ctx.beginPath();
  ctx.ellipse(X, Yb, r * ISO_RX, r * ISO_RY, 0, 0, Math.PI);
  ctx.lineTo(X - r * ISO_RX, Yt);
  ctx.ellipse(X, Yt, r * ISO_RX, r * ISO_RY, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = "#6b7078";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(X, Yt, r * ISO_RX, r * ISO_RY, 0, 0, TAU);
  ctx.fillStyle = "#9aa0a8";
  ctx.fill();
  const nb = 0.18;
  const nt = 0.08;
  const Yn = py(x, y, z + h + 0.28);
  ctx.beginPath();
  ctx.moveTo(X - nb * ISO_RX, Yt);
  ctx.lineTo(X - nt * ISO_RX, Yn);
  ctx.lineTo(X + nt * ISO_RX, Yn);
  ctx.lineTo(X + nb * ISO_RX, Yt);
  ctx.closePath();
  ctx.fillStyle = "#585d66";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(X, Yn, nt * ISO_RX, nt * ISO_RY, 0, 0, TAU);
  ctx.fillStyle = "#111114";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X + r * ISO_RX * 0.55, (Yb + Yt) / 2 + 2, 2.2, 0, TAU);
  ctx.fillStyle = active ? (Math.sin(time * 10) > 0 ? "#ff5040" : "#802820") : "#303030";
  ctx.fill();
}

export function drawHammer(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  headHeight: number,
  accent: string,
): void {
  const down = 1 - Math.max(0, Math.min(1, headHeight / 2));
  const s = 0.55 + 0.45 * down;
  poly(ctx, [
    x - 0.5 * s,
    y - 0.5 * s,
    z,
    x + 0.5 * s,
    y - 0.5 * s,
    z,
    x + 0.5 * s,
    y + 0.5 * s,
    z,
    x - 0.5 * s,
    y + 0.5 * s,
    z,
  ]);
  ctx.fillStyle = `rgba(0,0,0,${(0.12 + 0.3 * down).toFixed(3)})`;
  ctx.fill();

  const zb = z + headHeight;
  const zt = zb + 0.6;
  const x0 = x - 0.5;
  const x1 = x + 0.5;
  const y0 = y - 0.5;
  const y1 = y + 0.5;
  ctx.lineWidth = 0.75;
  poly(ctx, [x0, y1, zt, x1, y1, zt, x1, y1, zb, x0, y1, zb]);
  ctx.fillStyle = "#646a74";
  ctx.fill();
  poly(ctx, [x1, y0, zt, x1, y1, zt, x1, y1, zb, x1, y0, zb]);
  ctx.fillStyle = "#4b5058";
  ctx.fill();
  poly(ctx, [x0, y0, zt, x1, y0, zt, x1, y1, zt, x0, y1, zt]);
  ctx.fillStyle = "#8a8f99";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px(x0, y1), py(x0, y1, zb + 0.08));
  ctx.lineTo(px(x1, y1), py(x1, y1, zb + 0.08));
  ctx.lineTo(px(x1, y0), py(x1, y0, zb + 0.08));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();

  const X = px(x, y);
  const Ytop = py(x, y, zt);
  const Yshaft = py(x, y, zt + 2.2);
  ctx.fillStyle = "#3d3f46";
  ctx.fillRect(X - 3.5, Yshaft, 7, Ytop - Yshaft);
  ctx.fillStyle = "#5a5d66";
  ctx.fillRect(X - 3.5, Yshaft, 2.5, Ytop - Yshaft);
}

export function drawCatapult(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  compress: number,
  pal: EntityPalette,
): void {
  const i = 0.42;
  poly(ctx, [
    x - i,
    y - i,
    z + 0.01,
    x + i,
    y - i,
    z + 0.01,
    x + i,
    y + i,
    z + 0.01,
    x - i,
    y + i,
    z + 0.01,
  ]);
  ctx.fillStyle = pal.padFill;
  ctx.fill();
  ctx.strokeStyle = withAlpha(pal.accent, 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const hz = 0.55 * (1 - 0.7 * Math.max(0, Math.min(1, compress)));
  const bases: [number, number, number, number][] = [
    [x - 0.32, y + 0.12, 0.12, -0.12],
    [x + 0.12, y - 0.32, -0.12, 0.12],
  ];
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = pal.arm;
  const tips: number[] = [];
  for (const [bx, by, dx, dy] of bases) {
    const tx = bx + dx * 0.8 + (x - bx) * 0.35;
    const ty = by + dy * 0.8 + (y - by) * 0.35;
    ctx.beginPath();
    ctx.moveTo(px(bx, by), py(bx, by, z));
    ctx.quadraticCurveTo(
      px(bx - dx * 0.6, by - dy * 0.6),
      py(bx - dx * 0.6, by - dy * 0.6, z + hz),
      px(tx, ty),
      py(tx, ty, z + hz * 0.9),
    );
    ctx.stroke();
    tips.push(px(tx, ty), py(tx, ty, z + hz * 0.9));
  }
  ctx.beginPath();
  ctx.moveTo(tips[0]!, tips[1]!);
  ctx.lineTo(tips[2]!, tips[3]!);
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** One unit cell of a moving platform slab; faces only on the slab's outer south/east sides. */
export function drawPlatformPiece(
  ctx: Ctx2D,
  x0: number,
  y0: number,
  topZ: number,
  southEdge: boolean,
  eastEdge: boolean,
  pal: EntityPalette,
): void {
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const zb = topZ - 0.5;
  ctx.lineWidth = 0.75;
  if (southEdge) {
    poly(ctx, [x0, y1, topZ, x1, y1, topZ, x1, y1, zb, x0, y1, zb]);
    ctx.fillStyle = pal.platformSouth;
    ctx.strokeStyle = pal.platformSouth;
    ctx.fill();
    ctx.stroke();
  }
  if (eastEdge) {
    poly(ctx, [x1, y0, topZ, x1, y1, topZ, x1, y1, zb, x1, y0, zb]);
    ctx.fillStyle = pal.platformEast;
    ctx.strokeStyle = pal.platformEast;
    ctx.fill();
    ctx.stroke();
  }
  poly(ctx, [x0, y0, topZ, x1, y0, topZ, x1, y1, topZ, x0, y1, topZ]);
  ctx.fillStyle = pal.platformTop;
  ctx.strokeStyle = pal.platformTop;
  ctx.fill();
  ctx.stroke();
  if (southEdge || eastEdge) {
    ctx.beginPath();
    if (southEdge) {
      ctx.moveTo(px(x0, y1), py(x0, y1, topZ));
      ctx.lineTo(px(x1, y1), py(x1, y1, topZ));
    }
    if (eastEdge) {
      ctx.moveTo(px(x1, y1), py(x1, y1, topZ));
      ctx.lineTo(px(x1, y0), py(x1, y0, topZ));
    }
    ctx.strokeStyle = pal.platformEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function drawPipeEntry(ctx: Ctx2D, x: number, y: number, z: number): void {
  isoEllipse(ctx, x, y, z + 0.01, 0.4);
  ctx.fillStyle = "#c8ccd4";
  ctx.fill();
  isoEllipse(ctx, x, y, z + 0.01, 0.31);
  ctx.fillStyle = "#0c0c10";
  ctx.fill();
  isoEllipse(ctx, x, y, z + 0.01, 0.36);
  ctx.strokeStyle = "#7d828c";
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function drawPipeExit(ctx: Ctx2D, x: number, y: number, z: number): void {
  const r = 0.38;
  const h = 0.2;
  const X = px(x, y);
  const Yb = py(x, y, z);
  const Yt = py(x, y, z + h);
  ctx.beginPath();
  ctx.ellipse(X, Yb, r * ISO_RX, r * ISO_RY, 0, 0, Math.PI);
  ctx.lineTo(X - r * ISO_RX, Yt);
  ctx.ellipse(X, Yt, r * ISO_RX, r * ISO_RY, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = "#7d828c";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(X, Yt, r * ISO_RX, r * ISO_RY, 0, 0, TAU);
  ctx.fillStyle = "#d8dce4";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(X, Yt, (r - 0.08) * ISO_RX, (r - 0.08) * ISO_RY, 0, 0, TAU);
  ctx.fillStyle = "#18181c";
  ctx.fill();
}

/** Dashed translucent tube between pipe mouths (background pass, behind terrain). */
export function drawPipeTube(
  ctx: Ctx2D,
  ex: number,
  ey: number,
  ez: number,
  xx: number,
  xy: number,
  xz: number,
  time: number,
): void {
  const X0 = px(ex, ey);
  const Y0 = py(ex, ey, ez);
  const X1 = px(xx, xy);
  const Y1 = py(xx, xy, xz);
  const d = Math.sqrt((X1 - X0) * (X1 - X0) + (Y1 - Y0) * (Y1 - Y0));
  const cX = (X0 + X1) / 2;
  const cY = Math.min(Y0, Y1) - 60 - d * 0.15;
  ctx.beginPath();
  ctx.moveTo(X0, Y0);
  ctx.quadraticCurveTo(cX, cY, X1, Y1);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.setLineDash([10, 9]);
  ctx.lineDashOffset = -time * 40;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.lineCap = "butt";
}

export function drawFunnelHole(ctx: Ctx2D, x: number, y: number, z: number, time: number): void {
  isoEllipse(ctx, x, y, z + 0.01, 0.3);
  ctx.fillStyle = "#000000";
  ctx.fill();
  const a = time * 4;
  ctx.beginPath();
  ctx.ellipse(px(x, y), py(x, y, z + 0.01), 0.3 * ISO_RX, 0.3 * ISO_RY, 0, a, a + 1.4);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function drawCheckpoint(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  color: string,
  time: number,
): void {
  isoEllipse(ctx, x, y, z + 0.01, 0.12);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  const X = px(x, y);
  const Yb = py(x, y, z);
  const Yt = py(x, y, z + 1.15);
  ctx.strokeStyle = "#e6e6e6";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X, Yb);
  ctx.lineTo(X, Yt);
  ctx.stroke();
  const wave = Math.sin(time * 6) * 2;
  ctx.beginPath();
  ctx.moveTo(X + 1, Yt);
  ctx.lineTo(X + 17, Yt + 5 + wave);
  ctx.lineTo(X + 1, Yt + 11);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

const GOAL_SEGMENTS = 16;

/** Rotating goal ring (0.5 rev/s) lying on the plane z. */
export function drawGoalRing(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  radius: number,
  time: number,
  accent: string,
): void {
  isoEllipse(ctx, x, y, z + 0.01, radius);
  ctx.fillStyle = withAlpha(accent, 0.12 + 0.05 * Math.sin(time * 4));
  ctx.fill();
  const rot = time * Math.PI;
  ctx.lineWidth = 5;
  ctx.lineCap = "butt";
  for (let s = 0; s < GOAL_SEGMENTS; s++) {
    const a0 = rot + (s / GOAL_SEGMENTS) * TAU;
    const a1 = a0 + TAU / GOAL_SEGMENTS;
    ctx.beginPath();
    for (let q = 0; q <= 3; q++) {
      const a = a0 + ((a1 - a0) * q) / 3;
      const wx = x + Math.cos(a) * radius;
      const wy = y + Math.sin(a) * radius;
      if (q === 0) ctx.moveTo(px(wx, wy), py(wx, wy, z + 0.02));
      else ctx.lineTo(px(wx, wy), py(wx, wy, z + 0.02));
    }
    ctx.strokeStyle = s % 2 === 0 ? "#f4f4f4" : "#1c1c22";
    ctx.stroke();
  }
}

export function drawGoalFlag(
  ctx: Ctx2D,
  x: number,
  y: number,
  z: number,
  time: number,
  accent: string,
): void {
  const X = px(x, y);
  const Yb = py(x, y, z);
  const Yt = py(x, y, z + 1.0);
  ctx.strokeStyle = "#f0f0f0";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(X, Yb);
  ctx.lineTo(X, Yt);
  ctx.stroke();
  const w = Math.sin(time * 5) * 2.5;
  ctx.beginPath();
  ctx.moveTo(X + 1, Yt);
  ctx.quadraticCurveTo(X + 10, Yt - 2 + w, X + 20, Yt + 1 + w);
  ctx.lineTo(X + 20, Yt + 12 + w);
  ctx.quadraticCurveTo(X + 10, Yt + 9 + w, X + 1, Yt + 12);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
}
