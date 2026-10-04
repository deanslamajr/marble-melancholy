import { expect, test } from "@playwright/test";
import { collectErrors, openGame } from "./helpers";

test("new level → auto-solve → export JSON → playable from Custom Races", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, "#/builder");
  await expect(page.getByTestId("builder-home")).toBeVisible();
  await page.getByTestId("new-level").click();
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("topdown-view")).toBeVisible();
  await expect(page.getByTestId("validation-summary")).toHaveClass(/ok/);

  await page.getByTestId("auto-solve").click();
  await expect(page.getByTestId("solve-result")).toContainText("GOAL", { timeout: 20_000 });
  await expect(page.getByTestId("solve-result")).toHaveClass(/ok/);

  await page.getByTestId("export").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^untitled-\d+\.level\.json$/);

  await page.goto("/?e2e=1#/custom");
  await expect(page.getByTestId("custom-levels")).toBeVisible();
  const row = page.getByTestId("custom-row").filter({ hasText: /Untitled \d+/ });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "PLAY" }).click();
  await expect.poll(() => page.evaluate(() => window.__mm!.state())).toMatch(/raceIntro|countdown/);
  expect(errors).toEqual([]);
});

test("Tab switches the editor to the isometric preview", async ({ page }) => {
  await openGame(page, "#/builder");
  await page.getByTestId("new-level").click();
  await expect(page.getByTestId("topdown-view")).toBeVisible();
  await page.getByTestId("topdown-view").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("iso-view")).toBeVisible();
});
