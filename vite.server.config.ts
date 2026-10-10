// Bundles the score server (server/main.ts) and everything it uses into dist-server/ (P15).
import { defineConfig } from "vite";

export default defineConfig({
  json: { stringify: true },
  publicDir: false,
  build: {
    ssr: "server/main.ts",
    outDir: "dist-server",
    target: "node20",
    emptyOutDir: true,
    // pg does not survive bundling (circular CJS/ESM init), so the image installs it (Dockerfile.api).
    rollupOptions: { external: ["pg"], output: { entryFileNames: "server.mjs" } },
  },
  // Everything else goes into the bundle, so the image needs only Node and pg.
  ssr: { noExternal: true, target: "node" },
});
