import { describe, expect, it } from "vitest";
import {
  ARROW_KEYS,
  IJKL_KEYS,
  KeyboardSource,
  NUMPAD_KEYS,
  bindingsFor,
} from "../../../src/input/keyboard";

const DT = 1 / 120;
const S = Math.SQRT1_2;

function ticks(k: KeyboardSource, n: number) {
  let v = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) v = k.tick(DT);
  return v;
}

describe("KeyboardSource", () => {
  it("ramps magnitude over 0.12 s and caps at 1", () => {
    const k = new KeyboardSource(ARROW_KEYS);
    k.applyKeys(["ArrowRight"]);
    expect(k.tick(DT).x).toBeCloseTo(DT / 0.12, 12);
    expect(ticks(k, 6).x).toBeCloseTo(7 * (DT / 0.12), 12);
    expect(ticks(k, 20)).toEqual({ x: 1, y: 0 });
  });

  it("decays over 0.08 s in the last direction once released", () => {
    const k = new KeyboardSource(ARROW_KEYS);
    k.applyKeys(["ArrowUp"]);
    ticks(k, 30);
    k.applyKeys([]);
    const v = k.tick(DT);
    expect(v.x).toBe(0);
    expect(v.y).toBeCloseTo(-(1 - DT / 0.08), 12);
    expect(ticks(k, 10)).toEqual({ x: 0, y: 0 });
  });

  it("a short tap gives a small nudge", () => {
    const k = new KeyboardSource(ARROW_KEYS);
    k.keyDown("ArrowLeft");
    ticks(k, 3);
    k.keyUp("ArrowLeft");
    const v = k.tick(DT);
    expect(v.x).toBeLessThan(0);
    expect(v.x).toBeGreaterThan(-0.25);
  });

  it("normalizes diagonals", () => {
    const k = new KeyboardSource(ARROW_KEYS);
    k.applyKeys(["ArrowUp", "ArrowRight"]);
    const v = ticks(k, 30);
    expect(v.x).toBeCloseTo(S, 12);
    expect(v.y).toBeCloseTo(-S, 12);
  });

  it("opposing keys cancel and do not ramp", () => {
    const k = new KeyboardSource(ARROW_KEYS);
    k.applyKeys(["ArrowLeft", "ArrowRight"]);
    expect(ticks(k, 30)).toEqual({ x: 0, y: 0 });
    k.applyKeys(["ArrowLeft"]);
    expect(k.tick(DT).x).toBeCloseTo(-DT / 0.12, 12);
  });

  it("numpad gives eight directions", () => {
    const k = new KeyboardSource(NUMPAD_KEYS);
    k.applyKeys(["Numpad3"]);
    expect(k.direction()).toEqual({ x: S, y: S });
    k.applyKeys(["Numpad8"]);
    expect(k.direction()).toEqual({ x: 0, y: -1 });
    k.applyKeys(["Numpad5"]);
    expect(k.direction()).toEqual({ x: 0, y: 0 });
  });

  it("ignores unbound keys and reports bound ones", () => {
    const k = new KeyboardSource(IJKL_KEYS);
    expect(k.keyDown("ArrowUp")).toBe(false);
    expect(k.keyDown("KeyI")).toBe(true);
    expect(k.direction()).toEqual({ x: 0, y: -1 });
  });

  it("reset clears the ramp but keeps held keys", () => {
    const k = new KeyboardSource(ARROW_KEYS);
    k.applyKeys(["ArrowDown"]);
    ticks(k, 30);
    k.reset();
    expect(k.tick(DT).y).toBeCloseTo(DT / 0.12, 12);
  });
});

describe("bindingsFor", () => {
  it("ijkl: P1 gets arrows + numpad, plus WASD only in 1P", () => {
    expect(bindingsFor(0, 1, "ijkl")).toHaveProperty("KeyW");
    expect(bindingsFor(0, 1, "ijkl")).toHaveProperty("Numpad7");
    expect(bindingsFor(0, 2, "ijkl")).not.toHaveProperty("KeyW");
    expect(bindingsFor(1, 2, "ijkl")).toHaveProperty("KeyJ");
  });

  it("wasd: P2 uses WASD and P1 arrows only", () => {
    expect(bindingsFor(0, 1, "wasd")).not.toHaveProperty("KeyW");
    expect(bindingsFor(0, 2, "wasd")).toHaveProperty("ArrowUp");
    expect(bindingsFor(1, 2, "wasd")).toHaveProperty("KeyA");
    expect(bindingsFor(1, 2, "wasd")).not.toHaveProperty("KeyJ");
  });
});
