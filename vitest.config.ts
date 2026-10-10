import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    BUILD_VERSION: JSON.stringify("test"),
    BUILD_COMMIT: JSON.stringify("test"),
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/levels/**/*.test.ts",
      "tests/enforcement/**/*.test.ts",
      "tests/storage/**/*.test.ts",
      "tests/perf/**/*.test.ts",
      "tests/server/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
