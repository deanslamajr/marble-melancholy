import type { RaceSim } from "./race";

/** hashState(sim) → 8 hex digits (§7.1). */
export function hashState(sim: RaceSim): string {
  return sim.hash();
}
