import { expect, test } from "@playwright/test";
import { openGame } from "../e2e/helpers";

// D04: 60 fps at 960×540. Headless frame pacing is noisy, so the budget is on work per frame.
test("Ultimate renders well inside the frame budget", async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__mm!.startRace(5));
  await expect.poll(() => page.evaluate(() => window.__mm!.state())).toMatch(/raceIntro|countdown/);
  await page.evaluate(() => window.__mm!.skipIntro());
  await expect.poll(() => page.evaluate(() => window.__mm!.state())).toBe("racing");
  await page.evaluate(() => window.__mm!.injectInput(0, 0.3, 1));
  await page.waitForTimeout(4000);
  const perf = await page.evaluate(() => window.__mm!.perf());
  test.info().annotations.push({ type: "perf", description: JSON.stringify(perf) });
  expect(perf.frames).toBeGreaterThan(60);
  expect(perf.frameMs).toBeLessThan(8);
});
