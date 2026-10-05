// Shared test helpers (§4 layout): loadFixture(), makeSim(), fakeInput().
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "../../src/level/parse";
import type { CompiledLevel, LevelSource } from "../../src/level/types";
import { quantizeInput } from "../../src/sim/quantize";
import { RaceSim, type RaceOptions } from "../../src/sim/race";
import type { InputFrame, SimEvent } from "../../src/sim/types";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const COMPILED = join(ROOT, "levels", "compiled");
export const SOURCES = join(ROOT, "levels", "src");

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Compiled fixture by id (levels/compiled/fixtures/<id>.level.json). */
export function loadFixture(id: string): CompiledLevel {
  return readJson<CompiledLevel>(join(COMPILED, "fixtures", `${id}.level.json`));
}

/** Compiled core race by id (levels/compiled/core/<id>.level.json). */
export function loadCore(id: string): CompiledLevel {
  return readJson<CompiledLevel>(join(COMPILED, "core", `${id}.level.json`));
}

/** Compiled extra course by id (levels/compiled/extras/<id>.level.json). */
export function loadExtra(id: string): CompiledLevel {
  return readJson<CompiledLevel>(join(COMPILED, "extras", `${id}.level.json`));
}

export function manifest(): {
  format: string;
  course: string[];
  fixtures: string[];
  extras: string[];
} {
  return readJson(join(COMPILED, "manifest.json"));
}

/** Parsed source; throws on parse errors. */
export function loadSource(relPath: string): { source: LevelSource; text: string } {
  const text = readFileSync(join(SOURCES, relPath), "utf8");
  const p = parseSource(text);
  if (!p.ok) throw new Error(`${relPath}: ${p.diagnostics.map((d) => d.message).join("; ")}`);
  return { source: p.source, text };
}

export function listFiles(dir: string, suffix: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort();
}

export function makeSim(level: CompiledLevel, opts: Partial<RaceOptions> = {}): RaceSim {
  return new RaceSim(level, { players: 1, ...opts });
}

/** A constant quantized input repeated for `ticks` ticks. */
export function fakeInput(ax: number, ay: number, ticks: number): InputFrame[] {
  const f = quantizeInput(ax, ay);
  return Array.from({ length: ticks }, () => f);
}

/** Step a 1P sim with the given inputs; returns all events. */
export function run(sim: RaceSim, inputs: readonly InputFrame[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (const i of inputs) out.push(...sim.step([i]));
  return out;
}

/** Step a 1P sim with zero input. */
export function idle(sim: RaceSim, ticks: number): SimEvent[] {
  return run(sim, fakeInput(0, 0, ticks));
}

/** Place player 0 at a world position, at rest on the ground. */
export function place(sim: RaceSim, x: number, y: number): void {
  const m = sim.players[0]!.marble;
  m.x = x;
  m.y = y;
  m.z = sim.terrain.groundAt(x, y, sim.tick)?.z ?? m.z;
  m.vx = 0;
  m.vy = 0;
  m.vz = 0;
}
