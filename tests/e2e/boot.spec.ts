import { expect, test } from "@playwright/test";
import { collectErrors, openGame } from "./helpers";

test("boots to the title menu without errors", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await expect(page).toHaveTitle(/Marble Melancholy/);
  await expect(page.getByTestId("title-screen")).toBeVisible();
  const menu = page.getByTestId("title-menu");
  for (const label of ["PLAY", "CUSTOM RACES", "LEVEL BUILDER", "HIGH SCORES", "SETTINGS"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(`^(▶ )?${label}$`) })).toBeVisible();
  }
  await expect(page.locator("canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("settings and high scores open from the title and return", async ({ page }) => {
  await openGame(page);
  await page
    .getByTestId("title-menu")
    .getByRole("menuitem", { name: /SETTINGS$/ })
    .click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.getByTestId("settings-back").click();
  await expect(page.getByTestId("title-screen")).toBeVisible();
  await page
    .getByTestId("title-menu")
    .getByRole("menuitem", { name: /HIGH SCORES$/ })
    .click();
  await expect(page.getByTestId("highscores")).toBeVisible();
});

test("all course levels load in the browser", async ({ page }) => {
  await openGame(page);
  const ids = await page.evaluate(() => window.__mm!.courseIds());
  expect(ids).toEqual(["practice", "beginner", "intermediate", "aerial", "silly", "ultimate"]);
});
