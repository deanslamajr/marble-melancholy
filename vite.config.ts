import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

function gitCommit(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    // Vite writes vite.config.ts.timestamp-*.mjs beside this file while loading it.
    const dirty = execSync("git status --porcelain", { encoding: "utf8" })
      .split("\n")
      .some((l) => l.trim() !== "" && !l.includes("vite.config.ts.timestamp-"));
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return "nogit";
  }
}

export default defineConfig({
  base: "./",
  plugins: [preact()],
  define: {
    BUILD_VERSION: JSON.stringify(pkg.version),
    BUILD_COMMIT: JSON.stringify(gitCommit()),
  },
  json: { stringify: true },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
  },
  // The generator worker (G16) is a module worker; ES output lets its pipeline split into chunks.
  worker: { format: "es" },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true },
});
