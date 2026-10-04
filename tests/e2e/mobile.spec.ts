import { expect, test, type Page } from "@playwright/test";
import { collectErrors, openGame, state } from "./helpers";

type Pt = { x: number; y: number };

/** Real touch events on chromium (CDP); synthetic touch events on the canvas elsewhere. */
async function touch(page: Page, type: "touchstart" | "touchmove" | "touchend", p: Pt) {
  if (test.info().project.use.browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const kind = (
      { touchstart: "touchStart", touchmove: "touchMove", touchend: "touchEnd" } as const
    )[type];
    await cdp.send("Input.dispatchTouchEvent", {
      type: kind,
      touchPoints: type === "touchend" ? [] : [{ x: p.x, y: p.y, id: 1 }],
    });
    await cdp.detach();
    return;
  }
  await page.evaluate(
    ([type, x, y]) => {
      // WebKit has no Touch constructor; the handler only reads changedTouches.
      const target = document.querySelector("canvas.world")!;
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "changedTouches", {
        value: [{ identifier: 1, target, clientX: x, clientY: y }],
      });
      target.dispatchEvent(e);
    },
    [type, p.x, p.y] as const,
  );
}

async function marble(page: Page) {
  return (await page.evaluate(() => window.__mm!.marble(0)))!;
}

test("title screen fits, PLAY starts a race and the touch stick steers the marble", async ({
  page,
}, info) => {
  const errors = collectErrors(page);
  await openGame(page);
  const title = page.getByTestId("title-screen");
  await expect(title).toBeVisible();
  await expect(page.getByText(/^BETA /)).toBeVisible();

  const vp = page.viewportSize()!;
  for (const item of await page.getByTestId("title-menu").getByRole("menuitem").all()) {
    const box = (await item.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  }
  await page.screenshot({ path: info.outputPath("title.png") });

  await page.getByRole("menuitem", { name: "PLAY" }).tap();
  await expect.poll(() => state(page)).toBe("playerSelect");
  await page.getByRole("menuitem", { name: "1 PLAYER" }).tap();
  await expect.poll(() => state(page)).toMatch(/raceIntro|countdown|racing/);
  await page.evaluate(() => window.__mm!.skipIntro());
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe("racing");
  await expect(page.locator(".touch-pause")).toBeVisible();

  // Drift without input, then the same duration with the stick held, from a fresh rest.
  const a0 = await marble(page);
  await page.waitForTimeout(1000);
  const a1 = await marble(page);

  const canvas = (await page.locator("canvas.world").boundingBox())!;
  const origin = { x: canvas.x + canvas.width * 0.25, y: canvas.y + canvas.height * 0.5 };
  await touch(page, "touchstart", origin);
  await touch(page, "touchmove", { x: origin.x + 30, y: origin.y + 20 });
  await touch(page, "touchmove", { x: origin.x + 60, y: origin.y + 40 });
  await expect(page.locator(".vstick")).toBeVisible();
  await page.screenshot({ path: info.outputPath("racing.png") });
  const b0 = await marble(page);
  await page.waitForTimeout(1000);
  const b1 = await marble(page);
  await touch(page, "touchend", origin);
  await expect(page.locator(".vstick")).toBeHidden();

  const drift = Math.hypot(a1.x - a0.x, a1.y - a0.y);
  const steered = Math.hypot(b1.x - b0.x, b1.y - b0.y);
  info.annotations.push({
    type: "marble",
    description: `drift ${drift.toFixed(3)} steered ${steered.toFixed(3)}`,
  });
  expect(steered).toBeGreaterThan(drift + 0.5);
  expect(await state(page)).toBe("racing");
  expect(errors).toEqual([]);
});
