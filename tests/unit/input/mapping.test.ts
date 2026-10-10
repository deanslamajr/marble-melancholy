import { describe, expect, it } from "vitest";
import {
  clampDisk,
  keyboardToWorld,
  largestMagnitude,
  magnitude,
  radialDeadzone,
  screenToWorld,
  toInputFrame,
  worldToScreen,
} from "../../../src/input/mapping";
import { MouseSource } from "../../../src/input/mouse";
import { GamepadSource, type PadLike } from "../../../src/input/gamepad";
import {
  TOUCH_RADIUS_MAX_PX,
  TOUCH_RADIUS_MIN_PX,
  TouchStickSource,
  touchRadiusFor,
} from "../../../src/input/touch";
import { InputManager } from "../../../src/input/InputManager";
import { quantizeInput } from "../../../src/sim/quantize";

const S = Math.SQRT1_2;

describe("screenToWorld", () => {
  it("maps screen up to world (-0.707, -0.707)", () => {
    const w = screenToWorld(0, -1);
    expect(w.x).toBeCloseTo(-S, 12);
    expect(w.y).toBeCloseTo(-S, 12);
  });

  it("maps screen right to world (0.707, -0.707)", () => {
    const w = screenToWorld(1, 0);
    expect(w.x).toBeCloseTo(S, 12);
    expect(w.y).toBeCloseTo(-S, 12);
  });

  it("preserves magnitude and inverts with worldToScreen", () => {
    const w = screenToWorld(0.3, -0.8);
    expect(magnitude(w)).toBeCloseTo(Math.sqrt(0.09 + 0.64), 12);
    const s = worldToScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(0.3, 12);
    expect(s.y).toBeCloseTo(-0.8, 12);
  });

  it("keyboard world mapping bypasses rotation", () => {
    expect(keyboardToWorld({ x: 0, y: -1 }, "world")).toEqual({ x: 0, y: -1 });
    const r = keyboardToWorld({ x: 0, y: -1 }, "screen");
    expect(r.x).toBeCloseTo(-S, 12);
  });
});

describe("helpers", () => {
  it("clampDisk limits magnitude to 1", () => {
    expect(magnitude(clampDisk(3, 4))).toBeCloseTo(1, 12);
    expect(clampDisk(0.2, 0.1)).toEqual({ x: 0.2, y: 0.1 });
  });

  it("radialDeadzone zeroes inside and rescales outside", () => {
    expect(radialDeadzone(0.1, 0.1, 0.15)).toEqual({ x: 0, y: 0 });
    const v = radialDeadzone(0.575, 0, 0.15);
    expect(v.x).toBeCloseTo(0.5, 12);
    expect(magnitude(radialDeadzone(1, 1, 0.15))).toBeCloseTo(1, 12);
  });

  it("largestMagnitude picks the biggest vector", () => {
    expect(
      largestMagnitude([
        { x: 0.1, y: 0 },
        { x: 0, y: -0.5 },
        { x: 0.2, y: 0.2 },
      ]),
    ).toEqual({
      x: 0,
      y: -0.5,
    });
    expect(largestMagnitude([])).toEqual({ x: 0, y: 0 });
  });

  it("toInputFrame quantizes to 1/127 inside the unit disk", () => {
    const f = toInputFrame(screenToWorld(1, 0));
    expect(Number.isInteger(f.ax * 127)).toBe(true);
    expect(Number.isInteger(Math.round(f.ay * 127))).toBe(true);
    expect(f.ax * f.ax + f.ay * f.ay).toBeLessThanOrEqual(1);
  });
});

describe("MouseSource", () => {
  it("applies the trackball model and decays to zero", () => {
    const m = new MouseSource();
    m.feed(5, 0);
    const a = m.tick();
    expect(a.x).toBeCloseTo(0.45 * 5 * 0.12, 12);
    expect(a.y).toBe(0);
    const b = m.tick();
    expect(b.x).toBeCloseTo(0.55 * a.x, 12);
    let v = b;
    for (let i = 0; i < 20; i++) v = m.tick();
    expect(v).toEqual({ x: 0, y: 0 });
  });

  it("scales with sensitivity and clamps to the unit disk", () => {
    const m = new MouseSource();
    m.sensitivity = 2;
    m.feed(100, 100);
    expect(magnitude(m.tick())).toBeCloseTo(1, 12);
  });

  it("zeroes tiny movement", () => {
    const m = new MouseSource();
    m.feed(0.3, 0);
    expect(m.tick()).toEqual({ x: 0, y: 0 });
  });

  it("absolute mode maps cursor offset / 160", () => {
    const m = new MouseSource();
    m.absoluteMode = true;
    expect(m.tick()).toEqual({ x: 0, y: 0 });
    m.setCursor({ x: 80, y: 0 });
    expect(m.tick()).toEqual({ x: 0.5, y: 0 });
    m.setCursor({ x: 0, y: 1000 });
    expect(m.tick()).toEqual({ x: 0, y: 1 });
  });
});

function pad(axes: number[], pressed: number[] = []): PadLike {
  return {
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  };
}

describe("GamepadSource", () => {
  it("applies the dead zone and orders pads by connection", () => {
    let pads: (PadLike | null)[] = [null, pad([0.1, 0]), pad([1, 0])];
    const g = new GamepadSource(() => pads);
    g.update();
    expect(g.count).toBe(2);
    expect(g.stick(0)).toEqual({ x: 0, y: 0 });
    expect(g.stick(1).x).toBeCloseTo(1, 12);
    expect(g.anyStick().x).toBeCloseTo(1, 12);
    pads = [];
    g.update();
    expect(g.stick(0)).toEqual({ x: 0, y: 0 });
  });

  it("emits edge-triggered buttons and stick flicks", () => {
    let p = pad([0, 0]);
    const g = new GamepadSource(() => [p]);
    expect(g.pollButtons()).toEqual([]);
    p = pad([0, 0], [0, 12]);
    expect(g.pollButtons()).toEqual([
      { pad: 0, button: "confirm" },
      { pad: 0, button: "up" },
    ]);
    expect(g.pollButtons()).toEqual([]);
    p = pad([0, 0.9]);
    expect(g.pollButtons()).toEqual([{ pad: 0, button: "down" }]);
    p = pad([0, 0.5]);
    expect(g.pollButtons()).toEqual([]);
    p = pad([0, 0]);
    g.pollButtons();
    p = pad([-0.8, 0], [9]);
    expect(g.pollButtons()).toEqual([
      { pad: 0, button: "pause" },
      { pad: 0, button: "left" },
    ]);
  });
});

describe("TouchStickSource", () => {
  it("runs the floating stick state machine", () => {
    const t = new TouchStickSource();
    const states: boolean[] = [];
    const unsub = t.subscribe((s) => states.push(s.active));
    t.start(1, 100, 200);
    expect(t.state).toMatchObject({ active: true, originX: 100, originY: 200 });
    t.move(1, 105, 200);
    expect(t.tick()).toEqual({ x: 0, y: 0 });
    t.move(1, 130, 200);
    expect(t.tick()).toEqual({ x: 0.5, y: 0 });
    t.move(1, 100, 400);
    expect(t.state.knobY).toBe(60);
    expect(t.tick()).toEqual({ x: 0, y: 1 });
    t.end(1);
    expect(t.state.active).toBe(false);
    expect(t.tick()).toEqual({ x: 0, y: 0 });
    unsub();
    expect(states).toEqual([false, true, true, true, true, false]);
  });

  it("starts the stick anywhere, including the right-hand side", () => {
    const t = new TouchStickSource();
    t.start(1, 950, 300);
    expect(t.state).toMatchObject({ active: true, originX: 950, originY: 300 });
    t.move(1, 950, 360);
    expect(t.tick()).toEqual({ x: 0, y: 1 });
    t.end(1);
    // A second finger never takes the stick over, and lifting it leaves the stick alone.
    t.start(2, 100, 100);
    t.start(3, 900, 100);
    expect(t.state.originX).toBe(100);
    t.end(3);
    expect(t.state.active).toBe(true);
    t.end(2);
    expect(t.state.active).toBe(false);
  });

  it("scales the stick radius with the stage within limits", () => {
    expect(touchRadiusFor(734, 343)).toBe(45);
    expect(touchRadiusFor(393, 524)).toBe(51);
    expect(touchRadiusFor(200, 150)).toBe(TOUCH_RADIUS_MIN_PX);
    expect(touchRadiusFor(2560, 1440)).toBe(TOUCH_RADIUS_MAX_PX);
    const t = new TouchStickSource();
    t.radius = 40;
    t.start(1, 100, 100);
    t.radius = 90;
    t.move(1, 100, 300);
    expect(t.state).toMatchObject({ radius: 40, knobY: 40 });
    expect(t.tick()).toEqual({ x: 0, y: 1 });
    t.move(1, 100, 105);
    expect(t.tick()).toEqual({ x: 0, y: 0 });
    t.move(1, 120, 100);
    expect(t.tick()).toEqual({ x: 0.5, y: 0 });
  });

  it("ignores touches while disabled and releases the stick on disable", () => {
    const t = new TouchStickSource();
    t.start(1, 100, 100);
    t.enabled = false;
    expect(t.state.active).toBe(false);
    t.start(2, 100, 100);
    expect(t.state.active).toBe(false);
    t.enabled = true;
    t.start(3, 100, 100);
    expect(t.state.active).toBe(true);
  });
});

describe("InputManager (no DOM)", () => {
  const settings = {
    mouseSensitivity: 1,
    keyboardMapping: "screen" as const,
    p2Keys: "ijkl" as const,
  };

  it("returns injected frames quantized", () => {
    const im = new InputManager(settings, () => []);
    im.setInjected(0, { ax: 0.5, ay: -0.25 });
    const f = im.sample(0);
    expect(f.ax).toBe(Math.round(0.5 * 127) / 127);
    expect(f.ay).toBe(Math.round(-0.25 * 127) / 127);
    im.setInjected(0, null);
    expect(im.sample(0)).toEqual({ ax: 0, ay: 0 });
  });

  it("merges devices by largest magnitude and rotates screen sticks", () => {
    const im = new InputManager(settings, () => [pad([0, -1])]);
    im.mouse.feed(1, 0);
    expect(im.sample(0)).toEqual(quantizeInput(-S, -S));
  });

  it("assigns pads per player in 2P and any pad to P1 in 1P", () => {
    const pads = [pad([0, 0]), pad([1, 0])];
    const im = new InputManager(settings, () => pads);
    expect(im.sample(0).ax).toBeGreaterThan(0.5);
    im.setPlayers(2);
    expect(im.sample(0)).toEqual({ ax: 0, ay: 0 });
    expect(im.sample(1).ax).toBeGreaterThan(0.5);
  });

  it("gamepad pause during sample fires onPauseRequest", () => {
    let p = pad([0, 0]);
    const im = new InputManager(settings, () => [p]);
    let pauses = 0;
    im.onPauseRequest = () => pauses++;
    im.sample(0);
    p = pad([0, 0], [9]);
    im.sample(0);
    im.sample(0);
    expect(pauses).toBe(1);
  });

  it("a quick, still tap anywhere steers and never pauses (I14)", () => {
    const im = new InputManager(settings, () => []);
    let pauses = 0;
    im.onPauseRequest = () => pauses++;
    for (const x of [100, 500, 900]) {
      im.touch.start(1, x, 100);
      expect(im.touch.state).toMatchObject({ active: true, originX: x });
      im.sample(0);
      im.touch.end(1);
      im.sample(0);
    }
    expect(im.touch.state.active).toBe(false);
    expect(pauses).toBe(0);
  });
});
