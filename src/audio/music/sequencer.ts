// Step sequencer: schedules 16th notes 0.2 s ahead of AudioContext.currentTime (§7.12).
import { midiToHz, noise } from "../synth";
import {
  chordTones,
  generateBass,
  generateLead,
  STEPS_PER_BAR,
  stepDuration,
  swingDelay,
  type TrackDef,
} from "./tracks";

export const LOOKAHEAD_S = 0.2;
export const TIMER_MS = 25;

/** Pure: (bar, step-in-bar) of an absolute step index for a track. */
export function stepPosition(track: TrackDef, step: number): { bar: number; s: number } {
  const total = track.bars * STEPS_PER_BAR;
  const i = ((step % total) + total) % total;
  return { bar: Math.floor(i / STEPS_PER_BAR), s: i % STEPS_PER_BAR };
}

export class Sequencer {
  private readonly out: GainNode;
  private readonly lead: number[];
  private readonly bass: number[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    readonly track: TrackDef,
    gain = 1,
  ) {
    this.lead = generateLead(track, track.bars);
    this.bass = generateBass(track, track.bars);
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    if (track.highpass > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = track.highpass;
      this.out.connect(hp).connect(dest);
    } else {
      this.out.connect(dest);
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.pump(), TIMER_MS);
    this.pump();
  }

  stop(fade = 0.3): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + fade);
    const out = this.out;
    setTimeout(() => out.disconnect(), (fade + LOOKAHEAD_S) * 1000 + 100);
  }

  private pump(): void {
    const ctx = this.ctx;
    if (ctx.state !== "running") return;
    // After a long stall (tab hidden) skip ahead instead of bursting every missed note.
    if (this.nextTime < ctx.currentTime - 0.5) this.nextTime = ctx.currentTime + 0.05;
    const dur = stepDuration(this.track.bpm);
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      this.schedule(this.step, this.nextTime + swingDelay(this.step, this.track), dur);
      this.nextTime += dur;
      this.step++;
    }
  }

  private schedule(step: number, t: number, dur: number): void {
    const tr = this.track;
    const { bar, s } = stepPosition(tr, step);
    const idx = bar * STEPS_PER_BAR + s;
    if (tr.kick[s] === "x") this.kick(t);
    if (tr.snare[s] === "x")
      noise(this.ctx, this.out, {
        t0: t,
        dur: 0.1,
        gain: 0.22,
        filter: "bandpass",
        freq: 1800,
        q: 1,
      });
    if (tr.hat[s] === "x")
      noise(this.ctx, this.out, { t0: t, dur: 0.03, gain: 0.08, filter: "highpass", freq: 7000 });

    const b = this.bass[idx]!;
    if (b >= 0) this.bassNote(b, t, dur * (tr.bassWobble ? 2.5 : 1.8));

    const l = this.lead[idx]!;
    if (l >= 0) {
      const len = tr.leadStyle === "arp" ? dur * 0.9 : tr.leadStyle === "pad" ? dur * 7 : dur * 1.8;
      const g = tr.leadStyle === "arp" ? 0.07 : 0.09;
      this.voice(tr.waveforms.lead, l, t, len, g, 0);
      if (tr.detune > 0) this.voice(tr.waveforms.lead, l, t, len, g * 0.7, tr.detune);
    }

    if (tr.padGain > 0 && s === 0) {
      const barLen = dur * STEPS_PER_BAR;
      for (const m of chordTones(tr, bar))
        this.voice(tr.waveforms.pad, m, t, barLen, tr.padGain, 0, 0.25);
    }
  }

  private voice(
    type: OscillatorType,
    midi: number,
    t: number,
    len: number,
    gain: number,
    detune: number,
    attack = 0.01,
  ): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(midiToHz(midi), t);
    if (detune) osc.detune.setValueAtTime(detune, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, len * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  private bassNote(midi: number, t: number, len: number): void {
    const ctx = this.ctx;
    const tr = this.track;
    const osc = ctx.createOscillator();
    osc.type = tr.waveforms.bass;
    osc.frequency.setValueAtTime(midiToHz(midi), t);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = tr.bassWobble ? 8 : 1;
    if (tr.bassWobble) {
      lp.frequency.setValueAtTime(250, t);
      lp.frequency.exponentialRampToValueAtTime(1400, t + len * 0.5);
      lp.frequency.exponentialRampToValueAtTime(250, t + len);
    } else {
      lp.frequency.setValueAtTime(tr.waveforms.bass === "sawtooth" ? 900 : 1200, t);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(lp).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.14);
  }
}
