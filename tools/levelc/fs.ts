import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
export const SRC_DIR = join(ROOT, "levels/src");
export const COMPILED_DIR = join(ROOT, "levels/compiled");

export class IoError extends Error {}

export function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new IoError(`cannot read ${path}: ${(e as Error).message}`);
  }
}

export function readJson(path: string): unknown {
  const text = readText(path);
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new IoError(`invalid JSON in ${path}: ${(e as Error).message}`);
  }
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Compiled files on disk: 2-space JSON + newline (§5.4). */
export function writeJson(path: string, value: unknown): void {
  writeText(path, JSON.stringify(value, null, 2) + "\n");
}

export function removeFile(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

export function walk(
  dir: string,
  filter: (p: string) => boolean,
  skipDirs: string[] = [],
): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (skipDirs.includes(name)) continue;
      out.push(...walk(p, filter, skipDirs));
    } else if (filter(p)) {
      out.push(p);
    }
  }
  return out;
}

export const isSourceFile = (p: string) => p.endsWith(".level.yaml") || p.endsWith(".level.yml");
export const isCompiledFile = (p: string) => p.endsWith(".level.json");

/** Expand dirs / files into a list of files matching a predicate. */
export function expandInputs(
  inputs: string[],
  filter: (p: string) => boolean,
  skipDirs: string[] = [],
): string[] {
  const out: string[] = [];
  for (const i of inputs) {
    const p = resolve(i);
    if (existsSync(p) && statSync(p).isDirectory()) out.push(...walk(p, filter, skipDirs));
    else out.push(p);
  }
  return out;
}

/** levels/src/<sub>/x.level.yaml → levels/compiled/<sub>; anything else → levels/compiled/custom. */
export function defaultOutDir(srcPath: string, srcRoot = SRC_DIR, outRoot = COMPILED_DIR): string {
  const rel = relative(srcRoot, resolve(srcPath));
  if (rel.startsWith("..") || rel.startsWith(sep)) return join(outRoot, "custom");
  return join(outRoot, dirname(rel));
}

export function display(p: string): string {
  const r = relative(process.cwd(), p);
  return r.startsWith("..") ? p : r;
}
