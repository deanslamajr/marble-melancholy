import type { Autopilot } from "../../../src/level/solution/autopilot";
import { solveSolution } from "../../../src/level/solution/solve";
import { display } from "../fs";
import { printDiagnostics, printLine, type OutOpts } from "../format";
import { loadPlayable } from "../load";

export interface TraceOpts extends OutOpts {
  every?: string;
  from?: string;
  to?: string;
  solution?: string;
}

const f2 = (v: number) => v.toFixed(2);

export async function traceCommand(file: string, o: TraceOpts): Promise<number> {
  const shown = display(file);
  const r = loadPlayable(file, o.solution);
  if (!r.ok) {
    printDiagnostics(r.diagnostics, shown, o);
    return r.code === 3 ? 3 : 2;
  }
  if (!r.solution) {
    printLine(o, "FAIL reason=no-solution", { ok: false, reason: "no-solution" });
    return 2;
  }
  const every = Math.max(1, parseInt(o.every ?? "30", 10));
  const from = parseInt(o.from ?? "0", 10);
  const to = o.to !== undefined ? parseInt(o.to, 10) : Infinity;
  let ap: Autopilot | null = null;
  const s = solveSolution(r.level, r.solution, {
    onAutopilot: (a) => (ap = a),
    onTick: ({ sim, tick, events }) => {
      if (tick < from || tick > to) return;
      const p = sim.players[0]!;
      const m = p.marble;
      const g = sim.terrain.groundAt(m.x, m.y, sim.tick);
      const evs = events.filter((e) => e.t !== "clack" && e.t !== "land");
      const wp = ap ? (ap as Autopilot).i : -1;
      if (tick % every === 0) {
        const t = String(tick).padStart(4, "0");
        printLine(
          o,
          `t=${t} pos=(${f2(m.x)},${f2(m.y)},${f2(m.z)}) vel=(${f2(m.vx)},${f2(m.vy)},${f2(m.vz)}) ground=${m.grounded ? 1 : 0} cell=(${Math.floor(m.x)},${Math.floor(m.y)}) surf=${g?.surface ?? "void"} status=${m.status} wp=${wp} ev=${evs.map((e) => e.t).join(",")}`,
          {
            t: tick,
            pos: [m.x, m.y, m.z],
            vel: [m.vx, m.vy, m.vz],
            grounded: m.grounded,
            status: m.status,
            wp,
            events: evs,
          },
        );
      }
      for (const e of evs) {
        if (tick % every === 0) continue;
        const extra =
          e.t === "death" ? ` cause=${e.cause} pos=(${f2(e.x)},${f2(e.y)},${f2(e.z)})` : "";
        printLine(o, `t=${String(tick).padStart(4, "0")} event=${e.t}${extra}`, {
          t: tick,
          event: e,
        });
      }
    },
  });
  if (s.ok) {
    printLine(
      o,
      `GOAL tick=${s.ticks} time=${(s.ticks / 120).toFixed(2)}s deaths=${s.deaths} par=${r.par} hash=${s.stateHash}`,
      {
        ok: true,
        ticks: s.ticks,
        deaths: s.deaths,
        stateHash: s.stateHash,
      },
    );
    return 0;
  }
  const pos = s.pos.map(f2).join(",");
  printLine(
    o,
    `FAIL reason=${s.reason} at tick=${s.tick} pos=(${pos}) waypoint=${s.waypointIndex ?? "-"} deaths=${s.deaths}`,
    {
      ok: false,
      reason: s.reason,
      tick: s.tick,
      pos: s.pos,
      waypoint: s.waypointIndex ?? null,
    },
  );
  return 2;
}
