// LevelSource → CompiledLevel: validate → solve → stamp (§6.1). Also verify and decompile.
import { fnv1a32 } from "../core/hash";
import { round4 } from "../core/dmath";
import { TICK_HZ } from "../sim/constants";
import { runReplay } from "../sim/replayRunner";
import { computeBounds } from "./bounds";
import { diag, type Diagnostic } from "./diagnostics";
import { encodeLayers, type LayerLines } from "./parse";
import { CompiledLevelSchema } from "./schema";
import { serializeSource } from "./serialize";
import { solveSolution, type SolveResult } from "./solution/solve";
import { runsWellFormed } from "./solution/replay";
import { computeStamp, verifyStamp } from "./stamp";
import { resolveTheme, THEMES } from "./themes";
import type {
  Cell,
  CompiledEntity,
  CompiledLevel,
  DraftCompiled,
  EntitySource,
  LevelSource,
  ThemeOverride,
  UnstampedLevel,
} from "./types";
import { analyzeSource } from "./validate";

export type CompileResult =
  | { ok: true; level: CompiledLevel; warnings: Diagnostic[]; solve: SolveResult }
  | {
      ok: true;
      draft: DraftCompiled;
      warnings: Diagnostic[];
      diagnostics: Diagnostic[];
      solve: SolveResult | null;
    }
  | { ok: false; diagnostics: Diagnostic[]; solve?: SolveResult };

export interface CompileOptions {
  allowUnsolved?: boolean;
  /** Exact source text (CLI); GUI omits it and serializeSource(source) is hashed instead. */
  sourceText?: string;
  layerLines?: LayerLines;
}

/** Build everything but the solution and stamp. Returns diagnostics when validation fails. */
export function buildUnstamped(
  source: LevelSource,
  layerLines: LayerLines = {},
):
  | { ok: true; level: UnstampedLevel; warnings: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] } {
  const a = analyzeSource(source, layerLines);
  if (a.report.errors.length > 0 || !a.layers || !a.entities || !a.checkpoints || !a.passability) {
    return { ok: false, diagnostics: [...a.report.errors, ...a.report.warnings] };
  }
  const W = source.grid.width;
  const H = source.grid.height;
  const cells = {
    heights: a.layers.heights,
    slopes: a.layers.slopes,
    surfaces: a.layers.surfaces,
    walls: a.layers.walls,
    progress: a.passability.progress,
  };
  const sc = source.scoring ?? {};
  const ph = source.physics ?? {};
  const level: UnstampedLevel = {
    format: "mm-level/1",
    id: source.id,
    name: source.name,
    author: source.author ?? "",
    course: source.course ? { slot: source.course.slot } : null,
    theme: resolveTheme(source.theme),
    music: source.music,
    seed: source.seed ?? fnv1a32(source.id),
    grid: { width: W, height: H },
    cells,
    start: { p1: [...source.start.p1] as Cell, p2: [...source.start.p2] as Cell },
    goal: { at: [...source.goal.at] as Cell, radius: round4(source.goal.radius ?? 0.8) },
    checkpoints: a.checkpoints,
    entities: a.entities,
    timing: {
      timeLimit: source.timing.timeLimit,
      par: source.timing.par,
      timeBonus: source.timing.timeBonus ?? 5,
    },
    scoring: {
      progress: sc.progress ?? 500,
      goal: sc.goal ?? 1000,
      perSecond: sc.perSecond ?? 50,
      firstHome: sc.firstHome ?? 500,
    },
    physics: {
      slopeGravityScale: round4(ph.slopeGravityScale ?? 1),
      frictionScale: round4(ph.frictionScale ?? 1),
      inputScale: round4(ph.inputScale ?? 1),
    },
    bounds: roundBounds(computeBounds({ grid: { width: W, height: H }, cells })),
  };
  return { ok: true, level, warnings: a.report.warnings };
}

function roundBounds(b: UnstampedLevel["bounds"]): UnstampedLevel["bounds"] {
  return {
    minSx: round4(b.minSx),
    minSy: round4(b.minSy),
    maxSx: round4(b.maxSx),
    maxSy: round4(b.maxSy),
  };
}

function solveDiag(r: Extract<SolveResult, { ok: false }>): Diagnostic {
  const pos = r.pos.map((v) => v.toFixed(2)).join(",");
  const wp = r.waypointIndex !== undefined ? ` waypoint=${r.waypointIndex}` : "";
  return diag(
    "E019",
    `solution failed: reason=${r.reason} at tick=${r.tick} pos=(${pos})${wp} deaths=${r.deaths}`,
    {
      cell: [Math.floor(r.pos[0]), Math.floor(r.pos[1])],
    },
  );
}

/** W105: fatal ledges (big drops or void without a rail) beside the solution path. */
function fatalLedges(level: UnstampedLevel, path: Cell[]): Diagnostic | null {
  const W = level.grid.width;
  const H = level.grid.height;
  const h = level.cells.heights;
  let count = 0;
  let first: Cell | null = null;
  const seen = new Set<number>();
  for (const [x, y] of path) {
    const i = y * W + x;
    if (seen.has(i) || x < 0 || y < 0 || x >= W || y >= H || h[i]! < 0) continue;
    seen.add(i);
    const bits = [1, 2, 4, 8];
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    for (let e = 0; e < 4; e++) {
      if ((level.cells.walls[i]! & bits[e]!) !== 0) continue;
      const nx = x + dx[e]!;
      const ny = y + dy[e]!;
      const j = nx >= 0 && ny >= 0 && nx < W && ny < H ? ny * W + nx : -1;
      const drop = j < 0 || h[j]! < 0 ? Infinity : (h[i]! - h[j]!) * 0.5;
      if (drop >= 2.5) {
        count++;
        first ??= [x, y];
      }
    }
  }
  return first
    ? diag(
        "W105",
        `${count} open edges with a fatal drop beside the solution path; first at (${first[0]},${first[1]})`,
        { cell: first },
      )
    : null;
}

export async function compileLevel(
  source: LevelSource,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  const built = buildUnstamped(source, opts.layerLines);
  if (!built.ok) return { ok: false, diagnostics: built.diagnostics };
  const base = built.level;
  const warnings = [...built.warnings];

  if (!source.solution) {
    const d = diag("E018", "no solution (add solution: waypoints, script or replay)");
    if (opts.allowUnsolved) {
      return {
        ok: true,
        draft: { ...base, solution: null, stamp: null },
        warnings,
        diagnostics: [d],
        solve: null,
      };
    }
    return { ok: false, diagnostics: [d, ...warnings] };
  }

  const solve = solveSolution(base, source.solution);
  if (!solve.ok) {
    const d = solveDiag(solve);
    if (opts.allowUnsolved) {
      return {
        ok: true,
        draft: { ...base, solution: null, stamp: null },
        warnings,
        diagnostics: [d],
        solve,
      };
    }
    return { ok: false, diagnostics: [d, ...warnings], solve };
  }
  if (solve.ticks > base.timing.par * TICK_HZ) {
    warnings.push(
      diag(
        "W102",
        `solution time ${(solve.ticks / TICK_HZ).toFixed(2)} s is slower than par ${base.timing.par} s`,
      ),
    );
  }
  const ledge = fatalLedges(base, solve.path);
  if (ledge) warnings.push(ledge);

  const solution = {
    runs: solve.replay.runs,
    ticks: solve.ticks,
    deaths: solve.deaths,
    stateHash: solve.stateHash,
  };
  if (opts.allowUnsolved) {
    return {
      ok: true,
      draft: { ...base, solution, stamp: null },
      warnings,
      diagnostics: [],
      solve,
    };
  }
  const unstamped = { ...base, solution };
  const stamp = await computeStamp(unstamped, opts.sourceText ?? serializeSource(source));
  return { ok: true, level: { ...unstamped, stamp }, warnings, solve };
}

export interface VerifyReport {
  ok: boolean;
  level?: CompiledLevel;
  diagnostics: Diagnostic[];
}

/** Verify a compiled level: schema, stamp, and (optionally) the embedded replay. */
export async function verifyCompiled(
  json: unknown,
  opts: { replay?: boolean } = {},
): Promise<VerifyReport> {
  const fmt = (json as { format?: unknown } | null)?.format;
  if (fmt !== "mm-level/1") {
    return { ok: false, diagnostics: [diag("E021", `unsupported format ${JSON.stringify(fmt)}`)] };
  }
  if ((json as { stamp?: unknown }).stamp == null) {
    return {
      ok: false,
      diagnostics: [diag("E020", "stamp missing — only levels compiled by mmlevel can be loaded")],
    };
  }
  const parsed = CompiledLevelSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues
        .slice(0, 10)
        .map((i) => diag("E026", `${i.path.join(".") || "(root)"}: ${i.message}`)),
    };
  }
  const level = json as CompiledLevel;
  const W = level.grid.width;
  const H = level.grid.height;
  const n = W * H;
  for (const k of ["heights", "slopes", "surfaces", "walls", "progress"] as const) {
    if (level.cells[k].length !== n) {
      return {
        ok: false,
        diagnostics: [
          diag("E026", `cells.${k} has ${level.cells[k].length} entries; expected ${n}`),
        ],
      };
    }
  }
  if (!runsWellFormed(level.solution.runs)) {
    return {
      ok: false,
      diagnostics: [diag("E026", "solution.runs is not a list of valid [count, qx, qy] triples")],
    };
  }
  const st = await verifyStamp(level);
  if (!st.ok) return { ok: false, diagnostics: [diag("E020", `stamp invalid: ${st.reason}`)] };
  if (opts.replay !== false) {
    const r = runReplay(level, level.solution.runs, { extraTicks: 0 });
    if (!r.reached || r.ticks >= level.timing.timeLimit * TICK_HZ) {
      return {
        ok: false,
        diagnostics: [
          diag(
            "E019",
            `embedded replay does not reach the goal (ended ${r.end} at tick ${r.ticks})`,
          ),
        ],
      };
    }
    if (r.ticks !== level.solution.ticks || r.stateHash !== level.solution.stateHash) {
      return {
        ok: false,
        diagnostics: [
          diag(
            "E024",
            `replay desync: tick ${r.ticks} hash ${r.stateHash}; expected tick ${level.solution.ticks} hash ${level.solution.stateHash}`,
          ),
        ],
      };
    }
  }
  return { ok: true, level, diagnostics: [] };
}

function themeToSource(level: UnstampedLevel): LevelSource["theme"] {
  const base = THEMES[level.theme.id];
  const keys = ["top", "sideLight", "sideDark", "rail", "bgTop", "bgBottom", "accent"] as const;
  const diff: ThemeOverride = { base: level.theme.id };
  let any = false;
  for (const k of keys) {
    if (level.theme[k] !== base[k]) {
      diff[k] = level.theme[k];
      any = true;
    }
  }
  return any ? diff : level.theme.id;
}

function entityToSource(e: CompiledEntity): EntitySource {
  const copy = structuredClone(e) as Record<string, unknown>;
  delete copy.index;
  return copy as unknown as EntitySource;
}

/** Lossless reconstruction of a source from a compiled level (§6.2 "Edit copy"). */
export function decompileToSource(level: CompiledLevel | DraftCompiled): LevelSource {
  const W = level.grid.width;
  const H = level.grid.height;
  const layers = encodeLayers(W, H, level.cells);
  const src: LevelSource = {
    format: "mm-level-source/1",
    id: level.id,
    name: level.name,
    ...(level.author ? { author: level.author } : {}),
    ...(level.course ? { course: { slot: level.course.slot } } : {}),
    theme: themeToSource(level),
    music: level.music,
    ...(level.seed !== fnv1a32(level.id) ? { seed: level.seed } : {}),
    grid: { width: W, height: H },
    layers,
    start: { p1: [...level.start.p1] as Cell, p2: [...level.start.p2] as Cell },
    goal: { at: [...level.goal.at] as Cell, radius: level.goal.radius },
    checkpoints: level.checkpoints.map((c) => ({
      at: c.at,
      radius: c.radius,
      respawnAt: c.respawnAt,
    })),
    entities: level.entities.map(entityToSource),
    timing: { ...level.timing },
    scoring: { ...level.scoring },
    physics: { ...level.physics },
  };
  if (level.solution) {
    src.solution = {
      kind: "replay",
      runs: [...level.solution.runs],
      expectedTicks: level.solution.ticks,
    };
  }
  return src;
}
