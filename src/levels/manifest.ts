// The only module that imports level JSON (D20c). Everything else asks this module or LevelLoader.
import type { CompiledLevel } from "../level/types";

interface Manifest {
  format: "mm-manifest/1";
  course: string[];
  fixtures: string[];
  extras?: string[];
}

const files = import.meta.glob("/levels/compiled/**/*.level.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const manifestFiles = import.meta.glob("/levels/compiled/manifest.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const manifest = (manifestFiles["/levels/compiled/manifest.json"] ?? {
  format: "mm-manifest/1",
  course: [],
  fixtures: [],
}) as Manifest;

const byId = new Map<string, unknown>();
for (const json of Object.values(files)) {
  const id = (json as { id?: unknown }).id;
  if (typeof id === "string") byId.set(id, json);
}

/** Core race ids in course slot order. */
export function courseIds(): readonly string[] {
  return manifest.course;
}

export function fixtureIds(): readonly string[] {
  return manifest.fixtures;
}

/** Extra courses (single races outside the six-race campaign), in manifest order. */
export function extraIds(): readonly string[] {
  return manifest.extras ?? [];
}

/** Raw (unverified) compiled JSON by level id; pass it to LevelLoader.load before use. */
export function rawLevel(id: string): unknown {
  return byId.get(id);
}

export function allLevelIds(): string[] {
  return [...byId.keys()];
}

export type { CompiledLevel };
