// Audio context, buses, SFX dispatch and continuous voices (§7.12). Every method no-ops
// gracefully when Web Audio is missing or not yet unlocked.
import type { MusicId, UnstampedLevel } from "../level/types";
import type { SimEvent, SimSnapshot } from "../sim/types";
import { Sequencer } from "./music/sequencer";
import { TRACKS } from "./music/tracks";
import * as sfx from "./sfx";
import { audioContextCtor } from "./synth";

export type UiSound =
  | "menuMove"
  | "menuSelect"
  | "menuBack"
  | "highScore"
  | "countdown"
  | "go"
  | "timeWarning"
  | "timeOut"
  | "goal"
  | "checkpoint";

const UI: Record<UiSound, (ctx: BaseAudioContext, out: AudioNode) => void> = {
  menuMove: sfx.menuMove,
  menuSelect: sfx.menuSelect,
  menuBack: sfx.menuBack,
  highScore: sfx.highScore,
  countdown: sfx.countdown,
  go: sfx.go,
  timeWarning: sfx.timeWarning,
  timeOut: sfx.timeOut,
  goal: sfx.goal,
  checkpoint: sfx.checkpoint,
};

const CLACK_GAP_S = 0.04;
const DEFAULT_PIPE_TIME = 1.2;
const DEFAULT_FUNNEL_TIME = 1.0;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private volumes = { master: 1, music: 0.6, sfx: 0.8 };
  private unlocking: Promise<void> | null = null;
  private rolls: sfx.RollVoice[] = [];
  private hoover: sfx.HooverVoice | null = null;
  private funnel: sfx.FunnelVoice | null = null;
  private seq: Sequencer | null = null;
  private seqCue: string | null = null;
  private pendingMusic: { id: MusicId; gain: number; cue: string | null } | null = null;
  private background = false;
  private resumeOnForeground = false;
  private musicStarts = 0;

  /** Diagnostics for the E2E hooks: context state and how many times a track started. */
  get debugState(): { context: string; musicStarts: number } {
    return { context: this.ctx?.state ?? "none", musicStarts: this.musicStarts };
  }
  private lastSnap: SimSnapshot | null = null;
  private level: UnstampedLevel | null = null;
  private lastClack = [-1, -1];

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state !== "closed";
  }

  unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") return this.ctx.resume().catch(() => undefined);
      return Promise.resolve();
    }
    if (this.unlocking) return this.unlocking;
    this.unlocking = this.create().finally(() => {
      this.unlocking = null;
    });
    return this.unlocking;
  }

  private async create(): Promise<void> {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch (_err) {
      return;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyVolumes();
    try {
      await ctx.resume();
    } catch (_err) {
      // Some browsers reject resume() outside a gesture; the next unlock() call retries.
    }
    const pending = this.pendingMusic;
    this.pendingMusic = null;
    if (pending) this.startMusic(pending.id, pending.gain, pending.cue ?? undefined);
  }

  /**
   * Hidden or unfocused page: suspend the context (music and SFX). Coming back resumes it only if
   * it was running when we suspended it, i.e. a user gesture had already unlocked it.
   */
  setBackground(bg: boolean): void {
    if (bg === this.background) return;
    this.background = bg;
    const ctx = this.ctx;
    if (bg) {
      this.resumeOnForeground = ctx?.state === "running";
      if (this.resumeOnForeground) ctx!.suspend().catch(() => undefined);
    } else {
      if (this.resumeOnForeground && ctx) ctx.resume().catch(() => undefined);
      this.resumeOnForeground = false;
    }
  }

  setVolumes(v: { master: number; music: number; sfx: number }): void {
    this.volumes = {
      master: clamp01(v.master),
      music: clamp01(v.music),
      sfx: clamp01(v.sfx),
    };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus) return;
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, now, 0.02);
    this.musicBus.gain.setTargetAtTime(this.volumes.music, now, 0.02);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, now, 0.02);
  }

  private ready(): { ctx: AudioContext; out: GainNode } | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== "running") return null;
    return { ctx, out: this.sfxBus };
  }

  handleEvents(events: readonly SimEvent[]): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    for (const ev of events) {
      try {
        switch (ev.t) {
          case "clack":
            if (this.clackAllowed(ev.player, ctx.currentTime)) sfx.clack(ctx, out, ev.impact);
            break;
          case "land":
            if (ev.impact > 1) sfx.land(ctx, out, ev.impact);
            break;
          case "death":
            switch (ev.cause) {
              case "shatter":
                sfx.shatter(ctx, out);
                break;
              case "fall":
                sfx.shatter(ctx, out, 0.6);
                break;
              case "acid":
                sfx.acid(ctx, out);
                break;
              case "munch":
                sfx.munch(ctx, out);
                break;
              case "hammer":
                sfx.hammer(ctx, out);
                break;
              case "hoover":
                sfx.hooverSuck(ctx, out);
                break;
              case "left-behind":
                sfx.leftBehind(ctx, out);
                break;
            }
            break;
          case "pipeEnter":
          case "funnelEnter":
            sfx.pipe(ctx, out, this.travelTime(ev.t, ev.player));
            break;
          case "catapult":
            sfx.catapult(ctx, out);
            break;
          case "speedStrip":
            sfx.speedStrip(ctx, out);
            break;
          case "checkpoint":
            sfx.checkpoint(ctx, out);
            break;
          case "goal":
            sfx.goal(ctx, out);
            break;
          case "timeout":
            sfx.timeOut(ctx, out);
            break;
          case "hammerDown":
            sfx.hammer(ctx, out);
            break;
          case "steelieRam":
            sfx.clack(ctx, out, 6);
            break;
          case "countdown":
            sfx.countdown(ctx, out);
            break;
          case "go":
            sfx.go(ctx, out);
            break;
          default:
            break;
        }
      } catch (_err) {
        // A failed one-shot must never take the frame down.
      }
    }
  }

  private clackAllowed(player: number, now: number): boolean {
    const last = this.lastClack[player] ?? -1;
    if (last >= 0 && now - last < CLACK_GAP_S) return false;
    this.lastClack[player] = now;
    return true;
  }

  /** travelTime of the pipe entry / funnel nearest the player's last known position. */
  private travelTime(kind: "pipeEnter" | "funnelEnter", player: number): number {
    const fallback = kind === "pipeEnter" ? DEFAULT_PIPE_TIME : DEFAULT_FUNNEL_TIME;
    const level = this.level;
    const p = this.lastSnap?.players.find((q) => q.index === player);
    if (!level || !p) return fallback;
    let best = fallback;
    let bestD = Infinity;
    for (const e of level.entities) {
      let cx: number;
      let cy: number;
      if (kind === "pipeEnter" && e.type === "pipe") {
        cx = e.entry[0] + 0.5;
        cy = e.entry[1] + 0.5;
      } else if (kind === "funnelEnter" && e.type === "funnel") {
        cx = e.at[0] + 0.5;
        cy = e.at[1] + 0.5;
      } else continue;
      const d = (cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y);
      if (d < bestD) {
        bestD = d;
        best = e.travelTime;
      }
    }
    return best;
  }

  updateFrame(snap: SimSnapshot, level: UnstampedLevel | null): void {
    this.lastSnap = snap;
    this.level = level;
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    try {
      while (this.rolls.length < snap.players.length) this.rolls.push(new sfx.RollVoice(ctx, out));
      for (let n = 0; n < this.rolls.length; n++) {
        const p = snap.players[n];
        const voice = this.rolls[n]!;
        if (!p) {
          voice.set(0, false);
          continue;
        }
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        voice.set(speed, p.grounded && p.status === "alive");
      }

      let hooverProx = 0;
      let funnelD = Infinity;
      let funnelR = 1;
      for (const e of snap.entities) {
        if (e.type === "hoover" && e.active) {
          for (const p of snap.players) {
            if (p.status !== "alive") continue;
            const d = Math.sqrt((p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y));
            if (d < e.pullRadius) hooverProx = Math.max(hooverProx, 1 - d / e.pullRadius);
          }
        } else if (e.type === "funnel") {
          for (const p of snap.players) {
            if (p.status !== "alive") continue;
            const d = Math.sqrt((p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y));
            if (d < e.radius && d < funnelD) {
              funnelD = d;
              funnelR = e.radius;
            }
          }
        }
      }
      if (hooverProx > 0 || this.hoover) {
        this.hoover ??= new sfx.HooverVoice(ctx, out);
        this.hoover.set(hooverProx);
      }
      if (funnelD < Infinity || this.funnel) {
        this.funnel ??= new sfx.FunnelVoice(ctx, out);
        const on = funnelD < Infinity;
        this.funnel.set(on ? sfx.funnelFreq(funnelD, funnelR) : 400, on);
      }
    } catch (_err) {
      // Continuous voices are best-effort.
    }
  }

  silenceContinuous(): void {
    if (!this.ctx) return;
    for (const v of this.rolls) v.set(0, false);
    this.hoover?.set(0);
    this.funnel?.set(400, false);
  }

  playUi(id: UiSound): void {
    const r = this.ready();
    if (!r) return;
    try {
      UI[id](r.ctx, r.out);
    } catch (_err) {
      // ignore
    }
  }

  /**
   * Starts a track from the top. With a `cue`, a repeat request for the cue already playing (or
   * pending) is ignored, so callers can re-sync music on every state change without restarting it.
   */
  startMusic(id: MusicId, gain = 1, cue?: string): void {
    const key = cue === undefined ? null : `${cue}|${id}|${gain}`;
    const p = this.pendingMusic;
    const pendingKey = p && p.cue !== null ? `${p.cue}|${p.id}|${p.gain}` : null;
    if (key !== null && (this.seqCue === key || pendingKey === key)) return;
    this.stopMusic();
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) {
      this.pendingMusic = { id, gain, cue: cue ?? null };
      return;
    }
    const track = TRACKS[id];
    if (!track) return;
    try {
      this.seq = new Sequencer(ctx, this.musicBus, track, gain);
      this.seq.start();
      this.seqCue = key;
      this.musicStarts++;
    } catch (_err) {
      this.seq = null;
    }
  }

  stopMusic(): void {
    this.pendingMusic = null;
    this.seqCue = null;
    if (this.seq) {
      try {
        this.seq.stop();
      } catch (_err) {
        // ignore
      }
      this.seq = null;
    }
  }

  suspend(): void {
    this.ctx?.suspend().catch(() => undefined);
  }

  resume(): void {
    this.ctx?.resume().catch(() => undefined);
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
