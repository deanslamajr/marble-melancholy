// Sim budget (§7.1): a 120 Hz tick must cost a small fraction of a 60 fps frame.
import { describe, expect, it } from "vitest";
import { runReplay } from "../../src/sim/replayRunner";
import { loadCore, manifest } from "../helpers";

describe("sim performance", () => {
  it("every race's replay runs far faster than real time", () => {
    for (const id of manifest().course) {
      const level = loadCore(id);
      runReplay(level, level.solution.runs);
      const t0 = performance.now();
      const r = runReplay(level, level.solution.runs);
      const ms = performance.now() - t0;
      expect(r.reached).toBe(true);
      const perTick = ms / r.ticks;
      // 0.25 ms per tick leaves >90% of a 16.7 ms frame (two ticks) for rendering.
      expect(perTick, `${id}: ${perTick.toFixed(4)} ms/tick`).toBeLessThan(0.25);
    }
  });

  it("a 2P Ultimate race steps 60 s of ticks within a second", async () => {
    const { RaceSim } = await import("../../src/sim/race");
    const { dequantize } = await import("../../src/sim/quantize");
    const sim = new RaceSim(loadCore("ultimate"), { players: 2 });
    const f = dequantize(20, 40);
    const t0 = performance.now();
    for (let i = 0; i < 60 * 120; i++) sim.step([f, f]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
