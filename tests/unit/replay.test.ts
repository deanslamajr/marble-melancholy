import { describe, expect, it } from "vitest";
import {
  decodeRuns,
  encodeRuns,
  RunCursor,
  RunEncoder,
  runsLength,
  runsWellFormed,
} from "../../src/level/solution/replay";
import { scriptToInputs } from "../../src/level/solution/script";
import { dequantize, quantizeAxis, quantizeInput, quantizeInt } from "../../src/sim/quantize";

describe("input quantization (§7.6)", () => {
  it("maps [-1, 1] to int8 steps and clamps", () => {
    expect(quantizeAxis(1)).toBe(127);
    expect(quantizeAxis(-1)).toBe(-127);
    expect(quantizeAxis(2)).toBe(127);
    expect(quantizeAxis(0.5)).toBe(64);
  });

  it("keeps quantized vectors inside the unit disk", () => {
    for (let a = 0; a < 360; a += 3) {
      const r = (a * Math.PI) / 180;
      const [qx, qy] = quantizeInt(Math.cos(r) * 1.5, Math.sin(r) * 1.5);
      expect(qx * qx + qy * qy).toBeLessThanOrEqual(127 * 127);
    }
  });

  it("quantizeInput is idempotent", () => {
    const a = quantizeInput(0.31, -0.77);
    const b = quantizeInput(a.ax, a.ay);
    expect(b).toEqual(a);
    expect(dequantize(127, 0)).toEqual({ ax: 1, ay: 0 });
  });
});

describe("replay RLE (§5.5)", () => {
  const inputs: Array<[number, number]> = [
    [0, 0],
    [0, 0],
    [127, 0],
    [127, 0],
    [127, 0],
    [-5, 9],
  ];

  it("round-trips", () => {
    const runs = encodeRuns(inputs);
    expect(runs).toEqual([2, 0, 0, 3, 127, 0, 1, -5, 9]);
    expect(decodeRuns(runs)).toEqual(inputs);
    expect(runsLength(runs)).toBe(6);
  });

  it("RunEncoder merges equal neighbours and RunCursor replays them", () => {
    const enc = new RunEncoder();
    for (const [x, y] of inputs) enc.push(x, y);
    expect(enc.length).toBe(6);
    const cur = new RunCursor(enc.runs);
    const out: Array<[number, number]> = [];
    for (let v = cur.next(); v; v = cur.next()) out.push(v);
    expect(out).toEqual(inputs);
  });

  it("rejects malformed runs", () => {
    expect(runsWellFormed([1, 0, 0])).toBe(true);
    expect(runsWellFormed([1, 0])).toBe(false);
    expect(runsWellFormed([0, 0, 0])).toBe(false);
    expect(runsWellFormed([1, 200, 0])).toBe(false);
    expect(runsWellFormed([1.5, 0, 0])).toBe(false);
  });

  it("scripts expand to quantized inputs", () => {
    const xs = scriptToInputs([
      { ticks: 2, dir: [1, 0] },
      { ticks: 1, dir: [0, -1] },
    ]);
    expect(xs).toEqual([
      [127, 0],
      [127, 0],
      [0, -127],
    ]);
  });
});
