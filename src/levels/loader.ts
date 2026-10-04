import { verifyCompiled } from "../level/verify";
import { formatDiagnostic } from "../level/diagnostics";
import type { CompiledLevel } from "../level/types";
import { courseIds, rawLevel } from "./manifest";

export class LevelLoadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "LevelLoadError";
  }
}

const cache = new Map<string, CompiledLevel>();

/**
 * Runtime gate for every level the game plays (D20a): schema, builder version and stamp hash are
 * verified; anything else throws. Replays are not re-run here (the CLI check does that in CI).
 */
export const LevelLoader = {
  async load(idOrJson: string | unknown): Promise<CompiledLevel> {
    const fromId = typeof idOrJson === "string";
    if (fromId) {
      const hit = cache.get(idOrJson);
      if (hit) return hit;
    }
    const json = fromId ? rawLevel(idOrJson) : idOrJson;
    if (json === undefined)
      throw new LevelLoadError(`unknown level id "${String(idOrJson)}"`, "E000");
    const report = await verifyCompiled(json, { replay: false });
    if (!report.ok) {
      const first = report.diagnostics[0];
      throw new LevelLoadError(
        first
          ? formatDiagnostic(first, typeof idOrJson === "string" ? idOrJson : "level")
          : "level failed verification",
        first?.code ?? "E020",
      );
    }
    const level = json as CompiledLevel;
    if (fromId) cache.set(level.id, level);
    return level;
  },

  async loadCourse(): Promise<CompiledLevel[]> {
    return Promise.all(courseIds().map((id) => LevelLoader.load(id)));
  },
};
