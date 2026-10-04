// Terrain cell drawing (§7.11). All drawing is in zoom-1 projected pixels; callers set the transform.
import { Rng } from "../../core/rng";
import type {
  CompiledFunnel,
  CompiledWave,
  ResolvedTheme,
  UnstampedLevel,
} from "../../level/types";
import { SURFACE, WALL } from "../../level/types";
import { waveEnvelopeOffset } from "../../sim/terrain";
import { cellZ, funnelOffset, inRect } from "../../sim/terrainMath";
import { SIDE_FADE_DEPTH, Z_PX } from "../iso";
import {
  ACID_COLOR,
  ACID_DARK,
  lighten,
  mixHex,
  scaleHex,
  shadeCached,
  withAlpha,
} from "../themes";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const RAIL_HEIGHT = 0.3;
export const RAIL_THICK = 0.12;

/** World-unit circle radius → projected ellipse semi-axes (iso circle). */
export const ISO_RX = 32 * Math.SQRT2;
export const ISO_RY = 16 * Math.SQRT2;

export interface CellEnv {
  W: number;
  H: number;
  heights: number[];
  slopes: number[];
  surfaces: number[];
  walls: number[];
  theme: ResolvedTheme;
  waves: CompiledWave[];
  funnels: CompiledFunnel[];
  /** Per cell: wave indices whose rect contains the cell (null = static). */
  cellWaves: (number[] | null)[];
  /** Per cell: funnel indices whose cone touches the cell. */
  cellFunnels: (number[] | null)[];
  /** Per cell: summed wave amplitude (lower bound for cached neighbour faces). */
  waveAmp: Float32Array;
  /** Per cell: max base corner height (−Infinity for void). */
  topMax: Float32Array;
  /** Per cell: base top colour after surface tint. */
  topColor: string[];
  startCells: Set<number>;
}

export function createCellEnv(level: UnstampedLevel): CellEnv {
  const { width: W, height: H } = level.grid;
  const { heights, slopes, surfaces, walls } = level.cells;
  const waves: CompiledWave[] = [];
  const funnels: CompiledFunnel[] = [];
  for (const e of level.entities) {
    if (e.type === "wave") waves.push(e);
    else if (e.type === "funnel") funnels.push(e);
  }
  const n = W * H;
  const cellWaves: (number[] | null)[] = new Array(n).fill(null);
  const cellFunnels: (number[] | null)[] = new Array(n).fill(null);
  const waveAmp = new Float32Array(n);
  const topMax = new Float32Array(n);
  const topColor: string[] = new Array(n).fill(level.theme.top);
  const theme = level.theme;
  const iceTop = mixHex(theme.top, "#ffffff", 0.25);
  const speedTop = scaleHex(theme.top, 0.9);

  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      const h = heights[i]!;
      if (h < 0) {
        topMax[i] = -Infinity;
        continue;
      }
      const s = slopes[i] ?? 0;
      topMax[i] = Math.max(
        cellZ(h, s, 0, 0),
        cellZ(h, s, 1, 1),
        cellZ(h, s, 1, 0),
        cellZ(h, s, 0, 1),
      );
      const surf = surfaces[i] ?? 0;
      topColor[i] =
        surf === SURFACE.ice
          ? iceTop
          : surf === SURFACE.acid
            ? ACID_COLOR
            : surf >= SURFACE.speedN
              ? speedTop
              : theme.top;
      for (let w = 0; w < waves.length; w++) {
        if (inRect(waves[w]!.rect, cx + 0.5, cy + 0.5)) {
          (cellWaves[i] ??= []).push(w);
          waveAmp[i] = waveAmp[i]! + waves[w]!.amplitude;
        }
      }
      for (let f = 0; f < funnels.length; f++) {
        const fu = funnels[f]!;
        const fx = fu.at[0] + 0.5;
        const fy = fu.at[1] + 0.5;
        const nx = Math.max(cx, Math.min(cx + 1, fx));
        const ny = Math.max(cy, Math.min(cy + 1, fy));
        const d = Math.sqrt((nx - fx) * (nx - fx) + (ny - fy) * (ny - fy));
        if (d < fu.radius) (cellFunnels[i] ??= []).push(f);
      }
    }
  }
  const startCells = new Set<number>();
  for (const c of [level.start.p1, level.start.p2]) {
    if (c[0] >= 0 && c[0] < W && c[1] >= 0 && c[1] < H) startCells.add(c[1] * W + c[0]);
  }
  return {
    W,
    H,
    heights,
    slopes,
    surfaces,
    walls,
    theme,
    waves,
    funnels,
    cellWaves,
    cellFunnels,
    waveAmp,
    topMax,
    topColor,
    startCells,
  };
}

export function isDynamicCell(env: CellEnv, i: number): boolean {
  return env.cellWaves[i] !== null;
}

/**
 * Surface height of cell i at fraction (fx, fy). `live` applies wave offsets at `tick`; when false,
 * wave cells report their lowest possible height (so cached neighbour faces always reach them).
 */
export function sampleZ(
  env: CellEnv,
  i: number,
  cx: number,
  cy: number,
  fx: number,
  fy: number,
  tick: number,
  live: boolean,
): number {
  const h = env.heights[i]!;
  let z = cellZ(h, env.slopes[i] ?? 0, fx, fy);
  const fl = env.cellFunnels[i];
  if (fl) {
    for (let k = 0; k < fl.length; k++) {
      const o = funnelOffset(env.funnels[fl[k]!]!, cx + fx, cy + fy);
      if (o) z += o.dz;
    }
  }
  const wl = env.cellWaves[i];
  if (wl) {
    if (live) {
      for (let k = 0; k < wl.length; k++) {
        z += waveEnvelopeOffset(env.waves[wl[k]!]!, cx + fx, cy + fy, tick)?.dz ?? 0;
      }
    } else {
      z -= env.waveAmp[i]!;
    }
  }
  return z;
}

/** Ground height at a world point (base + funnel + wave), null over void or outside the grid. */
export function groundAt(env: CellEnv, x: number, y: number, tick: number): number | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= env.W || cy >= env.H) return null;
  const i = cy * env.W + cx;
  if (env.heights[i]! < 0) return null;
  return sampleZ(env, i, cx, cy, x - cx, y - cy, tick, true);
}

function subdivisions(env: CellEnv, i: number): number {
  return env.cellWaves[i] ? 2 : env.cellFunnels[i] ? 8 : 1;
}

const LX = -1 / Math.sqrt(6);
const LY = -1 / Math.sqrt(6);
const LZ = 2 / Math.sqrt(6);

/** Top-face brightness factor from the corner heights of a quad of side `size` (§7.11). */
export function topShade(zNW: number, zNE: number, zSE: number, zSW: number, size: number): number {
  const dzdx = (zNE - zNW + (zSE - zSW)) / (2 * size);
  const dzdy = (zSW - zNW + (zSE - zNE)) / (2 * size);
  const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
  const dot = (-dzdx * LX - dzdy * LY + LZ) / len;
  return 0.72 + 0.38 * Math.max(0, dot);
}

const grid = new Float64Array(81);

function px(x: number, y: number): number {
  return (x - y) * 32;
}
function py(x: number, y: number, z: number): number {
  return (x + y) * 16 - z * Z_PX;
}

/**
 * Draws a cell: top face, surface details, north/west rails, south/east faces. Dynamic (`live`)
 * cells also draw their south/east rails; static cells' S/E rails are drawn by the next strip.
 */
export function drawCell(
  ctx: Ctx2D,
  env: CellEnv,
  cx: number,
  cy: number,
  tick: number,
  live: boolean,
): void {
  const i = cy * env.W + cx;
  if (env.heights[i]! < 0) return;
  const n = subdivisions(env, i);
  const step = 1 / n;
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) {
      grid[r * (n + 1) + c] = sampleZ(env, i, cx, cy, c * step, r * step, tick, live);
    }
  }
  drawTop(ctx, env, i, cx, cy, n);
  drawSurfaceDetail(ctx, env, i, cx, cy, tick, live);
  const wb = env.walls[i] ?? 0;
  if (wb & WALL.N) drawRail(ctx, env, cx, cy, 0, tick, live);
  if (wb & WALL.W) drawRail(ctx, env, cx, cy, 3, tick, live);
  drawSouthFace(ctx, env, i, cx, cy, n, tick, live);
  drawEastFace(ctx, env, i, cx, cy, n, tick, live);
  if (live) {
    if (wb & WALL.S) drawRail(ctx, env, cx, cy, 2, tick, live);
    if (wb & WALL.E) drawRail(ctx, env, cx, cy, 1, tick, live);
  }
}

function drawTop(ctx: Ctx2D, env: CellEnv, i: number, cx: number, cy: number, n: number): void {
  const base = env.topColor[i]!;
  const step = 1 / n;
  const fl = env.cellFunnels[i];
  const funnel = fl ? env.funnels[fl[0]!]! : null;
  ctx.lineWidth = 0.75;
  ctx.lineJoin = "round";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const zNW = grid[r * (n + 1) + c]!;
      const zNE = grid[r * (n + 1) + c + 1]!;
      const zSE = grid[(r + 1) * (n + 1) + c + 1]!;
      const zSW = grid[(r + 1) * (n + 1) + c]!;
      let f = topShade(zNW, zNE, zSE, zSW, step);
      if (funnel) {
        const mx = cx + (c + 0.5) * step - (funnel.at[0] + 0.5);
        const my = cy + (r + 0.5) * step - (funnel.at[1] + 0.5);
        const d = Math.sqrt(mx * mx + my * my);
        if (d < funnel.radius) f *= 0.45 + 0.55 * (d / funnel.radius);
      }
      const color = shadeCached(base, f);
      const x0 = cx + c * step;
      const x1 = x0 + step;
      const y0 = cy + r * step;
      const y1 = y0 + step;
      ctx.beginPath();
      ctx.moveTo(px(x0, y0), py(x0, y0, zNW));
      ctx.lineTo(px(x1, y0), py(x1, y0, zNE));
      ctx.lineTo(px(x1, y1), py(x1, y1, zSE));
      ctx.lineTo(px(x0, y1), py(x0, y1, zSW));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  if (fl) drawFunnelRings(ctx, env, i, cx, cy, n, fl);
}

/** Six concentric rings per funnel: horizontal circles on the cone, i.e. exact iso ellipses. */
function drawFunnelRings(
  ctx: Ctx2D,
  env: CellEnv,
  i: number,
  cx: number,
  cy: number,
  n: number,
  fl: number[],
): void {
  const step = 1 / n;
  ctx.save();
  ctx.beginPath();
  for (let c = 0; c <= n; c++) lineOrMove(ctx, c === 0, cx + c * step, cy, grid[c]!);
  for (let r = 1; r <= n; r++)
    lineOrMove(ctx, false, cx + 1, cy + r * step, grid[r * (n + 1) + n]!);
  for (let c = n - 1; c >= 0; c--) {
    lineOrMove(ctx, false, cx + c * step, cy + 1, grid[n * (n + 1) + c]!);
  }
  for (let r = n - 1; r > 0; r--) lineOrMove(ctx, false, cx, cy + r * step, grid[r * (n + 1)]!);
  ctx.closePath();
  ctx.clip();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  for (const fi of fl) {
    const f = env.funnels[fi]!;
    const fx = f.at[0] + 0.5;
    const fy = f.at[1] + 0.5;
    const ci = f.at[1] * env.W + f.at[0];
    const h = env.heights[ci] ?? -1;
    const base = h >= 0 ? cellZ(h, env.slopes[ci] ?? 0, 0.5, 0.5) : env.heights[i]! * 0.5;
    ctx.beginPath();
    for (let k = 1; k <= 6; k++) {
      const r = (f.radius * k) / 6;
      const z = base - f.depth * (1 - r / f.radius);
      const X = px(fx, fy);
      const Y = py(fx, fy, z);
      ctx.moveTo(X + r * ISO_RX, Y);
      ctx.ellipse(X, Y, r * ISO_RX, r * ISO_RY, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function lineOrMove(ctx: Ctx2D, move: boolean, x: number, y: number, z: number): void {
  if (move) ctx.moveTo(px(x, y), py(x, y, z));
  else ctx.lineTo(px(x, y), py(x, y, z));
}

function drawSurfaceDetail(
  ctx: Ctx2D,
  env: CellEnv,
  i: number,
  cx: number,
  cy: number,
  tick: number,
  live: boolean,
): void {
  const surf = env.surfaces[i] ?? 0;
  const z = (fx: number, fy: number) => sampleZ(env, i, cx, cy, fx, fy, tick, live);
  if (surf === SURFACE.ice) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const lines: [number, number, number, number][] = [
      [0.15, 0.45, 0.45, 0.15],
      [0.3, 0.75, 0.75, 0.3],
      [0.55, 0.9, 0.9, 0.55],
    ];
    for (const [ax, ay, bx, by] of lines) {
      ctx.moveTo(px(cx + ax, cy + ay), py(cx + ax, cy + ay, z(ax, ay)));
      ctx.lineTo(px(cx + bx, cy + by), py(cx + bx, cy + by, z(bx, by)));
    }
    ctx.stroke();
  } else if (surf === SURFACE.acid) {
    const rng = new Rng(i * 2654435761);
    ctx.fillStyle = ACID_DARK;
    for (let b = 0; b < 3; b++) {
      const fx = 0.2 + rng.next() * 0.6;
      const fy = 0.2 + rng.next() * 0.6;
      const r = 0.07 + rng.next() * 0.08;
      ctx.beginPath();
      ctx.ellipse(
        px(cx + fx, cy + fy),
        py(cx + fx, cy + fy, z(fx, fy)),
        r * ISO_RX,
        r * ISO_RY,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  if (env.startCells.has(i)) {
    const zc = z(0.5, 0.5);
    ctx.beginPath();
    ctx.ellipse(
      px(cx + 0.5, cy + 0.5),
      py(cx + 0.5, cy + 0.5, zc),
      0.36 * ISO_RX,
      0.36 * ISO_RY,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawSouthFace(
  ctx: Ctx2D,
  env: CellEnv,
  i: number,
  cx: number,
  cy: number,
  n: number,
  tick: number,
  live: boolean,
): void {
  const j = cy + 1 < env.H ? i + env.W : -1;
  const voidN = j < 0 || env.heights[j]! < 0;
  const step = 1 / n;
  const y = cy + 1;
  if (voidN) {
    drawVoidFace(ctx, env.theme.sideLight, n, (s) => {
      const x = cx + s * step;
      return [x, y, grid[n * (n + 1) + s]!];
    });
  } else {
    ctx.fillStyle = env.theme.sideLight;
    ctx.strokeStyle = env.theme.sideLight;
    ctx.lineWidth = 0.75;
    for (let s = 0; s < n; s++) {
      const z0 = grid[n * (n + 1) + s]!;
      const z1 = grid[n * (n + 1) + s + 1]!;
      let b0 = sampleZ(env, j, cx, cy + 1, s * step, 0, tick, live);
      let b1 = sampleZ(env, j, cx, cy + 1, (s + 1) * step, 0, tick, live);
      if (b0 >= z0 - 1e-6 && b1 >= z1 - 1e-6) continue;
      b0 = Math.min(b0, z0);
      b1 = Math.min(b1, z1);
      const x0 = cx + s * step;
      const x1 = x0 + step;
      quad(ctx, x0, y, z0, x1, y, z1, x1, y, b1, x0, y, b0);
    }
  }
  edgeHighlight(ctx, env, n, voidN || hasDrop(env, j, cx, cy + 1, 0, tick, live, n), (s) => [
    cx + s * step,
    y,
    grid[n * (n + 1) + s]!,
  ]);
}

function drawEastFace(
  ctx: Ctx2D,
  env: CellEnv,
  i: number,
  cx: number,
  cy: number,
  n: number,
  tick: number,
  live: boolean,
): void {
  const j = cx + 1 < env.W ? i + 1 : -1;
  const voidN = j < 0 || env.heights[j]! < 0;
  const step = 1 / n;
  const x = cx + 1;
  if (voidN) {
    drawVoidFace(ctx, env.theme.sideDark, n, (s) => [x, cy + s * step, grid[s * (n + 1) + n]!]);
  } else {
    ctx.fillStyle = env.theme.sideDark;
    ctx.strokeStyle = env.theme.sideDark;
    ctx.lineWidth = 0.75;
    for (let s = 0; s < n; s++) {
      const z0 = grid[s * (n + 1) + n]!;
      const z1 = grid[(s + 1) * (n + 1) + n]!;
      let b0 = sampleZ(env, j, cx + 1, cy, 0, s * step, tick, live);
      let b1 = sampleZ(env, j, cx + 1, cy, 0, (s + 1) * step, tick, live);
      if (b0 >= z0 - 1e-6 && b1 >= z1 - 1e-6) continue;
      b0 = Math.min(b0, z0);
      b1 = Math.min(b1, z1);
      const y0 = cy + s * step;
      const y1 = y0 + step;
      quad(ctx, x, y0, z0, x, y1, z1, x, y1, b1, x, y0, b0);
    }
  }
  edgeHighlight(ctx, env, n, voidN || hasDrop(env, j, cx + 1, cy, 3, tick, live, n), (s) => [
    x,
    cy + s * step,
    grid[s * (n + 1) + n]!,
  ]);
}

/** True when neighbour j's near edge sits visibly below this cell's edge. */
function hasDrop(
  env: CellEnv,
  j: number,
  ncx: number,
  ncy: number,
  nearEdge: 0 | 3,
  tick: number,
  live: boolean,
  n: number,
): boolean {
  if (j < 0) return true;
  const mid = n >> 1;
  const step = 1 / n;
  const own = nearEdge === 0 ? grid[n * (n + 1) + mid]! : grid[mid * (n + 1) + n]!;
  const fx = nearEdge === 0 ? mid * step : 0;
  const fy = nearEdge === 0 ? 0 : mid * step;
  return sampleZ(env, j, ncx, ncy, fx, fy, tick, live) < own - 0.05;
}

function drawVoidFace(
  ctx: Ctx2D,
  color: string,
  n: number,
  topAt: (s: number) => [number, number, number],
): void {
  ctx.beginPath();
  for (let s = 0; s <= n; s++) {
    const [x, y, z] = topAt(s);
    if (s === 0) ctx.moveTo(px(x, y), py(x, y, z));
    else ctx.lineTo(px(x, y), py(x, y, z));
  }
  for (let s = n; s >= 0; s--) {
    const [x, y, z] = topAt(s);
    ctx.lineTo(px(x, y), py(x, y, z - SIDE_FADE_DEPTH));
  }
  ctx.closePath();
  // Fade perpendicular to the top edge so neighbouring cells' faces line up seamlessly.
  const [ax, ay, az] = topAt(0);
  const [bx, by, bz] = topAt(n);
  const X0 = px(ax, ay);
  const Y0 = py(ax, ay, az);
  let nx = -(py(bx, by, bz) - Y0);
  let ny = px(bx, by) - X0;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const nl = Math.sqrt(nx * nx + ny * ny) || 1;
  nx /= nl;
  ny /= nl;
  const L = SIDE_FADE_DEPTH * Z_PX * ny;
  const g = ctx.createLinearGradient(X0, Y0, X0 + nx * L, Y0 + ny * L);
  g.addColorStop(0, color);
  g.addColorStop(0.55, withAlpha(color, 0.55));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fill();
}

function edgeHighlight(
  ctx: Ctx2D,
  env: CellEnv,
  n: number,
  visible: boolean,
  topAt: (s: number) => [number, number, number],
): void {
  if (!visible) return;
  ctx.beginPath();
  for (let s = 0; s <= n; s++) {
    const [x, y, z] = topAt(s);
    if (s === 0) ctx.moveTo(px(x, y), py(x, y, z));
    else ctx.lineTo(px(x, y), py(x, y, z));
  }
  ctx.strokeStyle = withAlpha(lighten(env.theme.top, 0.5), 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function quad(
  ctx: Ctx2D,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  x3: number,
  y3: number,
  z3: number,
): void {
  ctx.beginPath();
  ctx.moveTo(px(x0, y0), py(x0, y0, z0));
  ctx.lineTo(px(x1, y1), py(x1, y1, z1));
  ctx.lineTo(px(x2, y2), py(x2, y2, z2));
  ctx.lineTo(px(x3, y3), py(x3, y3, z3));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const railColors = new Map<string, [string, string, string, string]>();

function railPalette(rail: string): [string, string, string, string] {
  let p = railColors.get(rail);
  if (!p) {
    p = [rail, scaleHex(rail, 0.78), scaleHex(rail, 0.62), lighten(rail, 0.6)];
    railColors.set(rail, p);
  }
  return p;
}

/** Rail along `edge` (0 N, 1 E, 2 S, 3 W) of cell (cx, cy): 0.3 tall, 0.12 thick, inside the cell. */
export function drawRail(
  ctx: Ctx2D,
  env: CellEnv,
  cx: number,
  cy: number,
  edge: number,
  tick: number,
  live: boolean,
): void {
  const i = cy * env.W + cx;
  if (env.heights[i]! < 0) return;
  const n = subdivisions(env, i);
  const [topC, frontY, frontX, hiC] = railPalette(env.theme.rail);
  const T = RAIL_THICK;
  const alongX = edge === 0 || edge === 2;
  const outer = edge === 0 || edge === 3 ? 0 : 1;
  const inner = edge === 0 || edge === 3 ? T : 1 - T;
  const front = edge === 0 || edge === 3 ? inner : outer;
  const frontColor = alongX ? frontY : frontX;
  const z = (fx: number, fy: number) => sampleZ(env, i, cx, cy, fx, fy, tick, live);
  const pt = (t: number, across: number): [number, number] => (alongX ? [t, across] : [across, t]);
  const step = 1 / n;
  ctx.lineWidth = 0.75;
  for (let s = 0; s < n; s++) {
    const t0 = s * step;
    const t1 = t0 + step;
    const [fa0, fb0] = pt(t0, front);
    const [fa1, fb1] = pt(t1, front);
    const za0 = z(fa0, fb0);
    const za1 = z(fa1, fb1);
    ctx.fillStyle = frontColor;
    ctx.strokeStyle = frontColor;
    quad(
      ctx,
      cx + fa0,
      cy + fb0,
      za0 + RAIL_HEIGHT,
      cx + fa1,
      cy + fb1,
      za1 + RAIL_HEIGHT,
      cx + fa1,
      cy + fb1,
      za1,
      cx + fa0,
      cy + fb0,
      za0,
    );
    const [oa0, ob0] = pt(t0, outer);
    const [oa1, ob1] = pt(t1, outer);
    const [ia0, ib0] = pt(t0, inner);
    const [ia1, ib1] = pt(t1, inner);
    ctx.fillStyle = topC;
    ctx.strokeStyle = topC;
    quad(
      ctx,
      cx + oa0,
      cy + ob0,
      z(oa0, ob0) + RAIL_HEIGHT,
      cx + oa1,
      cy + ob1,
      z(oa1, ob1) + RAIL_HEIGHT,
      cx + ia1,
      cy + ib1,
      z(ia1, ib1) + RAIL_HEIGHT,
      cx + ia0,
      cy + ib0,
      z(ia0, ib0) + RAIL_HEIGHT,
    );
    ctx.beginPath();
    ctx.moveTo(px(cx + fa0, cy + fb0), py(cx + fa0, cy + fb0, za0 + RAIL_HEIGHT));
    ctx.lineTo(px(cx + fa1, cy + fb1), py(cx + fa1, cy + fb1, za1 + RAIL_HEIGHT));
    ctx.strokeStyle = hiC;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.lineWidth = 0.75;
  }
}

const SPEED_DIRS: Record<number, [number, number]> = {
  [SURFACE.speedN]: [0, -1],
  [SURFACE.speedE]: [1, 0],
  [SURFACE.speedS]: [0, 1],
  [SURFACE.speedW]: [-1, 0],
};

/** Animated speed-strip chevrons (decal pass). */
export function drawSpeedDecal(
  ctx: Ctx2D,
  env: CellEnv,
  cx: number,
  cy: number,
  time: number,
  tick: number,
): void {
  const i = cy * env.W + cx;
  const dir = SPEED_DIRS[env.surfaces[i] ?? 0];
  if (!dir) return;
  const [dx, dy] = dir;
  const qx = -dy;
  const qy = dx;
  const shift = (time * 1.6) % 1;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let c = 0; c < 3; c++) {
    const o = ((c + shift) / 3) * 0.8 - 0.4;
    const fade = 1 - Math.abs(o) / 0.42;
    if (fade <= 0) continue;
    const mx = 0.5 + dx * o;
    const my = 0.5 + dy * o;
    const ax = mx - dx * 0.12 + qx * 0.24;
    const ay = my - dy * 0.12 + qy * 0.24;
    const bx = mx + dx * 0.08;
    const by = my + dy * 0.08;
    const ex = mx - dx * 0.12 - qx * 0.24;
    const ey = my - dy * 0.12 - qy * 0.24;
    ctx.beginPath();
    ctx.moveTo(
      px(cx + ax, cy + ay),
      py(cx + ax, cy + ay, sampleZ(env, i, cx, cy, ax, ay, tick, true)),
    );
    ctx.lineTo(
      px(cx + bx, cy + by),
      py(cx + bx, cy + by, sampleZ(env, i, cx, cy, bx, by, tick, true)),
    );
    ctx.lineTo(
      px(cx + ex, cy + ey),
      py(cx + ex, cy + ey, sampleZ(env, i, cx, cy, ex, ey, tick, true)),
    );
    ctx.strokeStyle = withAlpha(env.theme.accent, 0.85 * fade);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
}

function hash01(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Small rising bubbles on acid cells (decal pass, no particles). */
export function drawAcidDecal(
  ctx: Ctx2D,
  env: CellEnv,
  cx: number,
  cy: number,
  time: number,
  tick: number,
): void {
  const i = cy * env.W + cx;
  ctx.lineWidth = 1;
  for (let b = 0; b < 2; b++) {
    const speed = 0.5 + hash01(i, b + 7) * 0.5;
    const ph = (time * speed + hash01(i, b)) % 1;
    const fx = 0.2 + hash01(i, b + 3) * 0.6;
    const fy = 0.2 + hash01(i, b + 5) * 0.6;
    const z = sampleZ(env, i, cx, cy, fx, fy, tick, true) + ph * 0.25;
    const r = (0.04 + 0.05 * ph) * ISO_RX;
    ctx.beginPath();
    ctx.arc(px(cx + fx, cy + fy), py(cx + fx, cy + fy, z), r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(190,255,170,${(0.8 * (1 - ph)).toFixed(3)})`;
    ctx.stroke();
  }
}
