import { solveSolution } from "../../../src/level/solution/solve";
import { display } from "../fs";
import { printDiagnostics, printLine, type OutOpts } from "../format";
import { loadPlayable } from "../load";

export interface TestplayOpts extends OutOpts {
  solution?: string;
}

export async function testplayCommand(file: string, o: TestplayOpts): Promise<number> {
  const shown = display(file);
  const r = loadPlayable(file, o.solution);
  if (!r.ok) {
    printDiagnostics(r.diagnostics, shown, o);
    return r.code === 3 ? 3 : 2;
  }
  if (!r.solution) {
    printLine(o, `FAIL reason=no-solution`, { ok: false, reason: "no-solution" });
    return 2;
  }
  const s = solveSolution(r.level, r.solution);
  if (s.ok) {
    printLine(
      o,
      `GOAL tick=${s.ticks} time=${(s.ticks / 120).toFixed(2)}s deaths=${s.deaths} par=${r.par} hash=${s.stateHash}`,
      {
        ok: true,
        ticks: s.ticks,
        time: s.ticks / 120,
        deaths: s.deaths,
        par: r.par,
        stateHash: s.stateHash,
      },
    );
    return 0;
  }
  const pos = s.pos.map((v) => v.toFixed(2)).join(",");
  const wp = s.waypointIndex !== undefined ? ` waypoint=${s.waypointIndex}` : "";
  printLine(o, `FAIL reason=${s.reason} at tick=${s.tick} pos=(${pos})${wp} deaths=${s.deaths}`, {
    ok: false,
    reason: s.reason,
    tick: s.tick,
    pos: s.pos,
    waypoint: s.waypointIndex ?? null,
    deaths: s.deaths,
    deathCells: s.deathCells,
  });
  return 2;
}
