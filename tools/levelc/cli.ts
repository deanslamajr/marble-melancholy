// mmlevel — headless level builder CLI (§6.3).
import { Command } from "commander";
import { BUILDER_VERSION } from "../../src/level/version";
import { buildAllCommand } from "./commands/buildAll";
import { checkCommand } from "./commands/check";
import { compileCommand } from "./commands/compile";
import { generateCommand } from "./commands/generate";
import { infoCommand } from "./commands/info";
import { pathCommand } from "./commands/path";
import { schemaCommand } from "./commands/schema";
import { testplayCommand } from "./commands/testplay";
import { traceCommand } from "./commands/trace";
import { validateCommand } from "./commands/validate";

const program = new Command();
program
  .name("mmlevel")
  .description("Marble Melancholy level builder: YAML source → validated, solved, stamped JSON")
  .version(BUILDER_VERSION)
  .option("--json", "machine-readable output, one JSON object per line")
  .option("--no-color", "disable ANSI colours");

type Opts = Record<string, unknown>;
const globals = () => program.opts<{ json?: boolean; color?: boolean }>();
const run = (fn: () => Promise<number>) => {
  fn()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error((e as Error).stack ?? String(e));
      process.exit(3);
    });
};
const merge = (o: Opts) => ({ ...globals(), ...o, json: Boolean(o.json ?? globals().json) });

program
  .command("compile")
  .argument("<src...>", "source files or directories")
  .option("--out <dir>", "output directory (default mirrors levels/src under levels/compiled)")
  .option("--json")
  .option("--allow-unsolved", "validate and solve without writing; print draft diagnostics")
  .option("--quiet")
  .action((srcs: string[], o: Opts) => run(() => compileCommand(srcs, merge(o))));

program
  .command("validate")
  .argument("<src...>")
  .option("--json")
  .option("--warnings-as-errors")
  .action((srcs: string[], o: Opts) => run(() => validateCommand(srcs, merge(o))));

program
  .command("testplay")
  .argument("<file>", "source (.level.yaml) or compiled (.level.json)")
  .option("--solution <yaml>", "override solution from a YAML file")
  .option("--json")
  .action((file: string, o: Opts) => run(() => testplayCommand(file, merge(o))));

program
  .command("trace")
  .argument("<file>")
  .option("--every <n>", "print every n ticks", "30")
  .option("--from <tick>")
  .option("--to <tick>")
  .option("--solution <yaml>")
  .option("--json")
  .action((file: string, o: Opts) => run(() => traceCommand(file, merge(o))));

program
  .command("path")
  .argument("<file>")
  .option("--layer <layer>", "heights|slopes|surfaces|walls", "heights")
  .option("--solution <yaml>")
  .action((file: string, o: Opts) => run(() => pathCommand(file, merge(o))));

program
  .command("check")
  .argument("<inputs...>", "compiled files or directories")
  .option("--json")
  .option("--no-replay", "schema + stamp only")
  .action((inputs: string[], o: Opts) => run(() => checkCommand(inputs, merge(o))));

program
  .command("build-all")
  .option("--src <dir>", "source root", "levels/src")
  .option("--out <dir>", "output root", "levels/compiled")
  .option("--json")
  .option("--quiet")
  .action((o: Opts) => run(() => buildAllCommand(merge(o))));

program
  .command("generate")
  .description("generate a procedural course (validated, solved and stamped like any other level)")
  .requiredOption("--seed <n>", "integer seed 0..4294967295")
  .option("--difficulty <d>", "easy | medium | hard", "medium")
  .option("--theme <id>", "theme id (default: chosen from the seed)")
  .option("--out <file>", "write the .level.yaml source here (default: stdout)")
  .option("--compiled <file>", "also write the stamped .level.json here")
  .option("--attempts <n>", "maximum layout attempts before giving up")
  .option("--json")
  .option("--quiet")
  .action((o: Opts) => run(() => generateCommand(merge(o))));

program
  .command("info")
  .argument("<file>")
  .option("--json")
  .action((file: string, o: Opts) => run(() => infoCommand(file, merge(o))));

program
  .command("schema")
  .option("--out <dir>", "output directory", "levels/schema")
  .action((o: Opts) => run(() => schemaCommand(merge(o))));

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(String(e));
  process.exit(3);
});
