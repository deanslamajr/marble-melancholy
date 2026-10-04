import { describe, expect, it } from "vitest";
import { clampToUnitDisk, datan2, dcos, dsin, mod, normalize, round4 } from "../../src/core/dmath";
import { EventBus } from "../../src/core/events";
import { FixedStepper } from "../../src/core/fixedStep";
import { canonicalJson, fnv1a32, Fnv, sha256Hex } from "../../src/core/hash";
import { Rng } from "../../src/core/rng";

describe("dmath (§7.1)", () => {
  const N = 10_000;

  it("dsin and dcos are within 1e-5 of Math on 10 000 points", () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const x = -50 + (100 * i) / N;
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("datan2 is within 1e-5 of Math.atan2 on 10 000 points", () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 0.001 + (i % 97) * 0.37;
      const y = r * Math.sin(a);
      const x = r * Math.cos(a);
      worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst).toBeLessThan(1e-5);
    expect(datan2(0, 0)).toBe(0);
  });

  it("helpers behave", () => {
    expect(mod(-1, 4)).toBe(3);
    expect(round4(1.23456789)).toBe(1.2346);
    const [nx, ny] = normalize(3, 4);
    expect(nx).toBeCloseTo(0.6);
    expect(ny).toBeCloseTo(0.8);
    const [cx, cy] = clampToUnitDisk(3, 4);
    expect(Math.hypot(cx, cy)).toBeCloseTo(1);
    expect(clampToUnitDisk(0.2, 0.1)).toEqual([0.2, 0.1]);
  });
});

describe("Rng (mulberry32)", () => {
  it("is deterministic per seed and in [0, 1)", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 100 }, () => a.next());
    const sb = Array.from({ length: 100 }, () => b.next());
    const sc = Array.from({ length: 100 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("matches the reference mulberry32 sequence", () => {
    // Reference values for seed 1 from the canonical mulberry32 implementation.
    const r = new Rng(1);
    expect(r.next()).toBeCloseTo(0.6270739405881613, 12);
    expect(r.next()).toBeCloseTo(0.002735721180215478, 12);
  });

  it("nextInt stays in range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(6);
      expect(Number.isInteger(v) && v >= 0 && v < 6).toBe(true);
    }
  });
});

describe("hashing", () => {
  it("canonicalJson sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("sha256Hex matches the FIPS 180 test vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("fnv1a32 and Fnv are deterministic and sensitive", () => {
    expect(fnv1a32("marble")).toBe(fnv1a32("marble"));
    expect(fnv1a32("marble")).not.toBe(fnv1a32("marblf"));
    const h1 = new Fnv().int(1).fixed(0.5).h;
    const h2 = new Fnv().int(1).fixed(0.5).h;
    const h3 = new Fnv().int(1).fixed(0.501).h;
    // Sub-1/4096 differences are below the fixed-point resolution and hash identically.
    const h4 = new Fnv().int(1).fixed(0.50001).h;
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toBe(h4);
  });
});

describe("FixedStepper (§3.3)", () => {
  it("accumulates real time into 120 Hz steps with alpha", () => {
    const s = new FixedStepper(120, 8);
    expect(s.advance(1 / 60).steps).toBe(2);
    const r = s.advance(1 / 240);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeCloseTo(0.5, 5);
  });

  it("caps steps per frame and drops the backlog", () => {
    const s = new FixedStepper(120, 8);
    const r = s.advance(0.2);
    expect(r.steps).toBe(8);
    expect(r.alpha).toBe(0);
    expect(s.advance(0).steps).toBe(0);
  });
});

describe("EventBus", () => {
  it("delivers to subscribers until unsubscribed", () => {
    const bus = new EventBus<number>();
    const got: number[] = [];
    const off = bus.on((n) => got.push(n));
    bus.emit(1);
    off();
    bus.emit(2);
    expect(got).toEqual([1]);
  });
});
