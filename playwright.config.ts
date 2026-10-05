import { defineConfig, devices, type LaunchOptions } from "@playwright/test";

type Engine = "chromium" | "firefox" | "webkit";

/** Test runs never play sound. WebKit has no mute switch, so it relies on the page staying silent. */
const MUTED: Record<Engine, LaunchOptions> = {
  chromium: { args: ["--mute-audio"] },
  firefox: { firefoxUserPrefs: { "media.volume_scale": "0.0" } },
  webkit: {},
};

function device(name: string) {
  const d = devices[name]!;
  return { ...d, launchOptions: MUTED[d.defaultBrowserType as Engine] };
}

export default defineConfig({
  testDir: "tests",
  testMatch: "e2e/**/*.spec.ts",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: "e2e/mobile.spec.ts", use: device("Desktop Chrome") },
    { name: "firefox", testIgnore: "e2e/mobile.spec.ts", use: device("Desktop Firefox") },
    { name: "webkit", testIgnore: "e2e/mobile.spec.ts", use: device("Desktop Safari") },
    ...(
      [
        ["pixel", "Pixel 7"],
        ["pixel-landscape", "Pixel 7 landscape"],
        ["iphone", "iPhone 14"],
        ["iphone-landscape", "iPhone 14 landscape"],
        ["iphone15-landscape", "iPhone 15 landscape"],
        ["galaxy-landscape", "Galaxy S24 landscape"],
      ] as const
    ).map(([name, deviceName]) => ({
      name,
      testMatch: "e2e/mobile.spec.ts",
      use: device(deviceName),
    })),
    // Frame timing needs an otherwise idle machine, so it runs alone after the E2E projects.
    {
      name: "perf",
      testMatch: "perf/**/*.spec.ts",
      use: device("Desktop Chrome"),
      dependencies: ["chromium", "firefox", "webkit"],
    },
  ],
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
