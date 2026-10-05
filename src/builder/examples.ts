// Shipped levels as builder examples: listed from the level manifest, opened as editable copies.
import { decompileToSource } from "../level/compile";
import { parseSource } from "../level/parse";
import type { LevelSource } from "../level/types";
import { LevelLoader } from "../levels/loader";
import { allLevelIds, courseIds, extraIds, fixtureIds, rawLevel } from "../levels/manifest";
import { copyLevelId, NAME_MAX } from "../storage/levelsStore";

export type ExampleGroup = "course" | "extra" | "fixture" | "other";

/** Display order of the groups in the Examples dropdown. */
export const EXAMPLE_GROUPS: readonly ExampleGroup[] = ["course", "extra", "fixture", "other"];

export interface ExampleEntry {
  id: string;
  name: string;
  group: ExampleGroup;
}

export const EXAMPLE_GROUP_LABEL: Record<ExampleGroup, string> = {
  course: "Main course",
  extra: "Extra courses",
  fixture: "Mechanic test tracks",
  other: "More levels",
};

/** YAML sources, loaded lazily (and only inside the builder chunk). Invalid fixtures are skipped. */
const SOURCES = import.meta.glob(["/levels/src/**/*.level.yaml", "!/levels/src/**/invalid/**"], {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

/** Every shipped level in manifest order: course races, extras, fixtures, then any other level. */
export function listExamples(): ExampleEntry[] {
  const out: ExampleEntry[] = [];
  const seen = new Set<string>();
  const add = (id: string, group: ExampleGroup) => {
    if (seen.has(id)) return;
    const raw = rawLevel(id) as { name?: unknown } | undefined;
    if (!raw) return;
    seen.add(id);
    out.push({ id, name: typeof raw.name === "string" ? raw.name : id, group });
  };
  for (const id of courseIds()) add(id, "course");
  for (const id of extraIds()) add(id, "extra");
  for (const id of fixtureIds()) add(id, "fixture");
  for (const id of allLevelIds().sort()) add(id, "other");
  return out;
}

let sourceIndex: Promise<Map<string, string>> | null = null;

/** Level id → YAML text of every source file, read once on first use. */
function sourcesById(): Promise<Map<string, string>> {
  sourceIndex ??= Promise.all(Object.values(SOURCES).map((load) => load())).then((texts) => {
    const m = new Map<string, string>();
    for (const text of texts) {
      const id = /^id:\s*["']?([\w-]+)/m.exec(text)?.[1];
      if (id && !m.has(id)) m.set(id, text);
    }
    return m;
  });
  return sourceIndex;
}

/**
 * The full source of a shipped level (layers, entities, solution waypoints). Falls back to
 * decompiling the compiled JSON when no YAML source parses for that id.
 */
export async function exampleSource(
  id: string,
): Promise<{ source: LevelSource; from: "yaml" | "compiled" }> {
  const text = (await sourcesById()).get(id);
  if (text !== undefined) {
    const p = parseSource(text);
    if (p.ok && p.source.id === id) return { source: p.source, from: "yaml" };
  }
  return { source: decompileToSource(await LevelLoader.load(id)), from: "compiled" };
}

/** A copy of a shipped level's source with a free id, a "copy" name and no course slot. */
export function exampleDraftSource(source: LevelSource, takenIds: Set<string>): LevelSource {
  const copy: LevelSource = structuredClone(source);
  copy.id = copyLevelId(source.id, takenIds);
  copy.name = `${source.name} copy`.slice(0, NAME_MAX);
  delete copy.course;
  return copy;
}
