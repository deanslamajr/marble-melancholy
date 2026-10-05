import { basename, dirname, join, relative, resolve } from "node:path";
import { MANIFEST_FORMAT } from "../../../src/level/version";
import {
  COMPILED_DIR,
  display,
  isCompiledFile,
  isSourceFile,
  removeFile,
  SRC_DIR,
  walk,
  writeJson,
} from "../fs";
import { printLine, type OutOpts } from "../format";
import { compileOne } from "./compile";
import { loadFile } from "../load";

export interface BuildAllOpts extends OutOpts {
  src?: string;
  out?: string;
}

export async function buildAllCommand(o: BuildAllOpts): Promise<number> {
  const srcRoot = resolve(o.src ?? SRC_DIR);
  const outRoot = resolve(o.out ?? COMPILED_DIR);
  const sources = walk(srcRoot, isSourceFile, ["invalid"]);
  let code = 0;

  // E023: duplicate course slots
  const slots = new Map<number, string>();
  for (const s of sources) {
    const r = loadFile(s);
    if (r.ok && r.file.kind === "source" && r.file.source.course) {
      const slot = r.file.source.course.slot;
      const prev = slots.get(slot);
      if (prev) {
        printLine(
          o,
          `${display(s)}: error E023: course slot ${slot} already used by ${display(prev)}`,
          {
            code: "E023",
            severity: "error",
            file: display(s),
            message: `course slot ${slot} duplicated`,
          },
        );
        code = Math.max(code, 1);
      } else {
        slots.set(slot, s);
      }
    }
  }
  if (code > 0) return code;

  const produced = new Set<string>();
  const course: Array<{ slot: number; id: string }> = [];
  const fixtures: string[] = [];
  const extras: string[] = [];
  for (const s of sources) {
    const rel = relative(srcRoot, dirname(s));
    const outDir = join(outRoot, rel);
    const r = await compileOne(s, { ...o, quiet: o.quiet }, outDir);
    code = Math.max(code, r.code);
    if (r.code === 0 && r.outPath && r.id) {
      produced.add(resolve(r.outPath));
      if (r.slot !== undefined) course.push({ slot: r.slot, id: r.id });
      else if (basename(rel) === "fixtures") fixtures.push(r.id);
      else if (basename(rel) === "extras") extras.push(r.id);
    }
  }
  if (code > 0) return code;

  for (const f of walk(outRoot, isCompiledFile)) {
    if (!produced.has(resolve(f))) {
      removeFile(f);
      printLine(o, `removed stale ${display(f)}`, { removed: display(f) });
    }
  }
  course.sort((a, b) => a.slot - b.slot);
  const manifest = {
    format: MANIFEST_FORMAT,
    course: course.map((c) => c.id),
    fixtures: fixtures.sort(),
    extras,
  };
  writeJson(join(outRoot, "manifest.json"), manifest);
  printLine(
    o,
    `wrote ${display(join(outRoot, "manifest.json"))} (${course.length} races, ${extras.length} extras, ${fixtures.length} fixtures)`,
    {
      manifest,
    },
  );
  return code;
}
