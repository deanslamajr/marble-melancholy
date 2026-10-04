// Marble physics on builder-produced fixtures (§7.2–7.5, §7.8).
import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, INPUT_MAX_SPEED, TICK_HZ } from "../../src/sim/constants";
import { fakeInput, idle, loadFixture, makeSim, place, run } from "../helpers";

const speed = (m: { vx: number; vy: number }) => Math.hypot(m.vx, m.vy);

describe("marble physics", () => {
  it("rests on flat ground with no input", () => {
    const sim = makeSim(loadFixture("fx-flat"));
    const m = sim.players[0]!.marble;
    const [x, y, z] = [m.x, m.y, m.z];
    idle(sim, 240);
    expect(m.x).toBeCloseTo(x, 6);
    expect(m.y).toBeCloseTo(y, 6);
    expect(m.z).toBeCloseTo(z, 6);
    expect(m.grounded).toBe(true);
  });

  it("accelerates toward the input and tops out near INPUT_MAX_SPEED", () => {
    const sim = makeSim(loadFixture("fx-muncher"));
    place(sim, 2.5, 2.5);
    run(sim, fakeInput(0, 1, 15));
    const m = sim.players[0]!.marble;
    expect(m.vy).toBeGreaterThan(1);
    expect(Math.abs(m.vx)).toBeLessThan(1e-9);
    run(sim, fakeInput(0, 1, 60));
    expect(speed(m)).toBeLessThanOrEqual(INPUT_MAX_SPEED + 0.05);
    expect(speed(m)).toBeGreaterThan(INPUT_MAX_SPEED * 0.6);
  });

  it("ice keeps momentum much longer than normal ground", () => {
    const coast = (id: string, y: number) => {
      const sim = makeSim(loadFixture(id));
      place(sim, 3.5, y);
      const m = sim.players[0]!.marble;
      m.vy = 2;
      idle(sim, 30);
      return m.y - y;
    };
    const ice = coast("fx-ice", 5.2);
    const normal = coast("fx-muncher", 5.2);
    expect(ice).toBeGreaterThan(normal * 1.3);
  });

  it("rails stop the marble at the slab edge", () => {
    const sim = makeSim(loadFixture("fx-walls"));
    place(sim, 2.5, 2.5);
    run(sim, fakeInput(-1, 0, 240));
    const m = sim.players[0]!.marble;
    expect(m.status).toBe("alive");
    expect(m.x).toBeGreaterThan(1);
    expect(m.x).toBeLessThan(2);
  });

  it("the inner wall blocks a straight run south", () => {
    const sim = makeSim(loadFixture("fx-walls"));
    place(sim, 3.5, 3.5);
    run(sim, fakeInput(0, 1, 240));
    expect(sim.players[0]!.marble.y).toBeLessThan(5);
  });

  it("acid dissolves the marble", () => {
    const sim = makeSim(loadFixture("fx-acid"));
    place(sim, 2.5, 7.5);
    const ev = idle(sim, 60);
    expect(ev).toContainEqual(expect.objectContaining({ t: "death", cause: "acid" }));
    expect(sim.players[0]!.deaths).toBe(1);
  });

  it("falling off an open edge kills, then respawns at the start after the delay", () => {
    const sim = makeSim(loadFixture("fx-ramp-gap"));
    const start = sim.level.start.p1;
    place(sim, 3.5, 8.4);
    const ev = run(sim, fakeInput(0, 0.5, 90)).concat(idle(sim, 6 * TICK_HZ));
    const death = ev.find((e) => e.t === "death");
    expect(death && "cause" in death && ["fall", "shatter"].includes(death.cause)).toBe(true);
    expect(ev.some((e) => e.t === "respawn")).toBe(true);
    const m = sim.players[0]!.marble;
    expect(Math.floor(m.x)).toBe(start[0]);
    expect(Math.floor(m.y)).toBe(start[1]);
  });

  it("speed strips push past the input speed cap", () => {
    const sim = makeSim(loadFixture("fx-speed"));
    place(sim, 3.5, 4.6);
    const ev = run(sim, fakeInput(0, 1, 60));
    expect(ev.some((e) => e.t === "speedStrip")).toBe(true);
    expect(sim.players[0]!.marble.vy).toBeGreaterThan(INPUT_MAX_SPEED);
  });

  it("marbles roll down slopes", () => {
    const sim = makeSim(loadFixture("fx-checkpoint"));
    place(sim, 3.5, 9.5);
    idle(sim, 30);
    expect(sim.players[0]!.marble.vy).toBeGreaterThan(0.3);
  });

  it("inverted slope gravity rolls marbles uphill (D34)", () => {
    const sim = makeSim(loadFixture("fx-inverted"));
    expect(sim.level.physics.slopeGravityScale).toBe(-1);
    place(sim, 3.5, 7.5);
    idle(sim, 30);
    // Slope N descends north; inverted gravity pushes the marble south (uphill).
    expect(sim.players[0]!.marble.vy).toBeGreaterThan(0.3);
  });

  it("two marbles clack off each other", () => {
    const sim = makeSim(loadFixture("fx-walls"), { players: 2 });
    const [a, b] = [sim.players[0]!.marble, sim.players[1]!.marble];
    a.x = 2.5;
    b.x = 4.5;
    a.y = b.y = 6.5;
    const ev: string[] = [];
    for (let i = 0; i < 120; i++) {
      for (const e of sim.step([
        { ax: 1, ay: 0 },
        { ax: -1, ay: 0 },
      ]))
        ev.push(e.t);
    }
    expect(ev).toContain("clack");
    expect(a.x).toBeLessThan(b.x);
  });
});

describe("race flow in the sim (§7.9)", () => {
  it("the countdown runs 360 ticks with 3-2-1 before GO; tick 0 starts after GO", () => {
    const sim = makeSim(loadFixture("fx-flat"), { countdown: true });
    const ev = idle(sim, COUNTDOWN_TICKS + 1);
    const counts = ev.filter((e) => e.t === "countdown").map((e) => ("n" in e ? e.n : -1));
    expect(counts).toEqual([3, 2, 1]);
    expect(ev.some((e) => e.t === "go")).toBe(true);
    expect(sim.tick).toBe(1);
  });

  it("reaching the goal finishes the player", () => {
    const level = loadFixture("fx-flat");
    const sim = makeSim(level);
    place(sim, level.goal.at[0] + 0.5, level.goal.at[1] + 0.5);
    const ev = idle(sim, 5);
    expect(ev).toContainEqual(expect.objectContaining({ t: "goal", player: 0 }));
    expect(sim.players[0]!.marble.status).toBe("finished");
    expect(sim.players[0]!.finishTick).toBeGreaterThanOrEqual(0);
  });

  it("running out of time eliminates the player", () => {
    const sim = makeSim(loadFixture("fx-flat"), { startTimeTicks: [60] });
    const ev = idle(sim, 62);
    expect(ev).toContainEqual(expect.objectContaining({ t: "timeout", player: 0 }));
    expect(sim.players[0]!.eliminated).toBe(true);
  });

  it("progress scoring rises as the marble descends the course", () => {
    const level = loadFixture("fx-checkpoint");
    const sim = makeSim(level);
    const before = sim.players[0]!.score;
    run(sim, fakeInput(0, 1, 120));
    expect(sim.players[0]!.score).toBeGreaterThan(before);
  });
});
