// Determinism contract (§7.1): same level + inputs → same hash on every tick.
import { describe, expect, it } from "vitest";
import { decodeRuns } from "../../src/level/solution/replay";
import { runReplay } from "../../src/sim/replayRunner";
import { dequantize } from "../../src/sim/quantize";
import { RaceSim } from "../../src/sim/race";
import { loadCore, loadFixture, manifest } from "../helpers";

describe("determinism", () => {
  for (const id of manifest().course) {
    it(`${id}: two runs agree tick-by-tick and match the stamped hash`, () => {
      const level = loadCore(id);
      const inputs = decodeRuns(level.solution.runs);
      const a = new RaceSim(level, { players: 1 });
      const b = new RaceSim(level, { players: 1 });
      for (let t = 0; t < inputs.length; t++) {
        const f = dequantize(...inputs[t]!);
        a.step([f]);
        b.step([f]);
        if (t % 97 === 0) expect(a.hash()).toBe(b.hash());
      }
      expect(a.hash()).toBe(b.hash());
      const r = runReplay(level, level.solution.runs);
      expect(r.reached).toBe(true);
      expect(r.ticks).toBe(level.solution.ticks);
      expect(r.stateHash).toBe(level.solution.stateHash);
    });
  }

  it("2P races with identical inputs stay in lock-step", () => {
    const level = loadFixture("fx-ramp-gap");
    const inputs = decodeRuns(level.solution.runs);
    const run = () => {
      const sim = new RaceSim(level, { players: 2 });
      for (const q of inputs) {
        const f = dequantize(...q);
        sim.step([f, f]);
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });

  it("the hash changes when a single input differs", () => {
    const level = loadFixture("fx-flat");
    const inputs = decodeRuns(level.solution.runs);
    const go = (tweak: boolean) => {
      const sim = new RaceSim(level, { players: 1 });
      inputs.forEach((q, i) => sim.step([dequantize(q[0] + (tweak && i === 10 ? 1 : 0), q[1])]));
      return sim.hash();
    };
    expect(go(false)).not.toBe(go(true));
  });
});
