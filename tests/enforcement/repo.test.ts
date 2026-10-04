// Repository rules (D13, D18, D20): no trademarks, no inline levels, one glob importer, clean
// layering, and a game bundle that never reaches the YAML parser.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../helpers";

function walk(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out.sort();
}

const isCode = (f: string) => /\.(ts|tsx)$/.test(f);
const SRC = join(ROOT, "src");
const srcFiles = walk(SRC, isCode);
const rel = (f: string) => relative(ROOT, f).replaceAll("\\", "/");
const read = (f: string) => readFileSync(f, "utf8");

/** Static (non-dynamic) import specifiers of a module. */
function staticImports(text: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const m of text.matchAll(re)) {
    if (/^\s*(?:import|export)\s+type\s/.test(m[0])) continue;
    out.push(m[1]!);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

describe("no trademarks", () => {
  it("src, levels and index.html never name the original game or its publisher", () => {
    const files = [
      ...srcFiles,
      ...walk(join(ROOT, "levels"), (f) => /\.(ya?ml|json)$/.test(f)),
      join(ROOT, "index.html"),
    ];
    const hits = files.filter((f) => /marble\s*madness|atari/i.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});

describe("no inline levels", () => {
  it('only src/level mentions the compiled format "mm-level/1"', () => {
    const hits = srcFiles
      .filter((f) => !rel(f).startsWith("src/level/"))
      .filter((f) => read(f).includes('"mm-level/1"'))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("no module imports JSON or YAML files directly", () => {
    const hits = srcFiles.filter((f) =>
      staticImports(read(f)).some((s) => /\.(json|ya?ml)(\?.*)?$/.test(s)),
    );
    expect(hits.map(rel)).toEqual([]);
  });

  it("only src/levels/manifest.ts uses import.meta.glob, and only on /levels/compiled", () => {
    const users = srcFiles.filter((f) => read(f).includes("import.meta.glob")).map(rel);
    expect(users).toEqual(["src/levels/manifest.ts"]);
    const text = read(join(SRC, "levels", "manifest.ts"));
    const globs = [...text.matchAll(/import\.meta\.glob\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(globs.length).toBeGreaterThan(0);
    for (const g of globs) expect(g!.startsWith("/levels/compiled/")).toBe(true);
  });
});

describe("layering", () => {
  const pure = srcFiles.filter((f) => /^src\/(core|sim|level)\//.test(rel(f)));

  it("core, sim and level never import render, ui, audio, input, builder or preact", () => {
    const bad: string[] = [];
    for (const f of pure) {
      for (const s of staticImports(read(f))) {
        const target = resolveLocal(f, s);
        const r = target ? rel(target) : s;
        if (/^src\/(render|ui|audio|input|builder|app|game|storage)\//.test(r) || /preact/.test(r))
          bad.push(`${rel(f)} → ${r}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("core, sim and level do not touch the DOM", () => {
    const bad = pure
      .filter((f) => /\b(document|window|localStorage|requestAnimationFrame)\s*[.(]/.test(read(f)))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it("sim and core never read wall-clock time or Math.random", () => {
    const bad = srcFiles
      .filter((f) => /^src\/(core|sim)\//.test(rel(f)))
      .filter((f) => /Math\.random\(|Date\.now\(|performance\.now\(/.test(read(f)))
      .map(rel);
    expect(bad).toEqual([]);
  });
});

describe("game bundle", () => {
  it("the static import graph from src/main.tsx never reaches yaml (builder is lazy)", () => {
    const seen = new Set<string>();
    const bare = new Set<string>();
    const stack = [join(SRC, "main.tsx")];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const s of staticImports(read(f))) {
        const t = resolveLocal(f, s);
        if (t) stack.push(t);
        else if (!s.startsWith(".")) bare.add(s.split("/")[0]!);
      }
    }
    expect([...bare]).not.toContain("yaml");
    expect([...seen].map(rel)).not.toContain("src/level/parse.ts");
    expect([...seen].some((f) => rel(f).startsWith("src/builder/"))).toBe(false);
    expect(seen.size).toBeGreaterThan(20);
  });
});
