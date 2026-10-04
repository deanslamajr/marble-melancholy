import { expect, type Page } from "@playwright/test";

/** Console errors and uncaught exceptions collected for the page's lifetime. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Open the game with the test API (D37) and wait for it to boot to the title. */
export async function openGame(page: Page, hash = "#/"): Promise<void> {
  await page.goto(`/?e2e=1${hash}`);
  await page.waitForFunction(() => window.__mm !== undefined);
  await expect.poll(() => page.evaluate(() => window.__mm!.state())).not.toBe("boot");
}

export function state(page: Page): Promise<string> {
  return page.evaluate(() => window.__mm!.state());
}

/** Start the 1P course and skip straight to racing. */
export async function startRacing(page: Page): Promise<void> {
  await page.evaluate(() => window.__mm!.startCourse(1));
  await expect.poll(() => state(page)).toMatch(/raceIntro|countdown|racing/);
  await page.evaluate(() => window.__mm!.skipIntro());
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe("racing");
}
