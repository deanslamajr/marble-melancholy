import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { verifyCompiled } from "../../../src/level/compile";
import { ManifestSchema } from "../../../src/level/schema";
import type { CompiledLevel } from "../../../src/level/types";
import { display, expandInputs, IoError, isCompiledFile, readJson } from "../fs";
import { fail, ok, printDiagnostics, printLine, type OutOpts } from "../format";

export interface CheckOpts extends OutOpts {
  replay?: boolean;
}

const CODE_EXIT: Record<string, number> = { E020: 4, E021: 1, E026: 1, E019: 2, E024: 2 };

export async function checkCommand(inputs: string[], o: CheckOpts): Promise<number> {
  const files = expandInputs(inputs, isCompiledFile);
  let code = 0;
  const levels = new Map<string, { level: CompiledLevel; path: string }>();
  for (const f of files) {
    const shown = display(f);
    let json: unknown;
    try {
      json = readJson(f);
    } catch (e) {
      if (e instanceof IoError) {
        console.error(e.message);
        code = Math.max(code, 3);
        continue;
      }
      throw e;
    }
    const rep = await verifyCompiled(json, { replay: o.replay !== false });
    if (!rep.ok) {
      printDiagnostics(rep.diagnostics, shown, o);
      for (const d of rep.diagnostics) code = Math.max(code, CODE_EXIT[d.code] ?? 1);
      continue;
    }
    const lvl = rep.level!;
    if (basename(f) !== `${lvl.id}.level.json`) {
      printLine(o, fail(o, `${shown}: file name does not match id ${lvl.id}`), { file: shown, error: "filename" });
      code = Math.max(code, 1);
    }
    levels.set(`${basename(dirname(f))}/${lvl.id}`, { level: lvl, path: f });
    printLine(o, `${ok(o, "OK")} ${shown} (${lvl.id}, ${lvl.solution.ticks} ticks)`, { file: shown, ok: true, id: lvl.id });
  }

  for (const input of inputs) {
    const p = resolve(input);
    if (!existsSync(p) || !statSync(p).isDirectory()) continue;
    const mpath = join(p, "manifest.json");
    if (!existsSync(mpath)) continue;
    const m = ManifestSchema.safeParse(readJson(mpath));
    if (!m.success) {
      printLine(o, fail(o, `${display(mpath)}: invalid manifest`), { file: display(mpath), error: "manifest schema" });
      code = Math.max(code, 1);
      continue;
    }
    const problems: string[] = [];
    m.data.course.forEach((id, i) => {
      const e = levels.get(`core/${id}`);
      if (!e) problems.push(`course id ${id} has no compiled file in core/`);
      else if (e.level.course?.slot !== i + 1) problems.push(`course[${i}] ${id} has slot ${e.level.course?.slot}`);
    });
    for (const id of m.data.fixtures) if (!levels.has(`fixtures/${id}`)) problems.push(`fixture ${id} missing`);
    for (const key of levels.keys()) {
      const [dir, id] = key.split("/") as [string, string];
      if (dir === "core" && !m.data.course.includes(id)) problems.push(`core/${id} not listed in manifest`);
      if (dir === "fixtures" && !m.data.fixtures.includes(id)) problems.push(`fixtures/${id} not listed in manifest`);
    }
    for (const pr of problems) printLine(o, fail(o, `${display(mpath)}: ${pr}`), { file: display(mpath), error: pr });
    if (problems.length > 0) code = Math.max(code, 1);
    else printLine(o, `${ok(o, "OK")} ${display(mpath)}`, { file: display(mpath), ok: true });
  }
  if (files.length === 0) {
    console.error("no compiled levels found");
    return 3;
  }
  return code;
}
