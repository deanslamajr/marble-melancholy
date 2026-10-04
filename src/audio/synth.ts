// Web Audio building blocks (§7.12): noise buffers, envelopes, tones, filtered noise.

export type Wave = "sine" | "square" | "sawtooth" | "triangle";
export type NoiseColor = "white" | "pink";

export interface Adsr {
  a: number;
  d: number;
  s: number;
  r: number;
}

type AudioContextCtor = new () => AudioContext;

export function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

const noiseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Noise buffer, rendered once per context. "pink" = white through a one-pole lowpass at 1.2 kHz. */
export function noiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  color: NoiseColor,
): AudioBuffer {
  let m = noiseCache.get(ctx);
  if (!m) {
    m = new Map();
    noiseCache.set(ctx, m);
  }
  const key = `${color}:${seconds}`;
  let buf = m.get(key);
  if (!buf) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    if (color === "white") {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } else {
      const a = 1 - Math.exp((-2 * Math.PI * 1200) / ctx.sampleRate);
      let y = 0;
      for (let i = 0; i < len; i++) {
        y += a * (Math.random() * 2 - 1 - y);
        data[i] = y * 2.2;
      }
    }
    m.set(key, buf);
  }
  return buf;
}

/** ADSR on `param` from t0: attack to peak, decay to s·peak, hold, release to ~0. Returns end time. */
export function env(param: AudioParam, t0: number, peak: number, e: Adsr, hold = 0): number {
  const floor = 0.0001;
  param.cancelScheduledValues(t0);
  param.setValueAtTime(floor, t0);
  param.linearRampToValueAtTime(peak, t0 + Math.max(0.001, e.a));
  const sus = Math.max(floor, peak * e.s);
  param.exponentialRampToValueAtTime(sus, t0 + e.a + Math.max(0.001, e.d));
  const relStart = t0 + e.a + e.d + hold;
  param.setValueAtTime(sus, relStart);
  param.exponentialRampToValueAtTime(floor, relStart + Math.max(0.001, e.r));
  return relStart + e.r;
}

export interface ToneOpts {
  type: Wave;
  freq: number;
  /** Exponential glide target reached at t0 + glide (default: dur). */
  freqEnd?: number;
  glide?: number;
  t0?: number;
  dur: number;
  gain: number;
  attack?: number;
  detune?: number;
}

/** One-shot oscillator with exponential decay over `dur`. */
export function tone(ctx: BaseAudioContext, out: AudioNode, o: ToneOpts): void {
  const t0 = o.t0 ?? ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + (o.glide ?? o.dur));
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
  const g = ctx.createGain();
  const attack = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, o.gain), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + o.dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + attack + o.dur + 0.05);
}

export interface NoiseOpts {
  dur: number;
  gain: number;
  t0?: number;
  color?: NoiseColor;
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  attack?: number;
  /** Linear fade instead of exponential decay. */
  flat?: boolean;
}

/** Filtered noise burst. Returns the gain node so callers can add modulation. */
export function noise(ctx: BaseAudioContext, out: AudioNode, o: NoiseOpts): GainNode {
  const t0 = o.t0 ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 1, o.color ?? "white");
  src.loop = true;
  const g = ctx.createGain();
  const attack = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, o.gain), t0 + attack);
  if (o.flat) {
    g.gain.setValueAtTime(o.gain, t0 + attack + o.dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t0 + attack + o.dur);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + o.dur);
  }
  let node: AudioNode = src;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freqEnd !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(10, o.freqEnd), t0 + attack + o.dur);
    }
    f.Q.value = o.q ?? 0.7;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + attack + o.dur + 0.05);
  return g;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
