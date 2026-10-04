// Entity behaviour on the one-per-mechanic fixtures (§7.10).
import { describe, expect, it } from "vitest";
import { TICK_HZ } from "../../src/sim/constants";
import type { EntitySnapshot, SimEvent } from "../../src/sim/types";
import { idle, loadFixture, makeSim, place } from "../helpers";

const deaths = (ev: SimEvent[]) =>
  ev.flatMap((e) => (e.t === "death" ? [e.cause] : [])) as string[];

describe("entities", () => {
  it("a hammer flattens a marble parked under it", () => {
    const sim = makeSim(loadFixture("fx-hammer"));
    place(sim, 7.5, 7.5);
    const ev = idle(sim, 3 * TICK_HZ);
    expect(ev.some((e) => e.t === "hammerDown")).toBe(true);
    expect(deaths(ev)).toContain("hammer");
  });

  it("a muncher lunges at a marble in range and eats it", () => {
    const sim = makeSim(loadFixture("fx-muncher"));
    place(sim, 7.5, 7.4);
    const ev = idle(sim, 2 * TICK_HZ);
    expect(ev.some((e) => e.t === "munchLunge")).toBe(true);
    expect(deaths(ev)).toContain("munch");
  });

  it("a hoover pulls a nearby marble toward its nozzle", () => {
    // Pull fades to zero at pullRadius; from rest it beats rolling friction only well inside it.
    const sim = makeSim(loadFixture("fx-hoover"));
    place(sim, 8.2, 8.5);
    const x0 = sim.players[0]!.marble.x;
    const ev = idle(sim, 60);
    const m = sim.players[0]!.marble;
    expect(m.x > x0 + 0.2 || deaths(ev).includes("hoover")).toBe(true);
  });

  it("a catapult winds up and launches the marble", () => {
    const sim = makeSim(loadFixture("fx-catapult"));
    place(sim, 3.5, 6.5);
    const ev = idle(sim, 60);
    expect(ev.some((e) => e.t === "catapult")).toBe(true);
    const m = sim.players[0]!.marble;
    expect(m.z).toBeGreaterThan(5);
    expect(m.vy).toBeGreaterThan(0);
  });

  it("a pipe carries the marble from entry to exit", () => {
    const level = loadFixture("fx-pipe");
    const sim = makeSim(level);
    place(sim, 3.5, 5.5);
    const ev = idle(sim, 3 * TICK_HZ);
    const kinds = ev.map((e) => e.t);
    expect(kinds).toContain("pipeEnter");
    expect(kinds).toContain("pipeExit");
    expect(kinds.indexOf("pipeEnter")).toBeLessThan(kinds.indexOf("pipeExit"));
    expect(sim.players[0]!.marble.y).toBeGreaterThan(11);
  });

  it("a funnel swallows the marble and ejects it at its exit", () => {
    const sim = makeSim(loadFixture("fx-funnel"));
    place(sim, 4.5, 6.6);
    const ev = idle(sim, 4 * TICK_HZ);
    expect(ev.some((e) => e.t === "funnelEnter")).toBe(true);
    expect(sim.players[0]!.marble.y).toBeGreaterThan(12);
  });

  it("a moving platform travels along its path and carries ground with it", () => {
    const sim = makeSim(loadFixture("fx-platform"));
    const at0 = posOf(sim.snapshot().entities[0]);
    expect(sim.terrain.groundAt(4, 7, sim.tick)?.carrier).toBeTruthy();
    idle(sim, 3 * TICK_HZ);
    const at1 = posOf(sim.snapshot().entities[0]);
    expect(at1.y).toBeGreaterThan(at0.y + 1);
  });

  it("a wave floor rises and falls over time", () => {
    const sim = makeSim(loadFixture("fx-wave"));
    const zs = new Set<number>();
    for (let i = 0; i < 60; i++) {
      zs.add(Math.round((sim.terrain.groundAt(3.5, 7.5, sim.tick)?.z ?? 0) * 100));
      idle(sim, 1);
    }
    expect(zs.size).toBeGreaterThan(5);
  });

  it("a patrolling steelie walks its path", () => {
    const sim = makeSim(loadFixture("fx-steelie"));
    const y0 = posOf(sim.snapshot().entities[0]).y;
    idle(sim, 2 * TICK_HZ);
    expect(posOf(sim.snapshot().entities[0]).y).toBeGreaterThan(y0 + 1);
  });

  it("checkpoints activate and become the respawn point", () => {
    const sim = makeSim(loadFixture("fx-checkpoint"));
    place(sim, 3.5, 7.5);
    const ev = idle(sim, 5);
    expect(ev).toContainEqual(expect.objectContaining({ t: "checkpoint", index: 0 }));
    expect(sim.players[0]!.activeCheckpoint).toBe(0);
  });
});

function posOf(e: EntitySnapshot | undefined): { x: number; y: number } {
  if (!e || !("y" in e)) throw new Error(`entity has no position: ${e?.type}`);
  return e;
}
