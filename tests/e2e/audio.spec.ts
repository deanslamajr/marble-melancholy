import { expect, test, type Page } from "@playwright/test";
import { openGame, state } from "./helpers";

const audio = (page: Page) => page.evaluate(() => window.__mm!.audio());

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (h ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("input never restarts the music; only a new race does", async ({ page }) => {
  await openGame(page);
  expect((await audio(page)).context).toBe("none");
  await page.mouse.click(5, 5);
  await expect.poll(async () => (await audio(page)).context).toBe("running");
  expect((await audio(page)).musicStarts).toBe(1);

  for (let i = 0; i < 3; i++) await page.mouse.click(5 + i, 5);
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  expect((await audio(page)).musicStarts).toBe(1);

  await page.evaluate(() => window.__mm!.startCourse(1));
  await expect.poll(async () => (await audio(page)).musicStarts).toBe(2);
  await page.evaluate(() => window.__mm!.skipIntro());
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe("racing");
  await page.mouse.click(5, 5);
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toBe("paused");
  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toBe("racing");
  expect((await audio(page)).musicStarts).toBe(2);
});

test("hiding the page suspends audio and pauses the race; blur only suspends", async ({ page }) => {
  await openGame(page);
  await setHidden(page, true);
  await setHidden(page, false);
  expect((await audio(page)).context).toBe("none");

  await page.mouse.click(5, 5);
  await expect.poll(async () => (await audio(page)).context).toBe("running");
  await page.evaluate(() => window.__mm!.startCourse(1));
  await page.evaluate(() => window.__mm!.skipIntro());
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe("racing");

  await setHidden(page, true);
  await expect.poll(async () => (await audio(page)).context).toBe("suspended");
  expect(await state(page)).toBe("paused");
  await setHidden(page, false);
  await expect.poll(async () => (await audio(page)).context).toBe("running");
  expect(await state(page)).toBe("paused");

  await page.keyboard.press("Escape");
  await expect.poll(() => state(page)).toBe("racing");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect.poll(async () => (await audio(page)).context).toBe("suspended");
  expect(await state(page)).toBe("racing");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await audio(page)).context).toBe("running");
  expect((await audio(page)).musicStarts).toBe(2);
});
