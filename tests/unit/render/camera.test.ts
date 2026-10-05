import { describe, expect, it } from "vitest";
import type { PlayerSnapshot, SimSnapshot } from "../../../src/sim/types";
import {
  CAM_LEAVE_BEHIND_TICKS,
  Camera,
  fit2P,
  LeaveBehindRule,
  trailingPlayer,
} from "../../../src/render/camera";
import { project } from "../../../src/render/iso";

const BIG = { minSx: -5000, minSy: -5000, maxSx: 5000, maxSy: 5000 };

function player(index: 0 | 1, over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    index,
    x: 10,
    y: 10,
    z: 2,
    vx: 0,
    vy: 0,
    vz: 0,
    status: "alive",
    deathCause: null,
    statusTicks: 0,
    rollPhase: 0,
    grounded: true,
    groundZ: 2,
    eliminated: false,
    timeTicks: 3600,
    score: 0,
    deaths: 0,
    activeCheckpoint: -1,
    progressBest: 0,
    ...over,
  };
}

function snap(players: PlayerSnapshot[]): SimSnapshot {
  return { tick: 0, countdown: 0, players, entities: [], checkpointOwners: [] };
}

function run(cam: Camera, s: SimSnapshot, frames: number, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) cam.update(s, dt);
}

describe("Camera 1P", () => {
  it("snapTo centres on the marble", () => {
    const cam = new Camera(BIG);
    cam.snapTo(snap([player(0)]));
    const p = project(10, 10, 2);
    expect(cam.cx).toBeCloseTo(p.sx);
    expect(cam.cy).toBeCloseTo(p.sy);
    expect(cam.zoom).toBe(1);
  });

  it("follows with exponential smoothing and a clamped velocity lead", () => {
    const cam = new Camera(BIG);
    cam.snapTo(snap([player(0)]));
    const moving = snap([player(0, { x: 20, y: 10, vx: 14, vy: 0 })]);
    const first = cam.cx;
    cam.update(moving, 1 / 60);
    const target = project(20, 10, 2);
    const k = 1 - Math.exp(-1 / 60 / 0.15);
    // Lead = project(14, 0, 0) * 0.25 = (112, 56), length ≈ 125 → clamped to 120.
    const lead = { x: 112, y: 56 };
    const l = Math.hypot(lead.x, lead.y);
    const tx = target.sx + (lead.x * 120) / l;
    expect(cam.cx).toBeCloseTo(first + (tx - first) * k, 6);
    run(cam, moving, 300);
    expect(cam.cx).toBeCloseTo(tx, 3);
  });

  it("holds the death position while dying/waiting, then recovers", () => {
    const cam = new Camera(BIG);
    cam.snapTo(snap([player(0)]));
    run(cam, snap([player(0, { status: "dying" })]), 5);
    const held = { cx: cam.cx, cy: cam.cy };
    run(cam, snap([player(0, { status: "waiting", x: 2, y: 2 })]), 60);
    expect(cam.cx).toBeCloseTo(held.cx, 3);
    expect(cam.cy).toBeCloseTo(held.cy, 3);
    // Respawned far away: slower (0.3 s) time constant than normal follow (0.15 s).
    const respawned = snap([player(0, { x: 2, y: 2 })]);
    const before = cam.cy;
    cam.update(respawned, 1 / 60);
    const target = project(2, 2, 2).sy;
    const kSlow = 1 - Math.exp(-1 / 60 / 0.3);
    expect(cam.cy).toBeCloseTo(before + (target - before) * kSlow, 6);
  });

  it("centres a level smaller than the viewport and clamps large ones", () => {
    const small = { minSx: -100, minSy: -50, maxSx: 100, maxSy: 50 };
    const cam = new Camera(small);
    cam.snapTo(snap([player(0, { x: 30, y: 0 })]));
    expect(cam.cx).toBe(0);
    expect(cam.cy).toBe(0);

    const wide = { minSx: 0, minSy: 0, maxSx: 4000, maxSy: 4000 };
    const cam2 = new Camera(wide);
    cam2.snapTo(snap([player(0, { x: 0, y: 0, z: 0 })]));
    expect(cam2.cx).toBe(-96 + 480);
    expect(cam2.cy).toBe(-96 + 270);
  });

  it("clamps against the visible view and stays centred on the marble away from edges", () => {
    const wide = { minSx: 0, minSy: 0, maxSx: 4000, maxSy: 4000 };
    const cam = new Camera(wide);
    cam.setView(1296, 540);
    cam.snapTo(snap([player(0, { x: 0, y: 0, z: 0 })]));
    expect(cam.cx).toBe(-96 + 648);
    expect(cam.cy).toBe(-96 + 270);

    const mid = snap([player(0, { x: 60, y: 20, z: 0 })]);
    const p = project(60, 20, 0);
    for (const [w, h] of [
      [960, 540],
      [1296, 540],
      [960, 1280],
    ]) {
      const c = new Camera(wide);
      c.setView(w!, h!);
      c.snapTo(mid);
      expect(c.cx).toBeCloseTo(p.sx);
      expect(c.cy).toBeCloseTo(p.sy);
    }
  });

  it("free mode ignores marbles; pan and zoomAt keep the anchor point fixed", () => {
    const cam = new Camera(BIG);
    cam.snapTo(snap([player(0)]));
    cam.free = true;
    const { cx, cy } = cam;
    cam.update(snap([player(0, { x: 40, y: 40 })]), 1);
    expect(cam.cx).toBe(cx);
    cam.pan(10, -20);
    expect(cam.cx).toBeCloseTo(cx - 10);
    expect(cam.cy).toBeCloseTo(cy + 20);
    const X = 700;
    const Y = 100;
    const before = { sx: (X - 480) / cam.zoom + cam.cx, sy: (Y - 270) / cam.zoom + cam.cy };
    cam.zoomAt(1.5, X, Y);
    expect(cam.zoom).toBeCloseTo(1.5);
    expect((X - 480) / cam.zoom + cam.cx).toBeCloseTo(before.sx);
    expect((Y - 270) / cam.zoom + cam.cy).toBeCloseTo(before.sy);
  });
});

describe("Camera 2P", () => {
  it("frames the midpoint and zooms out to fit", () => {
    const cam = new Camera(BIG);
    const s = snap([player(0, { x: 10, y: 10 }), player(1, { x: 18, y: 10 })]);
    cam.snapTo(s);
    const a = project(10, 10, 2);
    const b = project(18, 10, 2);
    expect(cam.cx).toBeCloseTo((a.sx + b.sx) / 2);
    const reqW = Math.abs(a.sx - b.sx) + 320;
    const reqH = Math.abs(a.sy - b.sy) + 240;
    expect(cam.zoom).toBeCloseTo(Math.min(1, Math.max(0.6, Math.min(960 / reqW, 540 / reqH))));
  });

  it("ignores dead marbles in the framing set", () => {
    const cam = new Camera(BIG);
    cam.snapTo(snap([player(0, { x: 10, y: 10 }), player(1, { x: 40, y: 10, status: "dying" })]));
    const a = project(10, 10, 2);
    expect(cam.cx).toBeCloseTo(a.sx);
    expect(cam.zoom).toBe(1);
  });

  it("keeps the zoom at or above the 2P minimum when the pair does not fit", () => {
    const cam = new Camera(BIG);
    const s = snap([player(0, { x: 5, y: 5 }), player(1, { x: 40, y: 40 })]);
    cam.snapTo(s);
    run(cam, s, 60);
    expect(cam.zoom).toBeCloseTo(0.6, 9);
  });

  it("frames the same pair identically on every visible view size", () => {
    const s = snap([player(0, { x: 10, y: 10 }), player(1, { x: 22, y: 10 })]);
    const frames = [
      [960, 540],
      [1296, 540],
      [960, 600],
      [960, 1280],
    ].map(([w, h]) => {
      const cam = new Camera(BIG);
      cam.setView(w!, h!);
      cam.snapTo(s);
      run(cam, s, 30);
      return { cx: cam.cx, cy: cam.cy, zoom: cam.zoom };
    });
    for (const f of frames) expect(f).toEqual(frames[0]);
  });
});

describe("2P fit and left-behind rule", () => {
  const far = snap([
    player(0, { x: 5, y: 5, progressBest: 300 }),
    player(1, { x: 40, y: 40, progressBest: 700 }),
  ]);
  const near = snap([player(0, { x: 5, y: 5 }), player(1, { x: 6, y: 5 })]);

  function ticks(rule: LeaveBehindRule, s: SimSnapshot, n: number): (number | null)[] {
    const out: (number | null)[] = [];
    for (let i = 0; i < n; i++) out.push(rule.tick(s));
    return out;
  }

  it("measures the fit against the fixed 960×540 box", () => {
    const a = project(5, 5, 2);
    const b = project(40, 40, 2);
    const reqW = Math.abs(a.sx - b.sx) + 320;
    const reqH = Math.abs(a.sy - b.sy) + 240;
    expect(fit2P(far)).toBeCloseTo(Math.min(960 / reqW, 540 / reqH), 12);
    expect(fit2P(snap([player(0), player(1, { status: "dying" })]))).toBeNull();
    expect(fit2P(snap([player(0)]))).toBeNull();
  });

  it("is independent of the visible view size", () => {
    const pairs = [far, near, snap([player(0, { x: 3, y: 9 }), player(1, { x: 21, y: 4, z: 6 })])];
    const base = pairs.map((s) => fit2P(s));
    for (const [w, h] of [
      [1296, 540],
      [1152, 540],
      [960, 600],
      [960, 1280],
    ]) {
      const cam = new Camera(BIG);
      cam.setView(w!, h!);
      for (const s of pairs) {
        cam.snapTo(s);
        run(cam, s, 5);
      }
      expect(pairs.map((s) => fit2P(s))).toEqual(base);
      const rule = new LeaveBehindRule();
      expect(ticks(rule, far, CAM_LEAVE_BEHIND_TICKS).at(-1)).toBe(0);
    }
  });

  it("reports the trailing player after 60 consecutive unfit ticks (0.5 s), then resets", () => {
    expect(CAM_LEAVE_BEHIND_TICKS).toBe(60);
    const rule = new LeaveBehindRule();
    const results = ticks(rule, far, 120);
    expect(results.slice(0, 59).every((r) => r === null)).toBe(true);
    expect(results[59]).toBe(0);
    expect(results.slice(60, 119).every((r) => r === null)).toBe(true);
    expect(results[119]).toBe(0);
  });

  it("resets the counter when the pair fits again or on reset()", () => {
    const rule = new LeaveBehindRule();
    expect(ticks(rule, far, 40).every((r) => r === null)).toBe(true);
    rule.tick(near);
    expect(ticks(rule, far, 59).every((r) => r === null)).toBe(true);
    rule.reset();
    expect(ticks(rule, far, 59).every((r) => r === null)).toBe(true);
    expect(rule.tick(far)).toBe(0);
  });
});

describe("trailingPlayer", () => {
  it("picks the alive player with lower progress, tie → higher index", () => {
    expect(
      trailingPlayer(snap([player(0, { progressBest: 100 }), player(1, { progressBest: 50 })])),
    ).toBe(1);
    expect(
      trailingPlayer(snap([player(0, { progressBest: 50 }), player(1, { progressBest: 50 })])),
    ).toBe(1);
    expect(
      trailingPlayer(
        snap([player(0, { progressBest: 10 }), player(1, { progressBest: 50, status: "dying" })]),
      ),
    ).toBe(0);
  });
});
