import { expect, test, type Page } from "@playwright/test";
import { openGame, startRacing } from "./helpers";

// Visual sanity rather than pixel baselines (baselines differ per OS and engine): the world canvas
// must actually draw a varied picture, both behind the title and during a race.
async function canvasStats(page: Page): Promise<{ colours: number; opaque: number }> {
  return page.evaluate(() => {
    const c = document.querySelector("canvas")!;
    const ctx = c.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const seen = new Set<number>();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      if (data[i + 3]! > 0) opaque++;
      seen.add(((data[i]! >> 3) << 10) | ((data[i + 1]! >> 3) << 5) | (data[i + 2]! >> 3));
    }
    return { colours: seen.size, opaque: opaque / (data.length / 28) };
  });
}

test("the world canvas draws a course behind the title and in a race", async ({ page }) => {
  await openGame(page);
  await page.waitForTimeout(500);
  const title = await canvasStats(page);
  expect(title.opaque).toBeGreaterThan(0.95);
  expect(title.colours).toBeGreaterThan(20);
  await startRacing(page);
  await page.waitForTimeout(500);
  const race = await canvasStats(page);
  expect(race.colours).toBeGreaterThan(20);
});
