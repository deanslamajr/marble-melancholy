// zod schemas: one source of truth for the JSON Schemas in levels/schema (D17).
import { z } from "zod";
import { MUSIC_IDS, THEME_IDS } from "./types";

const int = z.number().int();
const CellSchema = z.tuple([int, int]);
const RectSchema = z.tuple([int, int, int, int]);
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const Vec2Schema = z.tuple([z.number(), z.number()]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ThemeIdSchema = z.enum(THEME_IDS);
export const MusicIdSchema = z.enum(MUSIC_IDS);

export const ThemeOverrideSchema = z
  .object({
    base: ThemeIdSchema,
    top: hex.optional(),
    sideLight: hex.optional(),
    sideDark: hex.optional(),
    rail: hex.optional(),
    bgTop: hex.optional(),
    bgBottom: hex.optional(),
    accent: hex.optional(),
  })
  .strict();

const steelie = z
  .object({
    type: z.literal("steelie"),
    at: CellSchema,
    mode: z.enum(["patrol", "hunt"]).optional(),
    path: z.array(CellSchema).optional(),
    speed: z.number().optional(),
    aggroRadius: z.number().optional(),
  })
  .strict();
const muncher = z
  .object({
    type: z.literal("muncher"),
    at: CellSchema,
    triggerRadius: z.number().optional(),
    path: z.array(CellSchema).optional(),
    speed: z.number().optional(),
    digestTime: z.number().optional(),
  })
  .strict();
const hoover = z
  .object({
    type: z.literal("hoover"),
    at: CellSchema,
    pullRadius: z.number().optional(),
    pullStrength: z.number().optional(),
    killRadius: z.number().optional(),
    onTime: z.number().optional(),
    offTime: z.number().optional(),
    phase: z.number().optional(),
  })
  .strict();
const hammer = z
  .object({
    type: z.literal("hammer"),
    at: CellSchema,
    period: z.number().optional(),
    phase: z.number().optional(),
  })
  .strict();
const catapult = z
  .object({
    type: z.literal("catapult"),
    at: CellSchema,
    launch: Vec3Schema,
    windup: z.number().optional(),
  })
  .strict();
const wave = z
  .object({
    type: z.literal("wave"),
    rect: RectSchema,
    amplitude: z.number().optional(),
    wavelength: z.number().optional(),
    speed: z.number().optional(),
    dir: Vec2Schema.optional(),
  })
  .strict();
const platform = z
  .object({
    type: z.literal("platform"),
    at: CellSchema,
    size: z.tuple([int, int]).optional(),
    top: int,
    path: z.array(CellSchema),
    speed: z.number().optional(),
    pause: z.number().optional(),
    phase: z.number().optional(),
  })
  .strict();
const pipe = z
  .object({
    type: z.literal("pipe"),
    entry: CellSchema,
    exit: CellSchema,
    exitVelocity: Vec3Schema.optional(),
    travelTime: z.number().optional(),
  })
  .strict();
const funnel = z
  .object({
    type: z.literal("funnel"),
    at: CellSchema,
    radius: z.number().optional(),
    depth: z.number().optional(),
    exit: CellSchema,
    exitVelocity: Vec3Schema.optional(),
    travelTime: z.number().optional(),
  })
  .strict();

export const EntitySourceSchema = z.discriminatedUnion("type", [
  steelie,
  muncher,
  hoover,
  hammer,
  catapult,
  wave,
  platform,
  pipe,
  funnel,
]);

export const WaypointSchema = z
  .object({
    at: CellSchema,
    speed: z.number().min(0.1).max(1).optional(),
    radius: z.number().positive().optional(),
    hold: int.min(0).optional(),
    timed: z.boolean().optional(),
  })
  .strict();

export const SolutionSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("waypoints"),
      points: z.array(WaypointSchema).min(1),
      maxTicks: int.positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("script"),
      segments: z.array(z.object({ ticks: int.min(1), dir: Vec2Schema }).strict()).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("replay"),
      runs: z.array(int),
      expectedTicks: int.min(0),
    })
    .strict(),
]);

const CheckpointSourceSchema = z
  .object({ at: CellSchema, radius: z.number().optional(), respawnAt: CellSchema.optional() })
  .strict();

/** Full, strict source schema (documentation / JSON Schema). */
export const LevelSourceSchema = z
  .object({
    format: z.literal("mm-level-source/1"),
    id: z.string(),
    name: z.string(),
    author: z.string().optional(),
    course: z.object({ slot: int }).strict().optional(),
    theme: z.union([ThemeIdSchema, ThemeOverrideSchema]),
    music: MusicIdSchema,
    seed: int.min(0).max(0xffffffff).optional(),
    grid: z.object({ width: int, height: int }).strict(),
    layers: z
      .object({
        heights: z.string(),
        slopes: z.string().optional(),
        surfaces: z.string().optional(),
        walls: z.string().optional(),
      })
      .strict(),
    start: z.object({ p1: CellSchema, p2: CellSchema }).strict(),
    goal: z.object({ at: CellSchema, radius: z.number().optional() }).strict(),
    checkpoints: z.array(CheckpointSourceSchema).optional(),
    entities: z.array(EntitySourceSchema).optional(),
    timing: z.object({ timeLimit: int, par: int, timeBonus: int.optional() }).strict(),
    scoring: z
      .object({
        progress: int.min(0).optional(),
        goal: int.min(0).optional(),
        perSecond: int.min(0).optional(),
        firstHome: int.min(0).optional(),
      })
      .strict()
      .optional(),
    physics: z
      .object({
        slopeGravityScale: z.number().optional(),
        frictionScale: z.number().optional(),
        inputScale: z.number().optional(),
      })
      .strict()
      .optional(),
    solution: SolutionSourceSchema.optional(),
  })
  .strict();

/**
 * Structural schema used by the parser: same as LevelSourceSchema but entities are loose
 * records so the validator can report precise E011/E012 diagnostics.
 */
export const LevelSourceShapeSchema = LevelSourceSchema.extend({
  entities: z.array(z.record(z.unknown())).optional(),
  theme: z.union([z.string(), z.record(z.unknown())]),
  music: z.string(),
  format: z.string(),
});

const ResolvedThemeSchema = z
  .object({
    id: ThemeIdSchema,
    top: hex,
    sideLight: hex,
    sideDark: hex,
    rail: hex,
    bgTop: hex,
    bgBottom: hex,
    accent: hex,
  })
  .strict();

const withIndex = <T extends z.ZodRawShape>(o: z.ZodObject<T>) =>
  o
    .extend({ index: int.min(0) })
    .required()
    .strict();

export const CompiledEntitySchema = z.discriminatedUnion("type", [
  withIndex(steelie),
  withIndex(muncher),
  withIndex(hoover),
  withIndex(hammer),
  withIndex(catapult),
  withIndex(wave),
  withIndex(platform),
  withIndex(pipe),
  withIndex(funnel),
]);

export const CompiledLevelSchema = z
  .object({
    format: z.literal("mm-level/1"),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/),
    name: z.string().min(1).max(24),
    author: z.string().max(32),
    course: z
      .object({ slot: int.min(1).max(6) })
      .strict()
      .nullable(),
    theme: ResolvedThemeSchema,
    music: MusicIdSchema,
    seed: int.min(0).max(0xffffffff),
    grid: z.object({ width: int.min(4).max(128), height: int.min(4).max(128) }).strict(),
    cells: z
      .object({
        heights: z.array(int.min(-1).max(35)),
        slopes: z.array(int.min(0).max(8)),
        surfaces: z.array(int.min(0).max(6)),
        walls: z.array(int.min(0).max(15)),
        progress: z.array(int.min(-1).max(1000)),
      })
      .strict(),
    start: z.object({ p1: CellSchema, p2: CellSchema }).strict(),
    goal: z.object({ at: CellSchema, radius: z.number() }).strict(),
    checkpoints: z.array(
      z.object({ at: CellSchema, radius: z.number(), respawnAt: CellSchema }).strict(),
    ),
    entities: z.array(CompiledEntitySchema),
    timing: z.object({ timeLimit: int, par: int, timeBonus: int }).strict(),
    scoring: z.object({ progress: int, goal: int, perSecond: int, firstHome: int }).strict(),
    physics: z
      .object({ slopeGravityScale: z.number(), frictionScale: z.number(), inputScale: z.number() })
      .strict(),
    bounds: z
      .object({ minSx: z.number(), minSy: z.number(), maxSx: z.number(), maxSy: z.number() })
      .strict(),
    solution: z
      .object({
        runs: z.array(int),
        ticks: int.min(0),
        deaths: int.min(0),
        stateHash: z.string().regex(/^[0-9a-f]{8}$/),
      })
      .strict(),
    stamp: z
      .object({
        builder: z.string(),
        version: z.string(),
        sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    format: z.literal("mm-manifest/1"),
    course: z.array(z.string()),
    fixtures: z.array(z.string()),
    extras: z.array(z.string()).optional(),
  })
  .strict();
