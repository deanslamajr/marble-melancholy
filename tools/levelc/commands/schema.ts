import { join, resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CompiledLevelSchema, LevelSourceSchema } from "../../../src/level/schema";
import { display, writeJson } from "../fs";
import { printLine, type OutOpts } from "../format";

export async function schemaCommand(o: OutOpts & { out?: string }): Promise<number> {
  const dir = resolve(o.out ?? "levels/schema");
  const src = zodToJsonSchema(LevelSourceSchema, { name: "LevelSource", $refStrategy: "none" });
  const cmp = zodToJsonSchema(CompiledLevelSchema, { name: "CompiledLevel", $refStrategy: "none" });
  const a = join(dir, "level-source.schema.json");
  const b = join(dir, "level.schema.json");
  try {
    writeJson(a, { title: "Marble Melancholy level source (mm-level-source/1)", ...src });
    writeJson(b, { title: "Marble Melancholy compiled level (mm-level/1)", ...cmp });
  } catch (e) {
    console.error((e as Error).message);
    return 3;
  }
  printLine(o, `wrote ${display(a)}\nwrote ${display(b)}`, { files: [display(a), display(b)] });
  return 0;
}
