// Every sound effect (§7.12), synthesized at call time.
import { midiToHz, noise, noiseBuffer, tone } from "./synth";

type Ctx = BaseAudioContext;

export function clack(ctx: Ctx, out: AudioNode, impact: number, scale = 1): void {
  const g = Math.min(1, impact / 8) * scale;
  if (g <= 0.005) return;
  tone(ctx, out, { type: "sine", freq: 1800, freqEnd: 900, glide: 0.06, dur: 0.07, gain: 0.5 * g });
  noise(ctx, out, { dur: 0.02, gain: 0.35 * g, filter: "highpass", freq: 2500 });
}

export function land(ctx: Ctx, out: AudioNode, impact: number): void {
  clack(ctx, out, impact, 0.5);
  const g = Math.min(1, impact / 8);
  tone(ctx, out, { type: "sine", freq: 60, dur: 0.08, gain: 0.6 * g });
}

const SHATTER_PARTIALS = [2510, 3170, 3890, 4620, 5730, 6980];

export function shatter(ctx: Ctx, out: AudioNode, gain = 1): void {
  const t0 = ctx.currentTime;
  for (let i = 0; i < SHATTER_PARTIALS.length; i++) {
    tone(ctx, out, {
      type: "sine",
      freq: SHATTER_PARTIALS[i]!,
      t0: t0 + i * 0.004,
      dur: 0.4,
      gain: 0.12 * gain,
    });
  }
  noise(ctx, out, { t0, dur: 0.12, gain: 0.5 * gain, filter: "highpass", freq: 1500 });
  tone(ctx, out, { type: "triangle", freq: 1200, freqEnd: 300, t0, dur: 0.3, gain: 0.25 * gain });
}

export function acid(ctx: Ctx, out: AudioNode): void {
  const t0 = ctx.currentTime;
  const g = noise(ctx, out, {
    t0,
    dur: 0.6,
    gain: 0.6,
    filter: "bandpass",
    freq: 800,
    q: 2,
    flat: true,
  });
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 8;
  const depth = ctx.createGain();
  depth.gain.value = 0.3;
  lfo.connect(depth).connect(g.gain);
  lfo.start(t0);
  lfo.stop(t0 + 0.65);
}

export function munch(ctx: Ctx, out: AudioNode): void {
  const t0 = ctx.currentTime;
  tone(ctx, out, { type: "sawtooth", freq: 180, freqEnd: 80, t0, dur: 0.25, gain: 0.35 });
  tone(ctx, out, { type: "sine", freq: 120, freqEnd: 60, t0: t0 + 0.25, dur: 0.15, gain: 0.6 });
}

export function hammer(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "sine", freq: 50, dur: 0.12, gain: 0.9 });
  noise(ctx, out, { dur: 0.09, gain: 0.5, filter: "lowpass", freq: 400 });
}

/** One-shot death sound for hoover kills (the continuous hum is HooverVoice). */
export function hooverSuck(ctx: Ctx, out: AudioNode): void {
  noise(ctx, out, { dur: 0.45, gain: 0.45, filter: "bandpass", freq: 400, freqEnd: 3000, q: 3 });
  tone(ctx, out, { type: "sine", freq: 600, freqEnd: 120, dur: 0.45, gain: 0.25 });
}

export function catapult(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "triangle", freq: 200, freqEnd: 900, dur: 0.18, gain: 0.45 });
  noise(ctx, out, { dur: 0.2, gain: 0.25, filter: "bandpass", freq: 1200, freqEnd: 3000, q: 1 });
}

/** Lowpass noise sweep 300 → 2000 → 300 Hz across travelTime. */
export function pipe(ctx: Ctx, out: AudioNode, travelTime: number): void {
  const t0 = ctx.currentTime;
  const dur = Math.max(0.2, travelTime);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 1, "white");
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 4;
  f.frequency.setValueAtTime(300, t0);
  f.frequency.exponentialRampToValueAtTime(2000, t0 + dur / 2);
  f.frequency.exponentialRampToValueAtTime(300, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.4, t0 + 0.05);
  g.gain.setValueAtTime(0.4, t0 + dur - 0.1);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

export function speedStrip(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "square", freq: 300, freqEnd: 1200, dur: 0.12, gain: 0.18 });
}

export function checkpoint(ctx: Ctx, out: AudioNode): void {
  const t0 = ctx.currentTime;
  tone(ctx, out, { type: "sine", freq: 880, t0, dur: 0.12, gain: 0.35 });
  tone(ctx, out, { type: "sine", freq: 1320, t0: t0 + 0.12, dur: 0.12, gain: 0.35 });
}

export function goal(ctx: Ctx, out: AudioNode): void {
  const t0 = ctx.currentTime;
  const arp = [72, 76, 79, 84];
  arp.forEach((m, i) => {
    tone(ctx, out, { type: "square", freq: midiToHz(m), t0: t0 + i * 0.09, dur: 0.09, gain: 0.18 });
  });
  const tc = t0 + arp.length * 0.09;
  for (const m of [60, 64, 67, 72]) {
    tone(ctx, out, { type: "square", freq: midiToHz(m), t0: tc, dur: 0.6, gain: 0.1 });
  }
}

export function countdown(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "square", freq: 440, dur: 0.1, gain: 0.25 });
}

export function go(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "square", freq: 880, dur: 0.4, gain: 0.25 });
}

export function timeWarning(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "sine", freq: 1000, dur: 0.04, gain: 0.35 });
}

export function timeOut(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "sawtooth", freq: 440, freqEnd: 110, dur: 0.7, gain: 0.3 });
}

export function menuMove(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "square", freq: 600, dur: 0.03, gain: 0.15 });
}

export function menuSelect(ctx: Ctx, out: AudioNode): void {
  const t0 = ctx.currentTime;
  tone(ctx, out, { type: "square", freq: 900, t0, dur: 0.06, gain: 0.15 });
  tone(ctx, out, { type: "square", freq: 1200, t0: t0 + 0.06, dur: 0.06, gain: 0.15 });
}

export function menuBack(ctx: Ctx, out: AudioNode): void {
  tone(ctx, out, { type: "square", freq: 300, dur: 0.08, gain: 0.15 });
}

export function highScore(ctx: Ctx, out: AudioNode): void {
  const t0 = ctx.currentTime;
  const steps = [0, 2, 4, 5, 7, 9, 11, 12];
  steps.forEach((s, i) => {
    tone(ctx, out, {
      type: "triangle",
      freq: midiToHz(72 + s),
      t0: t0 + i * 0.08,
      dur: 0.12,
      gain: 0.3,
    });
  });
}

export function leftBehind(ctx: Ctx, out: AudioNode): void {
  shatter(ctx, out, 0.5);
  tone(ctx, out, { type: "sine", freq: 300, freqEnd: 80, dur: 0.4, gain: 0.3 });
}

// ---------- continuous voices ----------

const SMOOTH = 0.05;

/** Rolling noise for one marble: looping pink noise → lowpass → gain. */
export class RollVoice {
  private readonly src: AudioBufferSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: Ctx,
    out: AudioNode,
  ) {
    this.src = ctx.createBufferSource();
    this.src.buffer = noiseBuffer(ctx, 2, "pink");
    this.src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = 200;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(this.filter).connect(this.gain).connect(out);
    this.src.start();
  }

  set(speed: number, rolling: boolean): void {
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(200 + speed * 180, now, SMOOTH);
    this.gain.gain.setTargetAtTime(rolling ? Math.min(1, speed / 7) * 0.5 : 0, now, SMOOTH);
  }

  stop(): void {
    this.src.stop();
    this.gain.disconnect();
  }
}

/** Hoover hum: sawtooth 70 Hz + noise through lowpass 600 Hz. */
export class HooverVoice {
  private readonly osc: OscillatorNode;
  private readonly src: AudioBufferSourceNode;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: Ctx,
    out: AudioNode,
  ) {
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 70;
    this.src = ctx.createBufferSource();
    this.src.buffer = noiseBuffer(ctx, 2, "white");
    this.src.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(lp);
    this.src.connect(noiseGain).connect(lp);
    lp.connect(this.gain).connect(out);
    this.osc.start();
    this.src.start();
  }

  /** proximity = 1 − d/pullRadius (0 when out of range). */
  set(proximity: number): void {
    this.gain.gain.setTargetAtTime(Math.max(0, proximity) * 0.4, this.ctx.currentTime, SMOOTH);
  }

  stop(): void {
    this.osc.stop();
    this.src.stop();
    this.gain.disconnect();
  }
}

/** Funnel whistle: sine 400–800 Hz rising as the marble nears the hole. */
export class FunnelVoice {
  private readonly osc: OscillatorNode;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: Ctx,
    out: AudioNode,
  ) {
    this.osc = ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.value = 400;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(this.gain).connect(out);
    this.osc.start();
  }

  set(freq: number, on: boolean): void {
    const now = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(freq, now, SMOOTH);
    this.gain.gain.setTargetAtTime(on ? 0.25 : 0, now, SMOOTH);
  }

  stop(): void {
    this.osc.stop();
    this.gain.disconnect();
  }
}

/** Funnel whistle pitch for distance d inside a funnel of radius r: 400 Hz at the rim → 800 at d=0. */
export function funnelFreq(d: number, r: number): number {
  return (800 * r) / (Math.max(0, d) + r);
}
