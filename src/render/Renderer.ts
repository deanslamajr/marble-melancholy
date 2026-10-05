// Frame composition: background, cached terrain strips with depth-inserted dynamic objects (§7.11).
import type { UnstampedLevel } from "../level/types";
import { DEATH_ANIM_TICKS, MARBLE_RADIUS, TICK_HZ } from "../sim/constants";
import type {
  EntitySnapshot,
  MarbleStatus,
  PlayerSnapshot,
  SimEvent,
  SimSnapshot,
} from "../sim/types";
import type { Camera } from "./camera";
import { Background } from "./draw/background";
import { type CellEnv, createCellEnv, drawAcidDecal, drawSpeedDecal, groundAt } from "./draw/cell";
import { dyingPose, drawParticle, type MarblePose, type Point3 } from "./draw/effects";
import {
  drawCatapult,
  drawCheckpoint,
  drawFunnelHole,
  drawGoalFlag,
  drawGoalRing,
  drawHammer,
  drawHoover,
  drawMuncher,
  drawPipeEntry,
  drawPipeExit,
  drawPipeTube,
  drawPlatformPiece,
  drawSteelie,
  type EntityPalette,
  entityPalette,
  type MuncherState,
} from "./draw/entities";
import { defaultLook, drawMarble, drawShadow, type MarbleLook } from "./draw/marble";
import { sphereAnchor } from "./depth";
import { VIEW_H, VIEW_W } from "./iso";
import { Particles } from "./particles";
import { TerrainStrips, type ViewRect } from "./terrainStrips";
import { NEUTRAL_FLAG, playerColor } from "./themes";

export interface RendererOptions {
  debug?: boolean;
  /** Set false to draw terrain directly every frame (offscreen-canvas fallback, §7.11). */
  cache?: boolean;
}

const K_PLAYER = 0;
const K_ENTITY = 1;
const K_PLATFORM = 2;
const K_PARTICLE = 3;
const K_GOAL_BAND = 4;
const K_GOAL_FLAG = 5;
const K_CHECKPOINT = 6;
const K_FUNNEL_HOLE = 7;
const K_PIPE_EXIT = 8;

interface Drawable {
  k: number;
  z: number;
  y: number;
  kind: number;
  a: number;
  b: number;
  c: number;
}

interface PlayerFx {
  hasDeath: boolean;
  deathX: number;
  deathY: number;
  deathZ: number;
  elimTime: number;
  respawnTime: number;
  rollAngle: number;
  lastStatus: MarbleStatus | null;
  x: number;
  y: number;
  z: number;
  groundZ: number | null;
  rollPhase: number;
  statusTicks: number;
}

function newPlayerFx(): PlayerFx {
  return {
    hasDeath: false,
    deathX: 0,
    deathY: 0,
    deathZ: 0,
    elimTime: -1,
    respawnTime: -Infinity,
    rollAngle: 0,
    lastStatus: null,
    x: 0,
    y: 0,
    z: 0,
    groundZ: null,
    rollPhase: 0,
    statusTicks: 0,
  };
}

function byDepth(a: Drawable, b: Drawable): number {
  return a.k - b.k || a.z - b.z || a.y - b.y;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function px(x: number, y: number): number {
  return (x - y) * 32;
}
function py(x: number, y: number, z: number): number {
  return (x + y) * 16 - z * 32;
}

const ELIMINATED_FADE_S = 0.5;
const RESPAWN_FLASH_S = 0.3;
const TELEPORT_DIST2 = 4;

export class Renderer {
  readonly stats = { frameMs: 0, fps: 0 };

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly debug: boolean;
  private readonly cacheEnabled: boolean;
  private dpr = 1;
  private level: UnstampedLevel | null = null;
  private env: CellEnv | null = null;
  private strips: TerrainStrips | null = null;
  private palette: EntityPalette | null = null;
  private readonly background = new Background();
  private readonly particles = new Particles();
  private time = 0;
  private pathOverlay: Array<[number, number]> | null = null;
  private staticSnap: SimSnapshot | null = null;

  private readonly pool: Drawable[] = [];
  private readonly list: Drawable[] = [];
  private poolUsed = 0;
  private readonly fx: PlayerFx[] = [newPlayerFx(), newPlayerFx()];
  private readonly pose: MarblePose = {
    visible: true,
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    squash: 1,
    tint: 0,
    alpha: 1,
  };
  private readonly look: MarbleLook = defaultLook("#ffffff");
  private readonly view: ViewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private entX = new Float64Array(16);
  private entY = new Float64Array(16);
  private entZ = new Float64Array(16);
  private entA = new Float64Array(16);
  private entB = new Float64Array(16);
  private cur: SimSnapshot | null = null;
  private tick = 0;

  constructor(canvas: HTMLCanvasElement, opts?: RendererOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.debug = opts?.debug ?? false;
    this.cacheEnabled = opts?.cache ?? true;
    this.resize();
  }

  setLevel(level: UnstampedLevel): void {
    this.strips?.clear();
    this.level = level;
    this.env = createCellEnv(level);
    this.strips = new TerrainStrips(this.env, this.cacheEnabled);
    this.palette = entityPalette(level.theme);
    this.background.setTheme(level.theme);
    this.particles.clear();
    this.staticSnap = this.buildStaticSnapshot(level, this.env);
    for (let p = 0; p < this.fx.length; p++) this.fx[p] = newPlayerFx();
  }

  resize(): void {
    const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const dpr = Math.min(ratio, 2);
    const w = Math.round(VIEW_W * dpr);
    const h = Math.round(VIEW_H * dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.strips?.clear();
    }
  }

  setPathOverlay(points: Array<[number, number]> | null): void {
    this.pathOverlay = points;
  }

  handleEvents(events: readonly SimEvent[], snap: SimSnapshot): void {
    const env = this.env;
    const level = this.level;
    if (!env || !level) return;
    const parts = this.particles;
    for (const ev of events) {
      switch (ev.t) {
        case "death": {
          const f = this.fx[ev.player];
          if (f) {
            f.hasDeath = true;
            f.deathX = ev.x;
            f.deathY = ev.y;
            f.deathZ = ev.z;
          }
          const color = playerColor(ev.player);
          if (ev.cause === "shatter" || ev.cause === "left-behind") {
            parts.shatter(ev.x, ev.y, ev.z, color, groundAt(env, ev.x, ev.y, snap.tick) ?? ev.z);
          } else if (ev.cause === "fall") {
            parts.shatter(ev.x, ev.y, ev.z, color, null);
          } else if (ev.cause === "acid") {
            parts.bubbles(ev.x, ev.y, ev.z, 8);
          } else if (ev.cause === "hammer") {
            parts.dust(ev.x, ev.y, ev.z, 10, 2);
          } else if (ev.cause === "hoover") {
            parts.dust(ev.x, ev.y, ev.z, 6, 0.8, "#c8d0e0");
          }
          break;
        }
        case "respawn": {
          const p = findPlayer(snap, ev.player);
          const f = this.fx[ev.player];
          if (f) {
            f.respawnTime = this.time;
            f.hasDeath = false;
          }
          if (p) {
            const gz = p.groundZ ?? groundAt(env, p.x, p.y, snap.tick) ?? p.z;
            parts.ring(p.x, p.y, gz, "#ffffff", 0.45, 1.0);
            parts.ring(p.x, p.y, gz, playerColor(ev.player), 0.3, 0.6);
          }
          break;
        }
        case "goal": {
          const gx = level.goal.at[0] + 0.5;
          const gy = level.goal.at[1] + 0.5;
          const gz = groundAt(env, gx, gy, snap.tick) ?? 0;
          parts.sparkle(gx, gy, gz, 22, level.theme.accent, 3.5);
          parts.sparkle(gx, gy, gz, 12, "#ffffff", 2.5);
          parts.ring(gx, gy, gz, level.theme.accent, 0.6, 1.6);
          break;
        }
        case "checkpoint": {
          const cp = level.checkpoints[ev.index];
          if (cp) {
            const cx = cp.at[0] + 0.5;
            const cy = cp.at[1] + 0.5;
            parts.sparkle(
              cx,
              cy,
              (groundAt(env, cx, cy, snap.tick) ?? 0) + 0.8,
              10,
              playerColor(ev.player),
              2,
            );
          }
          break;
        }
        case "catapult":
        case "pipeExit": {
          const p = findPlayer(snap, ev.player);
          if (p) parts.dust(p.x, p.y, p.groundZ ?? p.z, ev.t === "catapult" ? 10 : 5, 1.6);
          break;
        }
        case "land": {
          if (ev.impact > 5) {
            const p = findPlayer(snap, ev.player);
            if (p) parts.dust(p.x, p.y, p.z, 4, 1);
          }
          break;
        }
        case "steelieRam": {
          const p = findPlayer(snap, ev.player);
          if (p) parts.sparkle(p.x, p.y, p.z, 5, "#ffffff", 2);
          break;
        }
        case "hammerDown": {
          const e = findEntity(snap, ev.entity);
          if (e && e.type === "hammer") parts.dust(e.x, e.y, e.z, 14, 2.2);
          break;
        }
        default:
          break;
      }
    }
  }

  draw(prev: SimSnapshot, cur: SimSnapshot, alpha: number, camera: Camera, dt: number): void {
    const t0 = now();
    this.advance(dt);
    this.renderFrame(prev, cur, alpha, camera, dt);
    this.recordFrameTime(t0);
  }

  drawStatic(camera: Camera, dt: number): void {
    const t0 = now();
    this.advance(dt);
    const snap = this.staticSnap;
    if (snap) {
      snap.tick = Math.floor(this.time * TICK_HZ);
      this.renderFrame(snap, snap, 1, camera, dt);
    } else {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.background.draw(this.ctx, camera.cx, camera.cy, dt);
    }
    this.recordFrameTime(t0);
  }

  dispose(): void {
    this.strips?.clear();
    this.strips = null;
    this.env = null;
    this.level = null;
    this.particles.clear();
    this.list.length = 0;
    this.pool.length = 0;
  }

  // ---------- frame ----------

  private advance(dt: number): void {
    const d = Math.max(0, Math.min(dt, 0.25));
    this.time += d;
    this.particles.update(d);
    if (d > 0) {
      const fps = 1 / d;
      this.stats.fps = this.stats.fps === 0 ? fps : this.stats.fps * 0.9 + fps * 0.1;
    }
  }

  private recordFrameTime(t0: number): void {
    const ms = now() - t0;
    this.stats.frameMs = this.stats.frameMs === 0 ? ms : this.stats.frameMs * 0.9 + ms * 0.1;
  }

  private renderFrame(
    prev: SimSnapshot,
    cur: SimSnapshot,
    alpha: number,
    cam: Camera,
    dt: number,
  ): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    this.background.draw(ctx, cam.cx * cam.zoom, cam.cy * cam.zoom, dt);
    const env = this.env;
    const strips = this.strips;
    const level = this.level;
    if (!env || !strips || !level) return;

    const zoom = cam.zoom;
    const s = dpr * zoom;
    const tx = Math.round(dpr * (VIEW_W / 2 - cam.cx * zoom));
    const ty = Math.round(dpr * (VIEW_H / 2 - cam.cy * zoom));
    ctx.setTransform(s, 0, 0, s, tx, ty);
    const v = this.view;
    v.x0 = -tx / s - 8;
    v.y0 = -ty / s - 8;
    v.x1 = v.x0 + (VIEW_W * dpr) / s + 16;
    v.y1 = v.y0 + (VIEW_H * dpr) / s + 16;

    const a = Math.max(0, Math.min(1, alpha));
    this.cur = cur;
    this.tick = lerp(prev.tick, cur.tick, a);

    for (const e of cur.entities) {
      if (e.type === "pipe") {
        drawPipeTube(
          ctx,
          e.entry[0] + 0.5,
          e.entry[1] + 0.5,
          e.entryZ,
          e.exit[0] + 0.5,
          e.exit[1] + 0.5,
          e.exitZ,
          this.time,
        );
      }
    }

    this.collect(prev, cur, a);
    const list = this.list;
    list.sort(byDepth);

    strips.beginFrame();
    const tick = this.tick;
    const time = this.time;
    let di = 0;
    const n = list.length;
    const W = env.W;
    for (let k = 0; k < strips.kCount; k++) {
      strips.drawStrip(ctx, k, v, zoom, dpr);
      strips.drawDynamic(ctx, k, v, tick);
      const decals = strips.decalCells[k]!;
      for (let d = 0; d < decals.length; d++) {
        const i = decals[d]!;
        const cx = i % W;
        const cy = (i - cx) / W;
        const sx = (cx - cy) * 32;
        const sy = (cx + cy + 1) * 16 - env.topMax[i]! * 32;
        if (sx + 40 < v.x0 || sx - 40 > v.x1 || sy + 40 < v.y0 || sy - 40 > v.y1) continue;
        if ((env.surfaces[i] ?? 0) === 2) drawAcidDecal(ctx, env, cx, cy, time, tick);
        else drawSpeedDecal(ctx, env, cx, cy, time, tick);
      }
      while (di < n && list[di]!.k <= k) this.drawItem(list[di++]!);
    }
    while (di < n) this.drawItem(list[di++]!);

    if (this.pathOverlay && this.pathOverlay.length > 1) this.drawPath(this.pathOverlay);
    if (this.debug) this.drawDebug(v);
  }

  // ---------- collection ----------

  private push(k: number, z: number, y: number, kind: number, a = 0, b = 0, c = 0): void {
    let d = this.pool[this.poolUsed];
    if (!d) {
      d = { k, z, y, kind, a, b, c };
      this.pool.push(d);
    } else {
      d.k = k;
      d.z = z;
      d.y = y;
      d.kind = kind;
      d.a = a;
      d.b = b;
      d.c = c;
    }
    this.poolUsed++;
    this.list.push(d);
  }

  private ensureEntityScratch(n: number): void {
    if (this.entX.length >= n) return;
    const size = Math.max(n, this.entX.length * 2);
    this.entX = new Float64Array(size);
    this.entY = new Float64Array(size);
    this.entZ = new Float64Array(size);
    this.entA = new Float64Array(size);
    this.entB = new Float64Array(size);
  }

  private collect(prev: SimSnapshot, cur: SimSnapshot, a: number): void {
    const env = this.env!;
    const level = this.level!;
    this.list.length = 0;
    this.poolUsed = 0;
    const tick = this.tick;

    const ents = cur.entities;
    this.ensureEntityScratch(ents.length);
    for (let n = 0; n < ents.length; n++) {
      const e = ents[n]!;
      const pe = prev.entities[n];
      const p = pe && pe.type === e.type ? pe : e;
      switch (e.type) {
        case "steelie": {
          const q = p as typeof e;
          const x = lerp(q.x, e.x, a);
          const y = lerp(q.y, e.y, a);
          const z = lerp(q.z, e.z, a);
          this.setEnt(n, x, y, z, 0, 0);
          this.push(this.anchor(x, y, z), z, y, K_ENTITY, n);
          break;
        }
        case "muncher": {
          const q = p as typeof e;
          const x = lerp(q.x, e.x, a);
          const y = lerp(q.y, e.y, a);
          const hx = lerp(q.headX, e.headX, a);
          const hy = lerp(q.headY, e.headY, a);
          this.setEnt(n, x, y, lerp(q.z, e.z, a), hx, hy);
          const k = Math.max(Math.floor(x) + Math.floor(y), Math.floor(hx) + Math.floor(hy));
          this.push(k, e.z, Math.max(y, hy), K_ENTITY, n);
          break;
        }
        case "hoover": {
          this.setEnt(n, e.x, e.y, e.z, 0, 0);
          this.push(Math.floor(e.x) + Math.floor(e.y), e.z, e.y, K_ENTITY, n);
          break;
        }
        case "catapult": {
          const q = p as typeof e;
          this.setEnt(n, e.x, e.y, e.z, lerp(q.compress, e.compress, a), 0);
          this.push(Math.floor(e.x) + Math.floor(e.y), e.z, e.y, K_ENTITY, n);
          break;
        }
        case "hammer": {
          const q = p as typeof e;
          this.setEnt(n, e.x, e.y, e.z, lerp(q.headHeight, e.headHeight, a), 0);
          this.push(Math.floor(e.x) + Math.floor(e.y), e.z + 0.01, e.y, K_ENTITY, n);
          break;
        }
        case "platform": {
          const q = p as typeof e;
          const x = lerp(q.x, e.x, a);
          const y = lerp(q.y, e.y, a);
          const topZ = lerp(q.topZ, e.topZ, a);
          this.setEnt(n, x, y, topZ, 0, 0);
          for (let j = 0; j < e.h; j++) {
            for (let i = 0; i < e.w; i++) {
              const k = pieceAnchor(x + i, y + j);
              this.push(k, topZ - 0.5, y + j, K_PLATFORM, n, i, j);
            }
          }
          break;
        }
        case "pipe": {
          const ex = e.entry[0] + 0.5;
          const ey = e.entry[1] + 0.5;
          const xx = e.exit[0] + 0.5;
          const xy = e.exit[1] + 0.5;
          this.push(e.entry[0] + e.entry[1], e.entryZ - 0.01, ey, K_ENTITY, n);
          this.push(e.exit[0] + e.exit[1], e.exitZ - 0.01, xy, K_PIPE_EXIT, n);
          this.setEnt(n, ex, ey, e.entryZ, xx, xy);
          break;
        }
        case "funnel": {
          const z = groundAt(env, e.x, e.y, tick) ?? e.z - e.depth;
          this.setEnt(n, e.x, e.y, z, 0, 0);
          this.push(Math.floor(e.x) + Math.floor(e.y), z - 0.01, e.y, K_FUNNEL_HOLE, n);
          break;
        }
        case "wave":
          break;
      }
    }

    const players = cur.players;
    for (let pi = 0; pi < players.length; pi++) {
      const pc = players[pi]!;
      const idx = pc.index;
      const f = this.fx[idx] ?? (this.fx[idx] = newPlayerFx());
      if (pc.status === "eliminated" && f.lastStatus !== "eliminated") f.elimTime = this.time;
      f.lastStatus = pc.status;
      if (pc.status === "transit" || pc.status === "waiting") continue;
      if (pc.status === "eliminated" && this.time - f.elimTime >= ELIMINATED_FADE_S) continue;
      const pp = prev.players[pi];
      let x = pc.x;
      let y = pc.y;
      let z = pc.z;
      let rp = pc.rollPhase;
      let st = pc.statusTicks;
      let gz = pc.groundZ;
      if (pp && pp.index === idx) {
        const dx = pc.x - pp.x;
        const dy = pc.y - pp.y;
        const dz = pc.z - pp.z;
        if (dx * dx + dy * dy + dz * dz < TELEPORT_DIST2) {
          x = lerp(pp.x, pc.x, a);
          y = lerp(pp.y, pc.y, a);
          z = lerp(pp.z, pc.z, a);
          rp = lerp(pp.rollPhase, pc.rollPhase, a);
          if (pp.groundZ !== null && pc.groundZ !== null) gz = lerp(pp.groundZ, pc.groundZ, a);
        }
        if (pp.status === pc.status) st = lerp(pp.statusTicks, pc.statusTicks, a);
      }
      f.x = x;
      f.y = y;
      f.z = z;
      f.groundZ = gz;
      f.rollPhase = rp;
      f.statusTicks = st;
      const svx = px(pc.vx, pc.vy);
      const svy = py(pc.vx, pc.vy, 0);
      if (svx * svx + svy * svy > 1) f.rollAngle = Math.atan2(svy, svx);
      this.push(this.playerAnchor(x, y, z, cur), z, y, K_PLAYER, pi);
    }

    const owners = cur.checkpointOwners;
    for (let c = 0; c < level.checkpoints.length; c++) {
      const cp = level.checkpoints[c]!;
      const x = cp.at[0] + 0.5;
      const y = cp.at[1] + 0.5;
      const z = groundAt(env, x, y, tick) ?? 0;
      this.push(cp.at[0] + cp.at[1], z, y, K_CHECKPOINT, c, owners[c] ?? -1);
    }

    const gx = level.goal.at[0] + 0.5;
    const gy = level.goal.at[1] + 0.5;
    const gz = groundAt(env, gx, gy, tick) ?? 0;
    const gr = level.goal.radius;
    const span = gr * Math.SQRT2;
    const k0 = Math.floor(gx + gy - span);
    const k1 = Math.floor(gx + gy + span);
    for (let k = k0; k <= k1; k++) this.push(k, gz - 0.02, gy, K_GOAL_BAND, k);
    const fxp = gx - gr * Math.SQRT1_2;
    const fyp = gy - gr * Math.SQRT1_2;
    this.push(Math.floor(fxp) + Math.floor(fyp), gz, fyp, K_GOAL_FLAG);

    const plist = this.particles.list;
    for (let i = 0; i < plist.length; i++) {
      const p = plist[i]!;
      if (p.age < 0) continue;
      this.push(Math.floor(p.x) + Math.floor(p.y), p.z, p.y, K_PARTICLE, i);
    }
  }

  private setEnt(n: number, x: number, y: number, z: number, aa: number, bb: number): void {
    this.entX[n] = x;
    this.entY[n] = y;
    this.entZ[n] = z;
    this.entA[n] = aa;
    this.entB[n] = bb;
  }

  private anchor(x: number, y: number, z: number): number {
    return sphereAnchor(this.env!, x, y, z, MARBLE_RADIUS, this.tick);
  }

  /** Marbles riding a platform share the anchor of the piece under them (drawn after it). */
  private playerAnchor(x: number, y: number, z: number, cur: SimSnapshot): number {
    const ents = cur.entities;
    for (let n = 0; n < ents.length; n++) {
      const e = ents[n]!;
      if (e.type !== "platform") continue;
      const ox = this.entX[n]!;
      const oy = this.entY[n]!;
      if (x < ox || y < oy || x >= ox + e.w || y >= oy + e.h) continue;
      if (z < this.entZ[n]! - 0.15) continue;
      const i = Math.min(e.w - 1, Math.floor(x - ox + MARBLE_RADIUS));
      const j = Math.min(e.h - 1, Math.floor(y - oy + MARBLE_RADIUS));
      return pieceAnchor(ox + i, oy + j);
    }
    return this.anchor(x, y, z);
  }

  // ---------- drawing ----------

  private drawItem(d: Drawable): void {
    const ctx = this.ctx;
    switch (d.kind) {
      case K_PLAYER:
        this.drawPlayer(d.a);
        return;
      case K_ENTITY:
        this.drawEntity(d.a);
        return;
      case K_PIPE_EXIT: {
        const e = this.cur!.entities[d.a];
        if (e && e.type === "pipe") drawPipeExit(ctx, e.exit[0] + 0.5, e.exit[1] + 0.5, e.exitZ);
        return;
      }
      case K_PLATFORM: {
        const e = this.cur!.entities[d.a];
        if (!e || e.type !== "platform") return;
        drawPlatformPiece(
          ctx,
          this.entX[d.a]! + d.b,
          this.entY[d.a]! + d.c,
          this.entZ[d.a]!,
          d.c === e.h - 1,
          d.b === e.w - 1,
          this.palette!,
        );
        return;
      }
      case K_PARTICLE: {
        const p = this.particles.list[d.a];
        if (p) drawParticle(ctx, p);
        return;
      }
      case K_GOAL_BAND: {
        const level = this.level!;
        const gx = level.goal.at[0] + 0.5;
        const gy = level.goal.at[1] + 0.5;
        const gz = d.z + 0.02;
        const k = d.a;
        const y0 = k * 16 - gz * 32;
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.view.x0, y0, this.view.x1 - this.view.x0, 16);
        ctx.clip();
        drawGoalRing(ctx, gx, gy, gz, level.goal.radius, this.time, level.theme.accent);
        ctx.restore();
        return;
      }
      case K_GOAL_FLAG: {
        const level = this.level!;
        const r = level.goal.radius * Math.SQRT1_2;
        drawGoalFlag(
          ctx,
          level.goal.at[0] + 0.5 - r,
          level.goal.at[1] + 0.5 - r,
          d.z,
          this.time,
          level.theme.accent,
        );
        return;
      }
      case K_CHECKPOINT: {
        const cp = this.level!.checkpoints[d.a];
        if (!cp) return;
        const color = d.b >= 0 ? playerColor(d.b) : NEUTRAL_FLAG;
        drawCheckpoint(ctx, cp.at[0] + 0.5, cp.at[1] + 0.5, d.z, color, this.time);
        return;
      }
      case K_FUNNEL_HOLE:
        drawFunnelHole(ctx, this.entX[d.a]!, this.entY[d.a]!, this.entZ[d.a]!, this.time);
        return;
    }
  }

  private drawEntity(n: number): void {
    const e = this.cur!.entities[n];
    if (!e) return;
    const ctx = this.ctx;
    const x = this.entX[n]!;
    const y = this.entY[n]!;
    const z = this.entZ[n]!;
    switch (e.type) {
      case "steelie":
        drawSteelie(ctx, x, y, z, z);
        return;
      case "muncher":
        drawMuncher(ctx, x, y, z, this.entA[n]!, this.entB[n]!, e.state as MuncherState, this.time);
        return;
      case "hoover":
        drawHoover(ctx, x, y, z, e.active, e.pullRadius, this.time);
        return;
      case "hammer":
        drawHammer(ctx, x, y, z, this.entA[n]!, this.level!.theme.accent);
        return;
      case "catapult":
        drawCatapult(ctx, x, y, z, this.entA[n]!, this.palette!);
        return;
      case "pipe":
        drawPipeEntry(ctx, x, y, z);
        return;
      default:
        return;
    }
  }

  private drawPlayer(pi: number): void {
    const cur = this.cur!;
    const pc = cur.players[pi];
    if (!pc) return;
    const f = this.fx[pc.index]!;
    const ctx = this.ctx;
    const pose = this.pose;
    pose.visible = true;
    pose.x = f.x;
    pose.y = f.y;
    pose.z = f.z;
    pose.scale = 1;
    pose.squash = 1;
    pose.tint = 0;
    pose.alpha = 1;

    if (pc.status === "dying") {
      const cause = pc.deathCause;
      const total = cause ? DEATH_ANIM_TICKS[cause] : 84;
      const t = Math.max(0, (total - f.statusTicks) / TICK_HZ);
      const base: Point3 = f.hasDeath ? { x: f.deathX, y: f.deathY, z: f.deathZ } : f;
      dyingPose(pose, cause, t, base, this.deathTarget(cause, base));
      if (!pose.visible) return;
    } else if (pc.status === "eliminated") {
      pose.alpha = Math.max(0, 1 - (this.time - f.elimTime) / ELIMINATED_FADE_S);
    }

    const gz = f.groundZ ?? groundAt(this.env!, pose.x, pose.y, this.tick);
    if (gz !== null && pose.z - gz < 6) {
      drawShadow(
        ctx,
        px(pose.x, pose.y),
        py(pose.x, pose.y, gz),
        pose.z - gz,
        0.35 * pose.alpha,
        pose.scale,
      );
    }
    const look = this.look;
    look.color = playerColor(pc.index);
    look.rollPhase = f.rollPhase;
    look.rollAngle = f.rollAngle;
    look.alpha = pose.alpha;
    look.scale = pose.scale;
    look.squash = pose.squash;
    look.tint = pose.tint;
    const cz = pose.z + MARBLE_RADIUS * pose.scale * pose.squash;
    const X = px(pose.x, pose.y);
    const Y = py(pose.x, pose.y, cz);
    drawMarble(ctx, X, Y, look);

    const since = this.time - f.respawnTime;
    if (since >= 0 && since < RESPAWN_FLASH_S && pc.status === "alive") {
      const u = since / RESPAWN_FLASH_S;
      ctx.beginPath();
      ctx.arc(X, Y, 12.6 * (1 + u * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - u)).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  private deathTarget(cause: string | null, base: Point3): Point3 | null {
    if (cause !== "munch" && cause !== "hoover") return null;
    const ents = this.cur!.entities;
    let best: Point3 | null = null;
    let bestD = Infinity;
    for (let n = 0; n < ents.length; n++) {
      const e = ents[n]!;
      let tx: number;
      let ty: number;
      let tz: number;
      if (cause === "munch" && e.type === "muncher") {
        tx = this.entA[n]!;
        ty = this.entB[n]!;
        tz = e.z + 0.6;
      } else if (cause === "hoover" && e.type === "hoover") {
        tx = e.x;
        ty = e.y;
        tz = e.z + 0.3;
      } else continue;
      const d = (tx - base.x) * (tx - base.x) + (ty - base.y) * (ty - base.y);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty, z: tz };
      }
    }
    return best;
  }

  private drawPath(points: Array<[number, number]>): void {
    const ctx = this.ctx;
    const env = this.env!;
    ctx.beginPath();
    for (let n = 0; n < points.length; n++) {
      const [x, y] = points[n]!;
      const z = (groundAt(env, x, y, this.tick) ?? 0) + 0.1;
      if (n === 0) ctx.moveTo(px(x, y), py(x, y, z));
      else ctx.lineTo(px(x, y), py(x, y, z));
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = this.level!.theme.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawDebug(v: ViewRect): void {
    const ctx = this.ctx;
    const strips = this.strips!;
    ctx.lineWidth = 1;
    ctx.font = "10px monospace";
    for (let k = 0; k < strips.kCount; k++) {
      for (const seg of strips.strips[k]!) {
        if (seg.x1 < v.x0 || seg.x0 > v.x1 || seg.y1 < v.y0 || seg.y0 > v.y1) continue;
        ctx.strokeStyle = k % 2 === 0 ? "rgba(255,0,255,0.35)" : "rgba(0,255,255,0.35)";
        ctx.strokeRect(seg.x0, seg.y0, seg.x1 - seg.x0, seg.y1 - seg.y0);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText(String(k), seg.x0 + 2, seg.y0 + 10);
      }
    }
    const env = this.env!;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    for (let cy = 0; cy < env.H; cy++) {
      for (let cx = 0; cx < env.W; cx++) {
        const i = cy * env.W + cx;
        if (env.heights[i]! < 0) continue;
        const z = env.topMax[i]!;
        const sx = (cx - cy) * 32;
        if (sx + 32 < v.x0 || sx - 32 > v.x1) continue;
        ctx.moveTo(px(cx, cy), py(cx, cy, z));
        ctx.lineTo(px(cx + 1, cy), py(cx + 1, cy, z));
        ctx.lineTo(px(cx + 1, cy + 1), py(cx + 1, cy + 1, z));
        ctx.lineTo(px(cx, cy + 1), py(cx, cy + 1, z));
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(4, 4, 210, 34);
    ctx.fillStyle = "#9f9";
    ctx.font = "11px monospace";
    ctx.fillText(
      `frame ${this.stats.frameMs.toFixed(2)} ms  fps ${this.stats.fps.toFixed(0)}`,
      10,
      18,
    );
    ctx.fillText(
      `cache ${(strips.bytes / 1048576).toFixed(1)} MB  parts ${this.particles.list.length}`,
      10,
      32,
    );
  }

  private buildStaticSnapshot(level: UnstampedLevel, env: CellEnv): SimSnapshot {
    const ents: EntitySnapshot[] = [];
    const gz = (x: number, y: number) => groundAt(env, x, y, 0) ?? 0;
    for (const e of level.entities) {
      switch (e.type) {
        case "steelie": {
          const x = e.at[0] + 0.5;
          const y = e.at[1] + 0.5;
          ents.push({ type: "steelie", index: e.index, x, y, z: gz(x, y), vx: 0, vy: 0 });
          break;
        }
        case "muncher": {
          const x = e.at[0] + 0.5;
          const y = e.at[1] + 0.5;
          ents.push({
            type: "muncher",
            index: e.index,
            x,
            y,
            z: gz(x, y),
            headX: x,
            headY: y,
            state: "idle",
            stateTicks: 0,
          });
          break;
        }
        case "hoover": {
          const x = e.at[0] + 0.5;
          const y = e.at[1] + 0.5;
          ents.push({
            type: "hoover",
            index: e.index,
            x,
            y,
            z: gz(x, y),
            active: true,
            pullRadius: e.pullRadius,
          });
          break;
        }
        case "hammer": {
          const x = e.at[0] + 0.5;
          const y = e.at[1] + 0.5;
          ents.push({
            type: "hammer",
            index: e.index,
            x,
            y,
            z: gz(x, y),
            headHeight: 2,
            phase: "up",
          });
          break;
        }
        case "catapult": {
          const x = e.at[0] + 0.5;
          const y = e.at[1] + 0.5;
          ents.push({ type: "catapult", index: e.index, x, y, z: gz(x, y), compress: 0 });
          break;
        }
        case "wave":
          ents.push({ type: "wave", index: e.index, rect: e.rect });
          break;
        case "platform": {
          const o = e.path[0] ?? e.at;
          ents.push({
            type: "platform",
            index: e.index,
            x: o[0],
            y: o[1],
            w: e.size[0],
            h: e.size[1],
            topZ: e.top / 2,
            vx: 0,
            vy: 0,
          });
          break;
        }
        case "pipe":
          ents.push({
            type: "pipe",
            index: e.index,
            entry: e.entry,
            exit: e.exit,
            entryZ: gz(e.entry[0] + 0.5, e.entry[1] + 0.5),
            exitZ: gz(e.exit[0] + 0.5, e.exit[1] + 0.5),
          });
          break;
        case "funnel": {
          const x = e.at[0] + 0.5;
          const y = e.at[1] + 0.5;
          ents.push({
            type: "funnel",
            index: e.index,
            x,
            y,
            z: env.heights[e.at[1] * env.W + e.at[0]]! * 0.5,
            radius: e.radius,
            depth: e.depth,
          });
          break;
        }
      }
    }
    return {
      tick: 0,
      countdown: 0,
      players: [],
      entities: ents,
      checkpointOwners: level.checkpoints.map(() => -1),
    };
  }
}

function pieceAnchor(x: number, y: number): number {
  return Math.floor(x + 1 - 1e-6) + Math.floor(y + 1 - 1e-6);
}

function findPlayer(snap: SimSnapshot, index: number): PlayerSnapshot | undefined {
  const p = snap.players[index];
  if (p && p.index === index) return p;
  return snap.players.find((q) => q.index === index);
}

function findEntity(snap: SimSnapshot, index: number): EntitySnapshot | undefined {
  const e = snap.entities[index];
  if (e && e.index === index) return e;
  return snap.entities.find((q) => q.index === index);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
