import { expect, test, type Page } from "@playwright/test";
import { openGame, state } from "./helpers";

const finishedRaces = (page: Page) =>
  page.evaluate(() => window.__mm!.replayRecording()?.live.length ?? 0);

/** Starts a 1P course with player 1 following each race's solution, and waits for race 1 to end. */
async function finishFirstRace(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__mm!.fastPhases(true);
    window.__mm!.autoplay(true);
    window.__mm!.startCourse(1);
  });
  await expect.poll(() => finishedRaces(page), { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
}

// The server verifies scores by replaying recordings (P15); live play must record exactly what
// it simulated. No test hook that alters the sim (skipIntro, setTimer) runs before the check.
test("a finished course race replays to the state it reached live", async ({ page }) => {
  test.setTimeout(120_000);
  await openGame(page);
  await finishFirstRace(page);
  const r = await page.evaluate(() => window.__mm!.replayRecording());
  expect(r!.replayed[0]).toBe(r!.live[0]);
});

test("a qualifying score is sent with its recording and the shared table shows it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let posted: { initials: string; player: number; recording: { races: unknown[] } } | null = null;
  await page.route("**/api/scores/campaign", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { table: [] } });
    posted = route.request().postDataJSON();
    const row = { initials: "TST", score: 1234, race: 2, players: 1, date: "2026-10-10T00:00:00Z" };
    return route.fulfill({ json: { score: 1234, race: 2, index: 0, table: [row] } });
  });
  await openGame(page);
  await finishFirstRace(page);
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("racing");
  await page.evaluate(() => {
    window.__mm!.autoplay(false);
    window.__mm!.setTimer(0, 0.3);
  });
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe("highScoreEntry");
  await page.keyboard.type("TST");
  await page.keyboard.press("Enter");
  await expect.poll(() => posted !== null, { timeout: 10_000 }).toBe(true);
  expect(posted!).toMatchObject({ initials: "TST", player: 0 });
  expect(posted!.recording.races).toHaveLength(2);
  await expect(page.getByTestId("scores-source")).toHaveText("ALL PLAYERS");
});
