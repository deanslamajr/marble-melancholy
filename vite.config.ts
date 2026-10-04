import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  base: "./",
  plugins: [preact()],
  define: {
    BUILD_VERSION: JSON.stringify(pkg.version),
  },
  json: { stringify: true },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true },
});
