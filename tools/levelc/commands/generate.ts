import { DIFFICULTIES, type Difficulty } from "../../../src/level/generate/generate";
import { generateLevel } from "../../../src/level/generate/pipeline";
import { THEME_IDS, type ThemeId } from "../../../src/level/types";
import { display, writeJson, writeText } from "../fs";
import { fail, ok, printLine, type OutOpts } from "../format";

export interface GenerateOpts extends OutOpts {
  seed?: string;
  difficulty?: string;
  theme?: string;
  out?: string;
  compiled?: string;
  attempts?: string;
}

/** Generate a course; writes the YAML source to --out (or stdout) and optionally the stamped JSON. */
export async function generateCommand(o: GenerateOpts): Promise<number> {
  const seed = Number(o.seed);
  if (
    o.seed === undefined ||
    !/^\d+$/.test(o.seed) ||
    !Number.isSafeInteger(seed) ||
    seed > 0xffffffff
  ) {
    console.error("--seed must be an integer 0..4294967295");
    return 3;
  }
  const difficulty = (o.difficulty ?? "medium").toLowerCase() as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) {
    console.error(`--difficulty must be one of ${DIFFICULTIES.join(", ")}`);
    return 3;
  }
  if (o.theme !== undefined && !THEME_IDS.includes(o.theme as ThemeId)) {
    console.error(`--theme must be one of ${THEME_IDS.join(", ")}`);
    return 3;
  }
  const maxAttempts = o.attempts === undefined ? undefined : Number(o.attempts);
  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
    console.error("--attempts must be a positive integer");
    return 3;
  }
  const r = await generateLevel({
    seed,
    difficulty,
    theme: o.theme as ThemeId | undefined,
    maxAttempts,
  });
  if (!r.ok) {
    printLine(o, fail(o, r.error), { ok: false, error: r.error, failures: r.failures });
    if (!o.json) for (const f of r.failures) console.error(`  ${f}`);
    return 2;
  }
  const s = r.level.solution;
  const summary = `${ok(o, "OK")} ${r.level.id} "${r.level.name}" ${difficulty} seed=${seed} attempts=${r.attempts} v=${r.version} shape=${r.stats.shape} turns=${r.stats.turns} forks=${r.stats.forks} line=${r.line} segments=${r.segments.join(",")} GOAL tick=${s.ticks} time=${(s.ticks / 120).toFixed(2)}s par=${r.level.timing.par} limit=${r.level.timing.timeLimit}`;
  const json = {
    ok: true,
    id: r.level.id,
    name: r.level.name,
    difficulty,
    seed,
    attempts: r.attempts,
    layoutSeed: r.layoutSeed,
    version: r.version,
    stats: r.stats,
    line: r.line,
    segments: r.segments,
    ticks: s.ticks,
    par: r.level.timing.par,
    timeLimit: r.level.timing.timeLimit,
    out: o.out ? display(o.out) : undefined,
    compiled: o.compiled ? display(o.compiled) : undefined,
  };
  if (o.compiled) writeJson(o.compiled, r.level);
  if (o.out) {
    writeText(o.out, r.sourceText);
    printLine(o, `${summary} → ${display(o.out)}`, json);
  } else if (o.json) {
    console.log(JSON.stringify({ ...json, source: r.sourceText }));
  } else {
    process.stdout.write(r.sourceText);
    if (!o.quiet) console.error(summary);
  }
  return 0;
}
