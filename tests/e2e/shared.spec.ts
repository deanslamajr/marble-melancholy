import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openGame, state } from "./helpers";

const puddle = JSON.parse(
  readFileSync(
    new URL("../../levels/compiled/extras/puddle-hop.level.json", import.meta.url),
    "utf8",
  ),
);
const CODE = "hgksu4w";
const DATE = "2026-10-11T00:00:00Z";

function summary(code: string, name: string, times: number) {
  return {
    code,
    name,
    author: "Tester",
    par: 10,
    contentHash: "sha256:x",
    date: DATE,
    times,
    best: null,
  };
}

/** Serves Puddle Hop under CODE and empty boards; returns the shares posted. */
async function stubServer(
  page: Page,
): Promise<Array<{ level: { stamp: { contentHash: string } } }>> {
  const posts: Array<{ level: { stamp: { contentHash: string } } }> = [];
  await page.addInitScript(() => {
    // No system share sheet in tests: the link goes to the clipboard or the message.
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await page.route("**/api/boards**", (route) =>
    route.fulfill({ json: route.request().url().includes("?") ? { best: {} } : { table: [] } }),
  );
  await page.route(`**/api/courses/${CODE}`, (route) =>
    route.fulfill({ json: { code: CODE, level: puddle } }),
  );
  await page.route("**/api/courses", async (route) => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { code: "a2b3c4d" } });
  });
  return posts;
}

// P19: a share link opens the course's card; SAVE adds it to CUSTOM RACES, and SHARE there
// publishes it and shows its link.
test("a share link opens a course to save, share and play", async ({ page }) => {
  const posts = await stubServer(page);
  page.on("dialog", (d) => void d.accept());
  await openGame(page, `#/c/${CODE}`);
  await expect(page.getByTestId("shared-name")).toHaveText("PUDDLE HOP");
  await page.getByTestId("shared-save").click();
  await expect(page.getByTestId("shared-save")).toHaveText("SAVED");

  await page.evaluate(() => (location.hash = "#/custom"));
  const row = page.getByTestId("custom-row").filter({ hasText: "Puddle Hop" });
  await expect(row).toBeVisible();
  await row.getByTestId("custom-share").click();
  await expect(page.getByText(/#\/c\/a2b3c4d/)).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]!.level.stamp.contentHash).toBe(puddle.stamp.contentHash);

  await page.evaluate((c) => (location.hash = `#/c/${c}`), CODE);
  await page.getByTestId("shared-play").click();
  await expect.poll(() => state(page)).toMatch(/raceIntro|countdown|racing/);
});

test("the shared list sorts by newest or most raced and opens a course", async ({ page }) => {
  await page.route("**/api/courses?*", (route) => {
    const popular = new URL(route.request().url()).searchParams.get("sort") === "popular";
    const courses = popular
      ? [summary(CODE, "Busy Course", 9)]
      : [summary("a2b3c4d", "Fresh Course", 0)];
    return route.fulfill({ json: { courses, more: false } });
  });
  await page.route(`**/api/courses/${CODE}`, (route) =>
    route.fulfill({ json: { code: CODE, level: puddle } }),
  );
  await openGame(page);
  await page
    .getByTestId("title-menu")
    .getByRole("menuitem", { name: /SHARED COURSES$/ })
    .click();
  const rows = page.getByTestId("shared-row");
  await expect(rows).toHaveText([/Fresh Course/]);
  await page.getByRole("radio", { name: "MOST RACED" }).click();
  await expect(rows).toHaveText([/Busy Course/]);
  await rows.getByRole("button", { name: "OPEN" }).click();
  await expect(page.getByTestId("shared-name")).toHaveText("PUDDLE HOP");
});

test("a removed course's link says so", async ({ page }) => {
  await page.route("**/api/courses/*", (route) =>
    route.fulfill({ status: 410, json: { error: "this course was removed" } }),
  );
  await openGame(page, `#/c/${CODE}`);
  await expect(page.getByTestId("shared-error")).toHaveText("this course was removed");
});
