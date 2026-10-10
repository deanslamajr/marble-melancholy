import { expect, test, type Page } from "@playwright/test";
import { openGame, state } from "./helpers";

type Entry = { initials: string; ticks: number; date: string };
const DATE = "2026-10-10T00:00:00Z";

/** Plays the Puddle Hop extra course along its solution and waits for the result card. */
async function finishPuddleHop(page: Page): Promise<void> {
  await openGame(page, "#/extras");
  await page.evaluate(() => {
    window.__mm!.fastPhases(true);
    window.__mm!.autoplay(true);
  });
  await page.evaluate(() => (location.hash = "#/play/extra/puddle-hop"));
  // Fast phases skip the intro; the result card must keep its normal time.
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("racing");
  await page.evaluate(() => window.__mm!.fastPhases(false));
  await expect.poll(() => state(page), { timeout: 60_000 }).toBe("raceComplete");
}

// P17: a finish that makes the shared board asks for initials, uploads the course the first time
// the server asks for it, and shows the stored row.
test("a board-worthy time is saved with initials and highlighted", async ({ page }) => {
  test.setTimeout(90_000);
  const posts: Array<{ initials: string; level?: unknown; race: { ticks: number } }> = [];
  await page.route("**/api/boards/*", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { table: [] } });
    const body = route.request().postDataJSON();
    posts.push(body);
    if (!body.level) return route.fulfill({ status: 409, json: { error: "x", needLevel: true } });
    const table: Entry[] = [{ initials: body.initials, ticks: 1500, date: DATE }];
    return route.fulfill({ json: { ticks: 1500, index: 0, table } });
  });
  await finishPuddleHop(page);
  const field = page.getByTestId("board-initials");
  await expect(field).toBeVisible();
  await field.fill("xyz");
  await expect(field).toHaveValue("XYZ");
  await field.press("Enter");
  await expect(page.locator(".board-rows tr.hl")).toContainText("XYZ");
  expect(posts.map((p) => [p.initials, p.level !== undefined])).toEqual([
    ["XYZ", false],
    ["XYZ", true],
  ]);
  expect(await page.evaluate(() => localStorage.getItem("marble-melancholy.initials.v1"))).toBe(
    '"XYZ"',
  );
  // The card waits on the board, then CONTINUE returns to the list.
  expect(await state(page)).toBe("raceComplete");
  await page.getByTestId("race-continue").click();
  await expect.poll(() => state(page)).toBe("custom");
});

test("a time slower than a full board only shows the board", async ({ page }) => {
  const table: Entry[] = Array.from({ length: 10 }, (_, i) => ({
    initials: "FST",
    ticks: 100 + i,
    date: DATE,
  }));
  await page.route("**/api/boards/*", (route) => route.fulfill({ json: { table } }));
  await finishPuddleHop(page);
  await expect(page.getByTestId("race-board")).toContainText("ALL PLAYERS");
  await expect(page.locator(".board-rows tr")).toHaveCount(3);
  await expect(page.getByTestId("board-entry")).toHaveCount(0);
  await expect(page.getByTestId("race-continue")).toBeVisible();
});

test("the extras list shows each course's best time from its board", async ({ page }) => {
  await page.route("**/api/boards?*", async (route) => {
    const keys = new URL(route.request().url()).searchParams.get("h")!.split(",");
    expect(keys.length).toBeGreaterThan(1);
    const best = { [keys[0]!]: { initials: "DHS", ticks: 1234, date: DATE } };
    return route.fulfill({ json: { best } });
  });
  await openGame(page, "#/extras");
  const tops = page.getByTestId("extra-top");
  await expect(tops.first()).toHaveText("top 10.28s DHS");
  await expect(tops.nth(1)).toHaveText("top —");
});
