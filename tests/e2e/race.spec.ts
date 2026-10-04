import { expect, test } from "@playwright/test";
import { collectErrors, openGame, startRacing, state } from "./helpers";

test("a race runs, the marble responds to input and the HUD counts down", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await startRacing(page);
  await expect(page.getByTestId("hud")).toBeVisible();
  const t0 = Number(await page.getByTestId("hud-time-0").textContent());
  const h0 = await page.evaluate(() => window.__mm!.stateHash());
  await page.evaluate(() => window.__mm!.injectInput(0, 0, 1));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__mm!.injectInput(0, null));
  const h1 = await page.evaluate(() => window.__mm!.stateHash());
  expect(h1).not.toBe(h0);
  await expect
    .poll(async () => Number(await page.getByTestId("hud-time-0").textContent()))
    .toBeLessThan(t0);
  const perf = await page.evaluate(() => window.__mm!.perf());
  expect(perf.ticks).toBeGreaterThan(60);
  expect(errors).toEqual([]);
});

test("Escape pauses the sim and Escape resumes it", async ({ page }) => {
  await openGame(page);
  await startRacing(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pause-menu")).toBeVisible();
  expect(await state(page)).toBe("paused");
  const h0 = await page.evaluate(() => window.__mm!.stateHash());
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__mm!.stateHash())).toBe(h0);
  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toBe("racing");
  await expect(page.getByTestId("pause-menu")).toBeHidden();
});

test("running out of time ends the game and reaches the high-score flow", async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__mm!.fastPhases(true));
  await startRacing(page);
  await page.evaluate(() => window.__mm!.setTimer(0, 0.2));
  await expect
    .poll(() => state(page), { timeout: 15_000 })
    .toMatch(/gameOver|highScoreEntry|highScoreTable|title|attract/);
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        seen.add(await state(page));
        return [...seen].some((s) => /highScoreEntry|highScoreTable|title/.test(s));
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
