// Six procedural race tracks (§7.12) and the pure note generators the sequencer plays.
import { fnv1a32 } from "../../core/hash";
import { Rng } from "../../core/rng";
import type { MusicId } from "../../level/types";
import type { Wave } from "../synth";

export { midiToHz } from "../synth";

export const SCALES = {
  majorPentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  wholeTone: [0, 2, 4, 6, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const satisfies Record<string, readonly number[]>;

export interface TrackDef {
  id: MusicId;
  bpm: number;
  /** MIDI note of the tonic. */
  root: number;
  scale: readonly number[];
  bars: number;
  /** Scale degree (0-based) of the chord root, one per bar (cycled). */
  progression: readonly number[];
  /** 16 steps: x root, o fifth, + octave, w walking scale step, . rest. */
  bass: string;
  kick: string;
  snare: string;
  hat: string;
  leadStyle: "arp" | "melody" | "pad";
  waveforms: { bass: Wave; lead: Wave; pad: Wave };
  /** Cents; > 0 adds a detuned second lead oscillator. */
  detune: number;
  swing: number;
  /** Probability of a melody note on an eighth-note step. */
  leadDensity: number;
  /** Semitones added to `root` for the lowest lead note. */
  leadOctave: number;
  /** Gain of sustained bar-long chord pads (0 = none). */
  padGain: number;
  /** Music-bus highpass cutoff in Hz (0 = off). */
  highpass: number;
  bassWobble: boolean;
}

/** Lead notes span two octaves above root + leadOctave. */
export const LEAD_RANGE = 24;
export const STEPS_PER_BAR = 16;

export const TRACKS: Record<MusicId, TrackDef> = {
  "m1-first-steps": {
    id: "m1-first-steps",
    bpm: 92,
    root: 60,
    scale: SCALES.majorPentatonic,
    bars: 8,
    progression: [0, 3, 1, 4, 0, 3, 2, 4],
    bass: "x.......o.......",
    kick: "x.......x.......",
    snare: "................",
    hat: "..x...x...x...x.",
    leadStyle: "melody",
    waveforms: { bass: "triangle", lead: "triangle", pad: "sine" },
    detune: 0,
    swing: 0.08,
    leadDensity: 0.45,
    leadOctave: 12,
    padGain: 0.05,
    highpass: 0,
    bassWobble: false,
  },
  "m2-long-drop": {
    id: "m2-long-drop",
    bpm: 112,
    root: 62,
    scale: SCALES.dorian,
    bars: 8,
    progression: [0, 3, 0, 4, 0, 3, 6, 4],
    bass: "x.w.w.w.x.w.w.w.",
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    leadStyle: "melody",
    waveforms: { bass: "triangle", lead: "square", pad: "triangle" },
    detune: 0,
    swing: 0.1,
    leadDensity: 0.55,
    leadOctave: 0,
    padGain: 0,
    highpass: 0,
    bassWobble: false,
  },
  "m3-clockwork": {
    id: "m3-clockwork",
    bpm: 124,
    root: 57,
    scale: SCALES.harmonicMinor,
    bars: 8,
    progression: [0, 3, 4, 0, 5, 3, 4, 4],
    bass: "x..x..x.x..x..x.",
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "xxxxxxxxxxxxxxxx",
    leadStyle: "arp",
    waveforms: { bass: "square", lead: "square", pad: "triangle" },
    detune: 0,
    swing: 0,
    leadDensity: 1,
    leadOctave: 12,
    padGain: 0,
    highpass: 0,
    bassWobble: false,
  },
  "m4-skyways": {
    id: "m4-skyways",
    bpm: 118,
    root: 65,
    scale: SCALES.lydian,
    bars: 8,
    progression: [0, 1, 0, 1, 4, 1, 5, 4],
    bass: "x.......x...o...",
    kick: "x.......x.......",
    snare: "................",
    hat: "....x.......x...",
    leadStyle: "pad",
    waveforms: { bass: "sine", lead: "sine", pad: "triangle" },
    detune: 6,
    swing: 0,
    leadDensity: 0.2,
    leadOctave: 12,
    padGain: 0.08,
    highpass: 350,
    bassWobble: false,
  },
  "m5-upside": {
    id: "m5-upside",
    bpm: 140,
    root: 67,
    scale: SCALES.wholeTone,
    bars: 8,
    progression: [0, 1, 2, 1, 0, 3, 2, 4],
    bass: "x..x..x...x..x..",
    kick: "x..x....x..x....",
    snare: "....x.......x...",
    hat: "x.xxx.xxx.xxx.x.",
    leadStyle: "melody",
    waveforms: { bass: "sawtooth", lead: "square", pad: "triangle" },
    detune: 18,
    swing: 0.25,
    leadDensity: 0.5,
    leadOctave: 0,
    padGain: 0,
    highpass: 0,
    bassWobble: true,
  },
  "m6-last-ledge": {
    id: "m6-last-ledge",
    bpm: 150,
    root: 52,
    scale: SCALES.phrygian,
    bars: 8,
    progression: [0, 1, 0, 6, 0, 1, 5, 6],
    bass: "x.xxx.xxx.xxx.xx",
    kick: "x...x...x.x.x...",
    snare: "....x.......x..x",
    hat: "xxxxxxxxxxxxxxxx",
    leadStyle: "arp",
    waveforms: { bass: "sawtooth", lead: "sawtooth", pad: "triangle" },
    detune: 8,
    swing: 0,
    leadDensity: 1,
    leadOctave: 24,
    padGain: 0,
    highpass: 0,
    bassWobble: false,
  },
};

/** MIDI note of scale index `idx` (may exceed the scale length; wraps by octaves). */
export function scaleNote(root: number, scale: readonly number[], idx: number): number {
  const n = scale.length;
  const oct = Math.floor(idx / n);
  return root + scale[idx - oct * n]! + 12 * oct;
}

/** Ascending MIDI notes of `scale` from `root` over `octaves` octaves, plus the top tonic. */
export function buildScale(root: number, scale: readonly number[], octaves = 1): number[] {
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) for (const s of scale) out.push(root + 12 * o + s);
  out.push(root + 12 * octaves);
  return out;
}

/** Triad (stacked scale thirds) for a bar of the progression, in the root octave. */
export function chordTones(track: TrackDef, bar: number): [number, number, number] {
  const prog = track.progression;
  const d = prog[((bar % prog.length) + prog.length) % prog.length]!;
  return [
    scaleNote(track.root, track.scale, d),
    scaleNote(track.root, track.scale, d + 2),
    scaleNote(track.root, track.scale, d + 4),
  ];
}

/** True when `midi` is a member of the track's scale (any octave). */
export function inScale(track: TrackDef, midi: number): boolean {
  const pc = (((midi - track.root) % 12) + 12) % 12;
  return track.scale.includes(pc);
}

function snapToRange(midi: number, lo: number, hi: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

const ARP_PATTERNS = [
  [0, 1, 2, 3],
  [0, 1, 2, 1],
  [2, 1, 0, 1],
  [0, 2, 1, 3],
  [3, 2, 1, 0],
] as const;

/**
 * Lead line of `bars` bars (16 steps each): MIDI note or −1 for rest. Seeded from
 * fnv1a32(track.id) so every playthrough of a race hears the same tune.
 */
export function generateLead(track: TrackDef, bars: number): number[] {
  const rng = new Rng(fnv1a32(track.id));
  const lo = track.root + track.leadOctave;
  const hi = lo + LEAD_RANGE;
  const notes = buildScale(lo, track.scale, 2);
  const out: number[] = [];
  let idx = Math.floor(notes.length / 3);
  for (let bar = 0; bar < bars; bar++) {
    const chord = chordTones(track, bar).map((m) => snapToRange(m + track.leadOctave, lo, hi - 12));
    const tones = [chord[0]!, chord[1]!, chord[2]!, chord[0]! + 12];
    if (track.leadStyle === "arp") {
      const pat = ARP_PATTERNS[rng.nextInt(ARP_PATTERNS.length)]!;
      const lift = rng.next() < 0.3 ? 12 : 0;
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const m = tones[pat[s % pat.length]!]! + (s >= 8 ? lift : 0);
        out.push(m <= hi ? m : m - 12);
      }
      continue;
    }
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      let play: boolean;
      if (track.leadStyle === "pad") {
        play = (s === 0 || s === 8) && rng.next() < track.leadDensity * 2.5;
      } else if (s % 2 === 0) {
        play = s % 4 === 0 ? rng.next() < track.leadDensity + 0.15 : rng.next() < track.leadDensity;
      } else {
        play = rng.next() < track.leadDensity * 0.25;
      }
      if (!play) {
        out.push(-1);
        continue;
      }
      if (s % 4 === 0 && rng.next() < 0.6) {
        const target = tones[rng.nextInt(3)]!;
        let best = 0;
        for (let k = 1; k < notes.length; k++) {
          if (Math.abs(notes[k]! - target) < Math.abs(notes[best]! - target)) best = k;
        }
        idx = best;
      } else {
        idx += rng.nextInt(5) - 2;
        if (idx < 0) idx = 1;
        if (idx >= notes.length) idx = notes.length - 2;
      }
      out.push(notes[idx]!);
    }
  }
  return out;
}

/** Bass line (MIDI or −1) of `bars` bars from the track's step pattern. */
export function generateBass(track: TrackDef, bars: number): number[] {
  const out: number[] = [];
  const drop = track.root >= 57 ? 24 : 12;
  const prog = track.progression;
  for (let bar = 0; bar < bars; bar++) {
    const d = prog[bar % prog.length]!;
    const root = scaleNote(track.root - drop, track.scale, d);
    let walk = 0;
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const c = track.bass[s] ?? ".";
      if (c === "x") out.push(root);
      else if (c === "o") out.push(scaleNote(track.root - drop, track.scale, d + 4));
      else if (c === "+") out.push(root + 12);
      else if (c === "w") {
        walk++;
        out.push(scaleNote(track.root - drop, track.scale, d + walk));
      } else out.push(-1);
    }
  }
  return out;
}

/** Duration of one 16th-note step in seconds. */
export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

/** Swing delay applied to odd 16th steps. */
export function swingDelay(step: number, track: Pick<TrackDef, "bpm" | "swing">): number {
  return step % 2 === 1 ? track.swing * stepDuration(track.bpm) : 0;
}
