import { expect, test } from "@playwright/test";
import { openGame } from "./helpers";

// D01/D25: the embedded replay of every race reproduces the stamped hash in every browser engine.
test("every race's embedded replay matches its stamped state hash", async ({ page }) => {
  await openGame(page);
  const ids = await page.evaluate(() => window.__mm!.courseIds());
  expect(ids.length).toBe(6);
  for (const id of ids) {
    const r = await page.evaluate((i) => window.__mm!.verifyReplay(i), id);
    expect(r.reached, id).toBe(true);
    expect(r.stateHash, id).toBe(r.expected);
  }
});
