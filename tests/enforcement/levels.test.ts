// Provenance and freshness (D13, D18, D20b): committed compiled levels are exactly what the
// current sources compile to, and every one carries a valid mmlevel stamp.
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { verifyStamp } from "../../src/level/stamp";
import type { CompiledLevel } from "../../src/level/types";
import { BUILDER_NAME } from "../../src/level/version";
import { buildAllCommand } from "../../tools/levelc/commands/buildAll";
import { COMPILED, SOURCES, readJson } from "../helpers";

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith(".json")) out.push(p);
  }
  return out;
}

const committed = files(COMPILED)
  .map((f) => relative(COMPILED, f))
  .sort();

describe("provenance", () => {
  for (const f of committed.filter((x) => x.endsWith(".level.json"))) {
    it(`${f} has a valid ${BUILDER_NAME} stamp`, async () => {
      const level = readJson<CompiledLevel>(join(COMPILED, f));
      expect(level.stamp.builder).toBe(BUILDER_NAME);
      expect(level.stamp.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(level.stamp.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(await verifyStamp(level)).toEqual({ ok: true });
    });
  }
});

describe("freshness", () => {
  const out = mkdtempSync(join(tmpdir(), "mm-fresh-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("recompiling every source reproduces levels/compiled byte-for-byte", async () => {
    const code = await buildAllCommand({ src: SOURCES, out, quiet: true });
    expect(code).toBe(0);
    const rebuilt = files(out)
      .map((f) => relative(out, f))
      .sort();
    expect(rebuilt).toEqual(committed);
    for (const f of committed) {
      expect(readJson(join(out, f)), f).toEqual(readJson(join(COMPILED, f)));
    }
  });
});
