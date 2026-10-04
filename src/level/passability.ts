// Passability graph, BFS progress and reachability (§6.5).
import { GRAVITY, DT } from "../sim/constants";
import { cellZ, edgeZ } from "../sim/terrainMath";
import { platformSweptCells, funnelCells } from "./entities/specs";
import type { Cell, CompiledEntity } from "./types";
import { SURFACE } from "./types";

export interface GridData {
  W: number;
  H: number;
  heights: readonly number[];
  slopes: readonly number[];
  surfaces: readonly number[];
  walls: readonly number[];
  entities: readonly CompiledEntity[];
}

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const BIT = [1, 2, 4, 8];
const OPP = [2, 3, 0, 1];
const EPS = 0.001;
const MAX_DROP = 2.5;

function idx(g: GridData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= g.W || y >= g.H) return -1;
  return y * g.W + x;
}

function solid(g: GridData, i: number): boolean {
  return i >= 0 && g.heights[i]! >= 0;
}

function edgeH(g: GridData, i: number, edge: number): number {
  return edgeZ(g.heights[i]!, g.slopes[i]!, edge, 0.5);
}

function wallBetween(g: GridData, i: number, j: number, edge: number): boolean {
  if (i >= 0 && (g.walls[i]! & BIT[edge]!) !== 0) return true;
  if (j >= 0 && (g.walls[j]! & BIT[OPP[edge]!]!) !== 0) return true;
  return false;
}

/** Ballistic landing cell of a catapult launch ignoring collisions, or null (§6.5 E013). */
export function predictCatapultLanding(
  g: GridData,
  at: Cell,
  launch: readonly number[],
): Cell | null {
  const i0 = idx(g, at[0], at[1]);
  if (!solid(g, i0)) return null;
  let x = at[0] + 0.5;
  let y = at[1] + 0.5;
  let z = cellZ(g.heights[i0]!, g.slopes[i0]!, 0.5, 0.5);
  let minZ = Infinity;
  for (const h of g.heights) if (h >= 0) minZ = Math.min(minZ, h * 0.5 - 1);
  const vx = launch[0]!;
  const vy = launch[1]!;
  let vz = launch[2]!;
  for (let t = 0; t < 4000; t++) {
    x += vx * DT;
    y += vy * DT;
    vz -= GRAVITY * DT;
    z += vz * DT;
    if (z < minZ - 4) return null;
    if (vz > 0) continue;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const j = idx(g, cx, cy);
    if (!solid(g, j)) continue;
    const gz = cellZ(g.heights[j]!, g.slopes[j]!, x - cx, y - cy);
    if (z <= gz) return [cx, cy];
  }
  return null;
}

/** Forward adjacency lists over cell indices. */
export function buildGraph(g: GridData): number[][] {
  const n = g.W * g.H;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const add = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    const list = adj[a]!;
    if (!list.includes(b)) list.push(b);
  };
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      const a = idx(g, x, y);
      if (!solid(g, a)) continue;
      for (let e = 0; e < 4; e++) {
        const b = idx(g, x + DX[e]!, y + DY[e]!);
        if (wallBetween(g, a, b, e)) continue;
        const hA = edgeH(g, a, e);
        if (solid(g, b)) {
          if (g.surfaces[b] === SURFACE.acid) continue;
          const hB = edgeH(g, b, OPP[e]!);
          if (hB > hA + EPS) continue;
          if (hA - hB >= MAX_DROP) continue;
          const climb = edgeH(g, b, e) - hB;
          if (climb > 0.5 + EPS) continue;
          add(a, b);
        } else {
          // One- or two-cell jumpable gap (DECISIONS M05 extends §6.5 to two cells).
          for (let k = 2; k <= 3; k++) {
            const c = idx(g, x + DX[e]! * k, y + DY[e]! * k);
            if (c < 0) break;
            if (!solid(g, c)) continue;
            if (g.surfaces[c] === SURFACE.acid) break;
            const hC = edgeH(g, c, OPP[e]!);
            if (hC <= hA - 0.5 + EPS && hA - hC < MAX_DROP) add(a, c);
            break;
          }
        }
      }
    }
  }
  for (const ent of g.entities) {
    switch (ent.type) {
      case "pipe":
        add(idx(g, ent.entry[0], ent.entry[1]), idx(g, ent.exit[0], ent.exit[1]));
        break;
      case "funnel": {
        const exit = idx(g, ent.exit[0], ent.exit[1]);
        for (const c of funnelCells(ent.at, ent.radius)) {
          const i = idx(g, c[0], c[1]);
          if (solid(g, i)) add(i, exit);
        }
        break;
      }
      case "catapult": {
        const land = predictCatapultLanding(g, ent.at, ent.launch);
        if (land) add(idx(g, ent.at[0], ent.at[1]), idx(g, land[0], land[1]));
        break;
      }
      case "platform": {
        const top = ent.top * 0.5;
        const cells = platformSweptCells(ent.path, ent.size).filter(
          (c) => !solid(g, idx(g, c[0], c[1])) && idx(g, c[0], c[1]) >= 0,
        );
        const set = new Set(cells.map((c) => idx(g, c[0], c[1])));
        for (const c of cells) {
          const f = idx(g, c[0], c[1]);
          for (let e = 0; e < 4; e++) {
            const nb = idx(g, c[0] + DX[e]!, c[1] + DY[e]!);
            if (nb < 0) continue;
            if (set.has(nb)) {
              add(f, nb);
              continue;
            }
            if (!solid(g, nb) || wallBetween(g, f, nb, e)) continue;
            if (Math.abs(edgeH(g, nb, OPP[e]!) - top) <= 0.5 + EPS) {
              add(f, nb);
              if (g.surfaces[nb] !== SURFACE.acid) add(nb, f);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return adj;
}

export function bfs(adj: readonly number[][], start: number, reverse = false): number[] {
  const n = adj.length;
  let graph = adj;
  if (reverse) {
    const rev: number[][] = Array.from({ length: n }, () => []);
    for (let a = 0; a < n; a++) for (const b of adj[a]!) rev[b]!.push(a);
    graph = rev;
  }
  const dist = new Array<number>(n).fill(-1);
  if (start < 0 || start >= n) return dist;
  dist[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q]!;
    for (const b of graph[a]!) {
      if (dist[b] === -1) {
        dist[b] = dist[a]! + 1;
        queue.push(b);
      }
    }
  }
  return dist;
}

export interface PassabilityResult {
  progress: number[];
  /** BFS distance to the goal (reverse graph), -1 unreachable. */
  distToGoal: number[];
  /** Forward reachability from p1. */
  reachableFromP1: boolean[];
  /** Nodes that exist in the graph (non-void cells and platform footprints). */
  nodes: boolean[];
}

export function analyzePassability(g: GridData, p1: Cell, goal: Cell): PassabilityResult {
  const adj = buildGraph(g);
  const goalI = idx(g, goal[0], goal[1]);
  const p1I = idx(g, p1[0], p1[1]);
  const distToGoal = bfs(adj, goalI, true);
  const fwd = bfs(adj, p1I, false);
  const n = g.W * g.H;
  const nodes = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) if (g.heights[i]! >= 0 || adj[i]!.length > 0) nodes[i] = true;
  const dStart = p1I >= 0 ? distToGoal[p1I]! : -1;
  const progress = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const d = distToGoal[i]!;
    if (d < 0 || !nodes[i]) continue;
    progress[i] = dStart > 0 ? Math.min(1000, Math.round((1000 * d) / dStart)) : d === 0 ? 0 : 1000;
  }
  return { progress, distToGoal, reachableFromP1: fwd.map((d) => d >= 0), nodes };
}

export function cellIndex(g: { W: number; H: number }, c: Cell): number {
  if (c[0] < 0 || c[1] < 0 || c[0] >= g.W || c[1] >= g.H) return -1;
  return c[1] * g.W + c[0];
}
