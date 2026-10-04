// Validation rules E001–E025, W101–W106 (§6.5).
import { round4 } from "../core/dmath";
import { edgeZ, cornerZ } from "../sim/terrainMath";
import { diag, type Diagnostic } from "./diagnostics";
import { ENTITY_SPECS, platformSweptCells, type ParamSpec } from "./entities/specs";
import { decodeLayers, type DecodedLayers, type LayerLines } from "./parse";
import {
  analyzePassability,
  predictCatapultLanding,
  type GridData,
  type PassabilityResult,
} from "./passability";
import {
  ENTITY_TYPES,
  MUSIC_IDS,
  SURFACE,
  THEME_IDS,
  type Cell,
  type CompiledCheckpoint,
  type CompiledEntity,
  type EntitySource,
  type EntityType,
  type LevelSource,
} from "./types";

export interface ValidationReport {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export interface Analysis {
  report: ValidationReport;
  layers: DecodedLayers | null;
  entities: CompiledEntity[] | null;
  checkpoints: CompiledCheckpoint[] | null;
  passability: PassabilityResult | null;
}

export const ID_REGEX = /^[a-z0-9][a-z0-9-]{1,47}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_CELLS = 8192;
const MAX_ENTITIES = 64;
const MAX_CHECKPOINTS = 16;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCell = (v: unknown): v is Cell =>
  Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1]);

export function validateSource(source: LevelSource, layerLines: LayerLines = {}): ValidationReport {
  return analyzeSource(source, layerLines).report;
}

/** Full analysis: validation diagnostics plus decoded layers, resolved entities and progress. */
export function analyzeSource(source: LevelSource, layerLines: LayerLines = {}): Analysis {
  const ds: Diagnostic[] = [];
  const result: Analysis = {
    report: { errors: [], warnings: [] },
    layers: null,
    entities: null,
    checkpoints: null,
    passability: null,
  };
  const finish = () => {
    result.report.errors = ds.filter((d) => d.severity === "error");
    result.report.warnings = ds.filter((d) => d.severity === "warning");
    return result;
  };

  if (source.format !== "mm-level-source/1") {
    ds.push(diag("E021", `unsupported format ${JSON.stringify(source.format)}`));
    return finish();
  }

  // E016 identity
  if (typeof source.id !== "string" || !ID_REGEX.test(source.id)) {
    ds.push(diag("E016", `id ${JSON.stringify(source.id)} must match ${ID_REGEX.source}`));
  }
  if (typeof source.name !== "string" || source.name.length < 1 || source.name.length > 24) {
    ds.push(diag("E016", "name must be 1–24 characters"));
  }
  if (
    source.author !== undefined &&
    (typeof source.author !== "string" || source.author.length > 32)
  ) {
    ds.push(diag("E016", "author must be at most 32 characters"));
  }

  // E025 theme / music
  if (typeof source.theme === "string") {
    if (!(THEME_IDS as readonly string[]).includes(source.theme)) {
      ds.push(diag("E025", `unknown theme ${JSON.stringify(source.theme)}`));
    }
  } else if (source.theme && typeof source.theme === "object") {
    if (!(THEME_IDS as readonly string[]).includes(source.theme.base)) {
      ds.push(diag("E025", `unknown theme base ${JSON.stringify(source.theme.base)}`));
    }
    for (const [k, v] of Object.entries(source.theme)) {
      if (k === "base") continue;
      if (!["top", "sideLight", "sideDark", "rail", "bgTop", "bgBottom", "accent"].includes(k)) {
        ds.push(diag("E025", `unknown theme override key ${k}`));
      } else if (typeof v !== "string" || !HEX.test(v)) {
        ds.push(diag("E025", `theme.${k} must be a #rrggbb colour`));
      }
    }
  }
  if (!(MUSIC_IDS as readonly string[]).includes(source.music)) {
    ds.push(diag("E025", `unknown music ${JSON.stringify(source.music)}`));
  }

  // E015 timing
  const t = source.timing;
  if (!isInt(t.timeLimit) || t.timeLimit < 5 || t.timeLimit > 99) {
    ds.push(diag("E015", "timing.timeLimit must be an integer 5..99"));
  } else if (!isInt(t.par) || t.par < 1 || t.par > t.timeLimit - 1) {
    ds.push(diag("E015", `timing.par must be an integer 1..${t.timeLimit - 1}`));
  }
  if (t.timeBonus !== undefined && (!isInt(t.timeBonus) || t.timeBonus < 0 || t.timeBonus > 30)) {
    ds.push(diag("E015", "timing.timeBonus must be an integer 0..30"));
  }
  if (isInt(t.timeLimit) && isInt(t.par) && t.par > 0.8 * t.timeLimit) {
    ds.push(diag("W103", `par ${t.par} s is more than 80% of the time limit ${t.timeLimit} s`));
  }

  // E022 physics
  const ph = source.physics ?? {};
  const physRanges: Array<[keyof typeof ph, number, number]> = [
    ["slopeGravityScale", -1, 2],
    ["frictionScale", 0.25, 3],
    ["inputScale", 0.5, 1.5],
  ];
  for (const [k, lo, hi] of physRanges) {
    const v = ph[k];
    if (v !== undefined && (!isNum(v) || v < lo || v > hi)) {
      ds.push(diag("E022", `physics.${k} must be in ${lo}..${hi}`));
    }
  }

  // E023 course slot
  if (source.course !== undefined) {
    const s = source.course.slot;
    if (!isInt(s) || s < 1 || s > 6) ds.push(diag("E023", "course.slot must be 1..6"));
  }

  // E017 counts
  const entitiesSrc = source.entities ?? [];
  const checkpointsSrc = source.checkpoints ?? [];
  if (entitiesSrc.length > MAX_ENTITIES) {
    ds.push(diag("E017", `${entitiesSrc.length} entities; at most ${MAX_ENTITIES} allowed`));
  }
  if (checkpointsSrc.length > MAX_CHECKPOINTS) {
    ds.push(
      diag("E017", `${checkpointsSrc.length} checkpoints; at most ${MAX_CHECKPOINTS} allowed`),
    );
  }

  // E001 grid
  const W = source.grid.width;
  const H = source.grid.height;
  if (!isInt(W) || !isInt(H) || W < 4 || W > 128 || H < 4 || H > 128) {
    ds.push(diag("E001", `grid ${W}×${H} must be integers 4..128 per side`));
    return finish();
  }

  // E002–E004 layers
  const decoded = decodeLayers(source, layerLines);
  ds.push(...decoded.diagnostics);
  const layers = decoded.layers;
  const nonVoid = layers.heights.filter((h) => h >= 0).length;
  if (nonVoid > MAX_CELLS) ds.push(diag("E001", `${nonVoid} non-void cells; at most ${MAX_CELLS}`));
  if (decoded.diagnostics.some((d) => d.code === "E002" || d.code === "E003")) return finish();
  result.layers = layers;

  const inGrid = (c: Cell) => c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H;
  const ci = (c: Cell) => c[1] * W + c[0];
  const solid = (c: Cell) => isCell(c) && inGrid(c) && layers.heights[ci(c)]! >= 0;
  const acid = (c: Cell) => solid(c) && layers.surfaces[ci(c)] === SURFACE.acid;
  const fmt = (c: Cell) => `(${c[0]},${c[1]})`;

  // E011/E012 entities
  const resolved: CompiledEntity[] = [];
  let entitiesOk = true;
  entitiesSrc.forEach((raw, index) => {
    const r = resolveEntity(raw as unknown as Record<string, unknown>, index, ds);
    if (r) resolved.push(r);
    else entitiesOk = false;
  });

  // Checkpoints
  const cps: CompiledCheckpoint[] = [];
  checkpointsSrc.forEach((c, i) => {
    if (!isCell(c.at)) {
      ds.push(diag("E027", `checkpoints[${i}].at must be a cell [x, y]`));
      return;
    }
    const radius = c.radius ?? 1.0;
    if (!isNum(radius) || radius < 0.5 || radius > 3) {
      ds.push(diag("E011", `checkpoints[${i}].radius must be in 0.5..3`, { cell: c.at }));
    }
    const respawnAt = c.respawnAt ?? c.at;
    if (!solid(c.at))
      ds.push(diag("E009", `checkpoint ${i} at ${fmt(c.at)} is void`, { cell: c.at }));
    if (!isCell(respawnAt) || !solid(respawnAt) || acid(respawnAt)) {
      ds.push(
        diag("E014", `checkpoint ${i} respawnAt ${fmt(respawnAt)} is void or acid`, {
          cell: respawnAt,
        }),
      );
    }
    cps.push({
      at: [c.at[0], c.at[1]],
      radius: round4(radius),
      respawnAt: [respawnAt[0], respawnAt[1]],
    });
  });
  result.checkpoints = cps;

  // E005–E007 start / goal
  const { p1, p2 } = source.start;
  const hazards = new Set<number>();
  for (const e of resolved) {
    if (e.type === "wave") continue;
    for (const c of ENTITY_SPECS[e.type].footprint(e)) if (inGrid(c)) hazards.add(ci(c));
  }
  for (const [label, c] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    if (!isCell(c) || !solid(c))
      ds.push(diag("E005", `start.${label} ${fmt(c)} is void`, { cell: c }));
    else if (acid(c)) ds.push(diag("E005", `start.${label} ${fmt(c)} is acid`, { cell: c }));
    else if (hazards.has(ci(c))) {
      ds.push(diag("E005", `start.${label} ${fmt(c)} is inside a hazard footprint`, { cell: c }));
    }
  }
  const goal = source.goal;
  const goalRadius = goal.radius ?? 0.8;
  if (!isCell(goal.at) || !solid(goal.at))
    ds.push(diag("E006", `goal ${fmt(goal.at)} is void`, { cell: goal.at }));
  else if (acid(goal.at)) ds.push(diag("E006", `goal ${fmt(goal.at)} is acid`, { cell: goal.at }));
  if (!isNum(goalRadius) || goalRadius < 0.5 || goalRadius > 2) {
    ds.push(diag("E006", "goal.radius must be in 0.5..2"));
  }
  const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
  if (same(p1, goal.at) || same(p2, goal.at))
    ds.push(diag("E007", "a start cell equals the goal cell"));
  if (same(p1, p2)) ds.push(diag("E007", "start.p1 equals start.p2"));

  if (!entitiesOk) return finish();
  result.entities = resolved;

  // E009 ground, E013 landings, E010 overlaps
  const owners = new Map<number, number>();
  for (const e of resolved) {
    const spec = ENTITY_SPECS[e.type];
    for (const c of spec.groundCells(e)) {
      if (!solid(c)) {
        ds.push(
          diag("E009", `${e.type} #${e.index} needs ground at ${fmt(c)}`, {
            cell: c,
            entityIndex: e.index,
          }),
        );
      }
    }
    if (e.type === "platform") {
      for (const c of platformSweptCells(e.path, e.size)) {
        if (!inGrid(c)) {
          ds.push(
            diag("E009", `platform #${e.index} leaves the grid at ${fmt(c)}`, {
              cell: c,
              entityIndex: e.index,
            }),
          );
          continue;
        }
        const h = layers.heights[ci(c)]!;
        if (h < 0) continue;
        const maxZ = Math.max(...cornerZ(h, layers.slopes[ci(c)]!));
        if (maxZ > e.top * 0.5 - 1.0 + 1e-9) {
          ds.push(
            diag(
              "E009",
              `platform #${e.index} footprint ${fmt(c)} must be void or ≥ 1.0 below its top`,
              {
                cell: c,
                entityIndex: e.index,
              },
            ),
          );
        }
      }
    }
    if ((e.type === "pipe" || e.type === "funnel") && !solid(e.exit)) {
      ds.push(
        diag("E013", `${e.type} #${e.index} exit ${fmt(e.exit)} is void`, {
          cell: e.exit,
          entityIndex: e.index,
        }),
      );
    }
    if (e.type !== "wave") {
      const seen = new Set<number>();
      for (const c of spec.footprint(e)) {
        if (!inGrid(c)) continue;
        const k = ci(c);
        if (seen.has(k)) continue;
        seen.add(k);
        const other = owners.get(k);
        if (other !== undefined) {
          ds.push(
            diag("E010", `${e.type} #${e.index} overlaps entity #${other} at ${fmt(c)}`, {
              cell: c,
              entityIndex: e.index,
            }),
          );
        } else {
          owners.set(k, e.index);
        }
      }
    }
  }

  if (ds.some((d) => d.severity === "error")) return finish();

  const grid: GridData = {
    W,
    H,
    heights: layers.heights,
    slopes: layers.slopes,
    surfaces: layers.surfaces,
    walls: layers.walls,
    entities: resolved,
  };
  for (const e of resolved) {
    if (e.type !== "catapult") continue;
    const land = predictCatapultLanding(grid, e.at, e.launch);
    if (!land) {
      ds.push(
        diag("E013", `catapult #${e.index} predicted landing is void`, {
          cell: e.at,
          entityIndex: e.index,
        }),
      );
    }
  }

  // E008 reachability, W101
  const pass = analyzePassability(grid, p1, goal.at);
  result.passability = pass;
  for (const [label, c] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    if (pass.distToGoal[ci(c)]! < 0) {
      let far: Cell = c;
      if (label === "p1") {
        for (let i = 0; i < W * H; i++) {
          const q: Cell = [i % W, Math.floor(i / W)];
          if (pass.reachableFromP1[i] && q[0] + q[1] > far[0] + far[1]) far = q;
        }
      }
      ds.push(
        diag(
          "E008",
          `goal unreachable from start ${label} ${fmt(c)}; farthest reachable cell ${fmt(far)}`,
          {
            cell: far,
          },
        ),
      );
    }
  }
  let unreachable = 0;
  let firstUnreachable: Cell | null = null;
  for (let i = 0; i < W * H; i++) {
    if (
      layers.heights[i]! >= 0 &&
      layers.surfaces[i] !== SURFACE.acid &&
      !pass.reachableFromP1[i]
    ) {
      unreachable++;
      firstUnreachable ??= [i % W, Math.floor(i / W)];
    }
  }
  if (unreachable > 0 && firstUnreachable) {
    ds.push(
      diag(
        "W101",
        `${unreachable} non-void cells unreachable from start; first ${fmt(firstUnreachable)}`,
        {
          cell: firstUnreachable,
        },
      ),
    );
  }

  // W104 slope low edge meets a higher neighbour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const s = layers.slopes[i]!;
      if (s === 0 || layers.heights[i]! < 0) continue;
      const dir = s <= 4 ? s : s - 4;
      const edge = dir - 1; // 1 N → edge 0, 2 E → 1, 3 S → 2, 4 W → 3
      const nx = x + [0, 1, 0, -1][edge]!;
      const ny = y + [-1, 0, 1, 0][edge]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (layers.heights[j]! < 0) continue;
      const low = edgeZ(layers.heights[i]!, s, edge, 0.5);
      const nb = edgeZ(layers.heights[j]!, layers.slopes[j]!, (edge + 2) % 4, 0.5);
      if (nb > low + 0.001) {
        ds.push(
          diag("W104", `slope at (${x},${y}) runs into a higher neighbour (${nx},${ny})`, {
            cell: [x, y],
          }),
        );
      }
    }
  }

  // W106 entity never interacts
  for (const e of resolved) {
    if (e.type !== "hoover" && e.type !== "muncher") continue;
    const r = e.type === "hoover" ? e.pullRadius : e.triggerRadius + 1.5;
    const cells = e.type === "muncher" ? e.path : [e.at];
    let touches = false;
    for (const c of cells) {
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R && !touches; dy++) {
        for (let dx = -R; dx <= R && !touches; dx++) {
          const q: Cell = [c[0] + dx, c[1] + dy];
          if (!inGrid(q) || dx * dx + dy * dy > r * r) continue;
          if (pass.reachableFromP1[ci(q)]) touches = true;
        }
      }
    }
    if (!touches) {
      ds.push(
        diag("W106", `${e.type} #${e.index} never touches a reachable cell`, {
          cell: cells[0]!,
          entityIndex: e.index,
        }),
      );
    }
  }

  return finish();
}

/** Resolve one entity's defaults, reporting E011/E012. Returns null on errors. */
export function resolveEntity(
  raw: Record<string, unknown>,
  index: number,
  ds: Diagnostic[],
): CompiledEntity | null {
  const type = raw.type as EntityType;
  if (!ENTITY_TYPES.includes(type)) {
    ds.push(
      diag("E012", `entity #${index}: unknown type ${JSON.stringify(raw.type)}`, {
        entityIndex: index,
      }),
    );
    return null;
  }
  const spec = ENTITY_SPECS[type];
  const known = new Set(["type", ...spec.params.map((p) => p.key)]);
  let ok = true;
  for (const k of Object.keys(raw)) {
    if (!known.has(k)) {
      ds.push(diag("E012", `${type} #${index}: unknown parameter ${k}`, { entityIndex: index }));
      ok = false;
    }
  }
  const out: Record<string, unknown> = { type, index };
  for (const p of spec.params) {
    const v = raw[p.key];
    const r = resolveParam(p, v, raw, type, index, ds);
    if (r === undefined) ok = false;
    else out[p.key] = r;
  }
  if (!ok) return null;
  if (type === "hammer" && (out.phase as number) > (out.period as number)) {
    ds.push(diag("E011", `hammer #${index}: phase must be in 0..period`, { entityIndex: index }));
    return null;
  }
  if (type === "catapult") {
    const [lx, ly, lz] = out.launch as number[];
    const h = Math.sqrt(lx! * lx! + ly! * ly!);
    if (h < 1 || h > 14 || lz! < 2 || lz! > 12) {
      ds.push(
        diag("E011", `catapult #${index}: launch |dx,dy| must be 1..14 and dz 2..12`, {
          entityIndex: index,
        }),
      );
      return null;
    }
  }
  if (type === "wave") {
    const d = out.dir as number[];
    const l = Math.sqrt(d[0]! * d[0]! + d[1]! * d[1]!);
    if (l < 1e-9) {
      ds.push(diag("E011", `wave #${index}: dir must be non-zero`, { entityIndex: index }));
      return null;
    }
    out.dir = [round4(d[0]! / l), round4(d[1]! / l)];
    const r = out.rect as number[];
    if (r[0]! > r[2]! || r[1]! > r[3]!) {
      ds.push(
        diag("E011", `wave #${index}: rect must be [x0, y0, x1, y1] with x0 ≤ x1, y0 ≤ y1`, {
          entityIndex: index,
        }),
      );
      return null;
    }
  }
  return out as unknown as CompiledEntity;
}

function resolveParam(
  p: ParamSpec,
  v: unknown,
  raw: Record<string, unknown>,
  type: string,
  index: number,
  ds: Diagnostic[],
): unknown {
  const where = `${type} #${index}: ${p.key}`;
  const err = (msg: string) => {
    ds.push(diag("E011", `${where} ${msg}`, { entityIndex: index }));
    return undefined;
  };
  if (v === undefined) {
    if (p.required) return err("is required");
    if (p.default === "at") return [[...(raw.at as Cell)]];
    if (Array.isArray(p.default)) return structuredClone(p.default);
    return p.default;
  }
  const range = (n: number) =>
    (p.min === undefined || n >= p.min - 1e-9) && (p.max === undefined || n <= p.max + 1e-9);
  switch (p.kind) {
    case "number":
      if (!isNum(v) || !range(v)) return err(`must be a number in ${p.min}..${p.max}`);
      return round4(v);
    case "int":
      if (!isInt(v) || !range(v)) return err(`must be an integer in ${p.min}..${p.max}`);
      return v;
    case "enum":
      if (typeof v !== "string" || !p.options?.includes(v))
        return err(`must be one of ${p.options?.join(", ")}`);
      return v;
    case "cell":
      if (!isCell(v)) return err("must be a cell [x, y]");
      return [v[0], v[1]];
    case "path": {
      if (!Array.isArray(v) || !v.every(isCell)) return err("must be a list of cells");
      if (v.length < (p.minItems ?? 0) || v.length > (p.maxItems ?? Infinity)) {
        return err(`must have ${p.minItems}–${p.maxItems} cells`);
      }
      return v.map((c: Cell) => [c[0], c[1]]);
    }
    case "vec3":
      if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum))
        return err("must be [dx, dy, dz]");
      if (!v.every((n: number) => range(n))) return err(`components must be in ${p.min}..${p.max}`);
      return v.map((n: number) => round4(n));
    case "vec2":
      if (!Array.isArray(v) || v.length !== 2 || !v.every(isNum)) return err("must be [x, y]");
      return v.map((n: number) => round4(n));
    case "rect":
      if (!Array.isArray(v) || v.length !== 4 || !v.every(isInt))
        return err("must be [x0, y0, x1, y1]");
      return [...v];
    case "size":
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        !v.every(isInt) ||
        !v.every((n: number) => range(n))
      ) {
        return err(`must be [w, h] with each in ${p.min}..${p.max}`);
      }
      return [...v];
  }
}

export type { EntitySource };
