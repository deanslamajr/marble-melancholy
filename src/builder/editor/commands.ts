// Pure edits (§6.2): (source, …) => new source. Nothing here touches the DOM or signals.
import { decodeLayers, encodeLayers, type DecodedLayers } from "../../level/parse";
import { SLOPE, SURFACE } from "../../level/types";
import type {
  Cell,
  CheckpointSource,
  EntitySource,
  LevelSource,
  Rect,
  SolutionSource,
  Waypoint,
} from "../../level/types";

export interface Grid extends DecodedLayers {
  w: number;
  h: number;
}

export const MAX_HEIGHT = 35;

export function gridOf(src: LevelSource): Grid {
  const { layers } = decodeLayers(src);
  return { w: src.grid.width, h: src.grid.height, ...layers };
}

export function inGrid(g: { w: number; h: number }, [x, y]: Cell): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

function withGrid(src: LevelSource, fn: (g: Grid) => boolean | void): LevelSource {
  const g = gridOf(src);
  const changed = fn(g);
  if (changed === false) return src;
  const enc = encodeLayers(g.w, g.h, g);
  return {
    ...src,
    layers: { heights: enc.heights, slopes: enc.slopes, surfaces: enc.surfaces, walls: enc.walls },
  };
}

function clearCell(g: Grid, i: number): void {
  g.heights[i] = -1;
  g.slopes[i] = SLOPE.flat;
  g.surfaces[i] = SURFACE.normal;
  g.walls[i] = 0;
}

/** Square brush of side `size` (1, 3, 5) centred on `c`, clipped to the grid. */
export function brushCells(c: Cell, size: number, w: number, h: number): Cell[] {
  const r = Math.floor(size / 2);
  const out: Cell[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = c[0] + dx;
      const y = c[1] + dy;
      if (x >= 0 && y >= 0 && x < w && y < h) out.push([x, y]);
    }
  }
  return out;
}

export function setHeight(src: LevelSource, cells: readonly Cell[], h: number): LevelSource {
  return withGrid(src, (g) => {
    let changed = false;
    for (const c of cells) {
      if (!inGrid(g, c)) continue;
      const i = c[1] * g.w + c[0];
      if (h < 0) {
        if (g.heights[i] !== -1) changed = true;
        clearCell(g, i);
      } else if (g.heights[i] !== h) {
        g.heights[i] = Math.min(MAX_HEIGHT, h);
        changed = true;
      }
    }
    return changed;
  });
}

/** Height brush: ±1 half-unit; void cells are created at `fill` when raising. Lowering 0 → void. */
export function raiseHeight(
  src: LevelSource,
  cells: readonly Cell[],
  delta: 1 | -1,
  fill: number,
): LevelSource {
  return withGrid(src, (g) => {
    for (const c of cells) {
      if (!inGrid(g, c)) continue;
      const i = c[1] * g.w + c[0];
      const cur = g.heights[i]!;
      if (cur < 0) {
        if (delta > 0) g.heights[i] = Math.max(0, Math.min(MAX_HEIGHT, fill));
        continue;
      }
      const next = cur + delta;
      if (next < 0) clearCell(g, i);
      else g.heights[i] = Math.min(MAX_HEIGHT, next);
    }
  });
}

export function setSlope(src: LevelSource, cells: readonly Cell[], slope: number): LevelSource {
  return withGrid(src, (g) => {
    for (const c of cells) {
      if (!inGrid(g, c)) continue;
      const i = c[1] * g.w + c[0];
      if (g.heights[i]! >= 0) g.slopes[i] = slope;
    }
  });
}

export function setSurface(src: LevelSource, cells: readonly Cell[], surface: number): LevelSource {
  return withGrid(src, (g) => {
    for (const c of cells) {
      if (!inGrid(g, c)) continue;
      const i = c[1] * g.w + c[0];
      if (g.heights[i]! >= 0) g.surfaces[i] = surface;
    }
  });
}

/** Set or clear one wall bit (N=1 E=2 S=4 W=8) on a non-void cell. */
export function setWall(src: LevelSource, c: Cell, bit: number, on: boolean): LevelSource {
  return withGrid(src, (g) => {
    if (!inGrid(g, c)) return false;
    const i = c[1] * g.w + c[0];
    if (g.heights[i]! < 0) return false;
    const next = on ? g.walls[i]! | bit : g.walls[i]! & ~bit;
    if (next === g.walls[i]) return false;
    g.walls[i] = next;
    return true;
  });
}

export function cellHeight(src: LevelSource, c: Cell): number {
  const g = gridOf(src);
  return inGrid(g, c) ? g.heights[c[1] * g.w + c[0]]! : -1;
}

// ---------- markers ----------

export function setStart(src: LevelSource, which: "p1" | "p2", c: Cell): LevelSource {
  return { ...src, start: { ...src.start, [which]: [c[0], c[1]] } };
}

export function setGoal(src: LevelSource, c: Cell): LevelSource {
  return { ...src, goal: { ...src.goal, at: [c[0], c[1]] } };
}

export function addCheckpoint(src: LevelSource, c: Cell): LevelSource {
  return { ...src, checkpoints: [...(src.checkpoints ?? []), { at: [c[0], c[1]] }] };
}

export function updateCheckpoint(
  src: LevelSource,
  i: number,
  patch: Partial<CheckpointSource>,
): LevelSource {
  const list = [...(src.checkpoints ?? [])];
  const cur = list[i];
  if (!cur) return src;
  list[i] = { ...cur, ...patch };
  return { ...src, checkpoints: list };
}

export function removeCheckpoint(src: LevelSource, i: number): LevelSource {
  return { ...src, checkpoints: (src.checkpoints ?? []).filter((_, k) => k !== i) };
}

// ---------- entities ----------

export function addEntity(src: LevelSource, e: EntitySource): LevelSource {
  return { ...src, entities: [...(src.entities ?? []), e] };
}

export function updateEntity(src: LevelSource, i: number, e: EntitySource): LevelSource {
  const list = [...(src.entities ?? [])];
  if (!list[i]) return src;
  list[i] = e;
  return { ...src, entities: list };
}

export function removeEntities(src: LevelSource, indices: readonly number[]): LevelSource {
  const drop = new Set(indices);
  return { ...src, entities: (src.entities ?? []).filter((_, k) => !drop.has(k)) };
}

const shift = (c: Cell, dx: number, dy: number): Cell => [c[0] + dx, c[1] + dy];

/** Translate every cell-valued field of an entity. */
export function translateEntity(e: EntitySource, dx: number, dy: number): EntitySource {
  const o = structuredClone(e) as EntitySource & Record<string, unknown>;
  if ("at" in o && Array.isArray(o.at)) o.at = shift(o.at as Cell, dx, dy);
  if ("path" in o && Array.isArray(o.path))
    o.path = (o.path as Cell[]).map((c) => shift(c, dx, dy));
  if ("entry" in o && Array.isArray(o.entry)) o.entry = shift(o.entry as Cell, dx, dy);
  if ("exit" in o && Array.isArray(o.exit)) o.exit = shift(o.exit as Cell, dx, dy);
  if (o.type === "wave") {
    const r = o.rect;
    o.rect = [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy] as Rect;
  }
  return o;
}

export function moveEntities(
  src: LevelSource,
  indices: readonly number[],
  dx: number,
  dy: number,
): LevelSource {
  if (dx === 0 && dy === 0) return src;
  const set = new Set(indices);
  return {
    ...src,
    entities: (src.entities ?? []).map((e, k) => (set.has(k) ? translateEntity(e, dx, dy) : e)),
  };
}

/** Primary cell of an entity (for hit-testing and the inspector). */
export function entityAnchor(e: EntitySource): Cell {
  if (e.type === "pipe") return e.entry;
  if (e.type === "wave") return [e.rect[0], e.rect[1]];
  return e.at;
}

// ---------- solution ----------

export function waypointsOf(src: LevelSource): Waypoint[] {
  return src.solution?.kind === "waypoints" ? src.solution.points : [];
}

export function addWaypoint(src: LevelSource, c: Cell): LevelSource {
  return {
    ...src,
    solution: { kind: "waypoints", points: [...waypointsOf(src), { at: [c[0], c[1]] }] },
  };
}

export function removeLastWaypoint(src: LevelSource): LevelSource {
  const pts = waypointsOf(src);
  if (pts.length === 0) return src;
  return { ...src, solution: { kind: "waypoints", points: pts.slice(0, -1) } };
}

export function updateWaypoint(src: LevelSource, i: number, patch: Partial<Waypoint>): LevelSource {
  const pts = [...waypointsOf(src)];
  const cur = pts[i];
  if (!cur) return src;
  const next: Waypoint = { ...cur, ...patch };
  for (const k of ["speed", "radius", "hold"] as const) if (next[k] === undefined) delete next[k];
  pts[i] = next;
  return { ...src, solution: { kind: "waypoints", points: pts } };
}

export function setSolution(src: LevelSource, solution: SolutionSource | undefined): LevelSource {
  const next = { ...src };
  if (solution) next.solution = solution;
  else delete next.solution;
  return next;
}

// ---------- level ----------

/** Resize with the top-left anchored; cells outside the new size are dropped. */
export function resizeGrid(src: LevelSource, w: number, h: number): LevelSource {
  const g = gridOf(src);
  const n = w * h;
  const out: Grid = {
    w,
    h,
    heights: new Array<number>(n).fill(-1),
    slopes: new Array<number>(n).fill(0),
    surfaces: new Array<number>(n).fill(0),
    walls: new Array<number>(n).fill(0),
  };
  for (let y = 0; y < Math.min(h, g.h); y++) {
    for (let x = 0; x < Math.min(w, g.w); x++) {
      const a = y * g.w + x;
      const b = y * w + x;
      out.heights[b] = g.heights[a]!;
      out.slopes[b] = g.slopes[a]!;
      out.surfaces[b] = g.surfaces[a]!;
      out.walls[b] = g.walls[a]!;
    }
  }
  const enc = encodeLayers(w, h, out);
  return { ...src, grid: { width: w, height: h }, layers: { ...enc } };
}

/** "New level" draft (§6.2): 16×24, void, with a flat 4-wide corridor from start to goal. */
export function newDraftSource(id: string, name: string): LevelSource {
  const W = 16;
  const H = 24;
  const g: Grid = {
    w: W,
    h: H,
    heights: new Array<number>(W * H).fill(-1),
    slopes: new Array<number>(W * H).fill(0),
    surfaces: new Array<number>(W * H).fill(0),
    walls: new Array<number>(W * H).fill(0),
  };
  for (let y = 1; y <= 22; y++) for (let x = 6; x <= 9; x++) g.heights[y * W + x] = 10;
  const enc = encodeLayers(W, H, g);
  return {
    format: "mm-level-source/1",
    id,
    name,
    author: "",
    theme: "practice",
    music: "m1-first-steps",
    grid: { width: W, height: H },
    layers: { ...enc },
    start: { p1: [7, 2], p2: [8, 2] },
    goal: { at: [7, 21] },
    checkpoints: [],
    entities: [],
    timing: { timeLimit: 30, par: 20 },
    solution: { kind: "waypoints", points: [{ at: [7, 21] }] },
  };
}
