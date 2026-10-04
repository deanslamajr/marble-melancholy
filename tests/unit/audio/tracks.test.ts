import { describe, expect, it } from "vitest";
import { MUSIC_IDS } from "../../../src/level/types";
import {
  buildScale,
  chordTones,
  generateBass,
  generateLead,
  inScale,
  LEAD_RANGE,
  midiToHz,
  scaleNote,
  SCALES,
  stepDuration,
  swingDelay,
  TRACKS,
} from "../../../src/audio/music/tracks";
import { stepPosition } from "../../../src/audio/music/sequencer";
import { AudioEngine } from "../../../src/audio/AudioEngine";

const TABLE: Record<string, { bpm: number; root: number; scale: readonly number[] }> = {
  "m1-first-steps": { bpm: 92, root: 60, scale: SCALES.majorPentatonic },
  "m2-long-drop": { bpm: 112, root: 62, scale: SCALES.dorian },
  "m3-clockwork": { bpm: 124, root: 57, scale: SCALES.harmonicMinor },
  "m4-skyways": { bpm: 118, root: 65, scale: SCALES.lydian },
  "m5-upside": { bpm: 140, root: 67, scale: SCALES.wholeTone },
  "m6-last-ledge": { bpm: 150, root: 52, scale: SCALES.phrygian },
};

describe("music helpers", () => {
  it("midiToHz", () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 3);
  });

  it("buildScale and scaleNote", () => {
    expect(buildScale(60, SCALES.majorPentatonic)).toEqual([60, 62, 64, 67, 69, 72]);
    expect(buildScale(57, SCALES.harmonicMinor, 2)).toHaveLength(15);
    expect(scaleNote(60, SCALES.majorPentatonic, 5)).toBe(72);
    expect(scaleNote(60, SCALES.majorPentatonic, 7)).toBe(76);
  });

  it("step timing and swing", () => {
    expect(stepDuration(120)).toBeCloseTo(0.125);
    expect(swingDelay(0, { bpm: 120, swing: 0.25 })).toBe(0);
    expect(swingDelay(1, { bpm: 120, swing: 0.25 })).toBeCloseTo(0.03125);
    expect(stepPosition(TRACKS["m1-first-steps"], 16 * 8 + 17)).toEqual({ bar: 1, s: 1 });
  });
});

describe("TRACKS", () => {
  it("has exactly the six tracks from §7.12 with the table's tempo, root and scale", () => {
    expect(Object.keys(TRACKS).sort()).toEqual([...MUSIC_IDS].sort());
    for (const id of MUSIC_IDS) {
      const t = TRACKS[id];
      expect(t.id).toBe(id);
      expect(t.bpm).toBe(TABLE[id]!.bpm);
      expect(t.root).toBe(TABLE[id]!.root);
      expect([...t.scale]).toEqual([...TABLE[id]!.scale]);
      for (const p of [t.bass, t.kick, t.snare, t.hat]) expect(p).toMatch(/^[xo+w.]{16}$/);
      expect(t.progression.length).toBeGreaterThan(0);
      expect(t.swing).toBeGreaterThanOrEqual(0);
      expect(t.swing).toBeLessThanOrEqual(0.3);
    }
  });

  it("encodes the character column", () => {
    expect(TRACKS["m1-first-steps"].snare).not.toContain("x");
    expect(TRACKS["m1-first-steps"].waveforms.lead).toBe("triangle");
    expect(TRACKS["m2-long-drop"].waveforms.lead).toBe("square");
    expect(TRACKS["m2-long-drop"].bass).toContain("w");
    expect(TRACKS["m3-clockwork"].leadStyle).toBe("arp");
    expect(TRACKS["m3-clockwork"].swing).toBe(0);
    expect(TRACKS["m4-skyways"].highpass).toBeGreaterThan(0);
    expect(TRACKS["m4-skyways"].padGain).toBeGreaterThan(0);
    expect(TRACKS["m5-upside"].detune).toBe(18);
    expect(TRACKS["m5-upside"].swing).toBe(0.25);
    expect(TRACKS["m5-upside"].bassWobble).toBe(true);
    expect(TRACKS["m6-last-ledge"].waveforms.bass).toBe("sawtooth");
  });

  it("chord tones are scale members", () => {
    for (const id of MUSIC_IDS) {
      const t = TRACKS[id];
      for (let bar = 0; bar < t.bars; bar++) {
        for (const m of chordTones(t, bar)) expect(inScale(t, m)).toBe(true);
      }
    }
  });
});

describe("generateLead", () => {
  it("is deterministic per track and differs between tracks", () => {
    const seen = new Set<string>();
    for (const id of MUSIC_IDS) {
      const a = generateLead(TRACKS[id], 8);
      const b = generateLead(TRACKS[id], 8);
      expect(a).toEqual(b);
      seen.add(a.join(","));
    }
    expect(seen.size).toBe(MUSIC_IDS.length);
  });

  it("produces 16 steps per bar of in-scale, in-range notes or rests", () => {
    for (const id of MUSIC_IDS) {
      const t = TRACKS[id];
      const lead = generateLead(t, 8);
      expect(lead).toHaveLength(8 * 16);
      const lo = t.root + t.leadOctave;
      const notes = lead.filter((m) => m >= 0);
      expect(notes.length).toBeGreaterThan(0);
      for (const m of lead) {
        if (m === -1) continue;
        expect(Number.isInteger(m)).toBe(true);
        expect(m).toBeGreaterThanOrEqual(lo);
        expect(m).toBeLessThanOrEqual(lo + LEAD_RANGE);
        expect(inScale(t, m)).toBe(true);
      }
    }
  });

  it("arp tracks play every step; pad tracks are sparse", () => {
    expect(generateLead(TRACKS["m3-clockwork"], 4).every((m) => m >= 0)).toBe(true);
    const pad = generateLead(TRACKS["m4-skyways"], 8);
    expect(pad.filter((m) => m >= 0).length).toBeLessThanOrEqual(16);
  });
});

describe("generateBass", () => {
  it("follows the step pattern with in-scale notes", () => {
    for (const id of MUSIC_IDS) {
      const t = TRACKS[id];
      const bass = generateBass(t, t.bars);
      expect(bass).toHaveLength(t.bars * 16);
      bass.forEach((m, i) => {
        const c = t.bass[i % 16]!;
        if (c === ".") expect(m).toBe(-1);
        else {
          expect(inScale(t, m)).toBe(true);
          expect(m).toBeLessThan(t.root);
        }
      });
    }
  });
});

describe("AudioEngine without Web Audio", () => {
  it("never throws and stays locked", async () => {
    const a = new AudioEngine();
    expect(a.unlocked).toBe(false);
    await a.unlock();
    expect(a.unlocked).toBe(false);
    a.setVolumes({ master: 1, music: 0.5, sfx: 0.5 });
    a.handleEvents([{ t: "go" }, { t: "clack", player: 0, impact: 4 }]);
    a.updateFrame({ tick: 0, countdown: 0, players: [], entities: [], checkpointOwners: [] }, null);
    a.playUi("menuMove");
    a.startMusic("m1-first-steps", 0.4);
    a.stopMusic();
    a.silenceContinuous();
    a.suspend();
    a.resume();
  });
});
