import { expect, test } from "@playwright/test";
import { collectErrors, openGame, state } from "./helpers";

test("Extra Courses lists the shipped extras and plays one as a single race", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page);
  await page.getByRole("menuitem", { name: "EXTRA COURSES" }).click();
  await expect(page.getByTestId("extra-courses")).toBeVisible();
  await expect(page.getByTestId("extra-row")).toHaveCount(8);
  await page.getByTestId("extra-row").first().getByRole("button", { name: "PLAY" }).click();
  await expect(page.getByTestId("race-intro")).toContainText("EXTRA COURSE");
  await expect(page.getByTestId("race-intro")).toContainText("PUDDLE HOP");
  expect(await page.evaluate(() => location.hash)).toBe("#/play/extra/puddle-hop");
  expect(errors).toEqual([]);
});

test("a shared generated-course link boots straight into that race", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, "#/play/generated/easy/777");
  // On a slow machine the intro can pass before the first poll; the HUD label outlasts it.
  await expect(page.getByTestId("hud")).toContainText("GENERATED", { timeout: 20_000 });
  expect(await page.evaluate(() => location.hash)).toBe("#/play/generated/easy/777");
  expect(errors).toEqual([]);
});

test("Generate Course: difficulty, regenerate and save to Custom Races", async ({ page }) => {
  const errors = collectErrors(page);
  await openGame(page, "#/generate/medium/1234");
  const status = page.getByTestId("gen-status");
  await expect(status).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByTestId("gen-seed")).toHaveValue("1234");
  await page.getByTestId("gen-hard").click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/generate/hard/1234");
  await expect(status).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await expect(page.getByTestId("gen-metrics")).toContainText("FRAGILITY");
  await expect(page.getByTestId("gen-input-hint")).toHaveCount(0);
  await expect(page.getByTestId("gen-nightmare")).toBeVisible();
  const name = (await status.locator(".gen-name").innerText()).trim();
  await page.getByTestId("gen-save").click();
  await expect(page.getByText(/saved ".*" to Custom Races/)).toBeVisible();
  await page.getByTestId("gen-regenerate").click();
  await expect.poll(() => page.evaluate(() => location.hash)).not.toBe("#/generate/hard/1234");
  await page.goto("/?e2e=1#/custom");
  await expect(page.getByTestId("custom-row").filter({ hasText: name })).toHaveCount(1);
  expect(await state(page)).toBe("custom");
  expect(errors).toEqual([]);
});

test("the builder lists extra courses and makes a draft from a generated course", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openGame(page, "#/builder");
  await expect(page.getByTestId("builder-home")).toBeVisible();
  const group = page.getByTestId("examples-select").locator('optgroup[label="Extra courses"]');
  await expect(group.locator("option")).toHaveCount(8);
  await page.getByTestId("generate-seed").fill("31337");
  await page.getByTestId("generate-draft").click();
  await expect(page.getByTestId("editor")).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
