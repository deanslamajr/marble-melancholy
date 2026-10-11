// Bundles the score server (server/main.ts), its admin command and everything they use into
// dist-server/ (P15, P19).
import { defineConfig } from "vite";

export default defineConfig({
  json: { stringify: true },
  publicDir: false,
  build: {
    ssr: true,
    outDir: "dist-server",
    target: "node20",
    emptyOutDir: true,
    // pg does not survive bundling (circular CJS/ESM init), so the image installs it (Dockerfile.api).
    // admin.mjs is the moderation command for shared courses (P19).
    rollupOptions: {
      input: { server: "server/main.ts", admin: "server/admin.ts" },
      external: ["pg"],
      output: { entryFileNames: "[name].mjs" },
    },
  },
  // Everything else goes into the bundle, so the image needs only Node and pg.
  ssr: { noExternal: true, target: "node" },
});
