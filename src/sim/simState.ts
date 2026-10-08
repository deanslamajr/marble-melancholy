// Save and restore the full mutable state of a RaceSim, for search-based solvers (DECISIONS L25).
// Entities keep their mutable state in primitive own fields and in PathWalkers; everything else
// they hold (defs, platform legs) is fixed at construction.
import { PathWalker } from "./entities/base";
import type { RaceSim } from "./race";
import type { MarbleState, PlayerState } from "./types";

type Prims = Record<string, number | boolean | string | null>;

export interface SimState {
  tick: number;
  countdown: number;
  finishWindow: number;
  firstFinisher: number;
  over: boolean;
  rng: number;
  players: Array<{ p: Omit<PlayerState, "marble">; m: MarbleState }>;
  entities: Array<{ own: Prims; walkers: Array<[string, Prims]> }>;
  checkpoints: number[];
}

function prims(o: object, skip?: ReadonlySet<string>): Prims {
  const out: Prims = {};
  for (const k of Object.keys(o)) {
    if (skip?.has(k)) continue;
    const v = (o as Record<string, unknown>)[k];
    const t = typeof v;
    if (v === null || t === "number" || t === "boolean" || t === "string") out[k] = v as never;
  }
  return out;
}

export function captureSim(sim: RaceSim): SimState {
  return {
    tick: sim.tick,
    countdown: sim.countdown,
    finishWindow: sim.finishWindow,
    firstFinisher: sim.firstFinisher,
    over: sim.over,
    rng: sim.rng.state,
    players: sim.players.map((pl) => {
      const { marble, ...rest } = pl;
      return { p: { ...rest }, m: { ...marble } };
    }),
    entities: sim.entities.map((e) => {
      const walkers: Array<[string, Prims]> = [];
      for (const k of Object.keys(e)) {
        const v = (e as unknown as Record<string, unknown>)[k];
        if (v instanceof PathWalker) walkers.push([k, prims(v)]);
      }
      return { own: prims(e), walkers };
    }),
    checkpoints: sim.checkpoints.map((c) => c.owner),
  };
}

export function restoreSim(sim: RaceSim, s: SimState): void {
  sim.tick = s.tick;
  sim.countdown = s.countdown;
  sim.finishWindow = s.finishWindow;
  sim.firstFinisher = s.firstFinisher;
  sim.over = s.over;
  sim.rng.state = s.rng;
  for (let i = 0; i < sim.players.length; i++) {
    const pl = sim.players[i]!;
    const saved = s.players[i]!;
    Object.assign(pl, saved.p);
    Object.assign(pl.marble, saved.m);
  }
  for (let i = 0; i < sim.entities.length; i++) {
    const e = sim.entities[i] as unknown as Record<string, unknown>;
    const saved = s.entities[i]!;
    Object.assign(e, saved.own);
    for (const [k, w] of saved.walkers) Object.assign(e[k] as object, w);
  }
  for (let i = 0; i < sim.checkpoints.length; i++) sim.checkpoints[i]!.owner = s.checkpoints[i]!;
}
