import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { collectErrors, openGame, startRacing, state } from "./helpers";

type Pt = { x: number; y: number };

/** The engine actually running (device projects set it through defaultBrowserType). */
function engine(page: Page): string | undefined {
  return page.context().browser()?.browserType().name();
}

/** One CDP session per page: a touch that starts in one session cannot move in another. */
const sessions = new WeakMap<Page, CDPSession>();

/** Real touch events on chromium (CDP); synthetic touch events at the same point elsewhere. */
async function touch(page: Page, type: "touchstart" | "touchmove" | "touchend", p: Pt) {
  if (engine(page) === "chromium") {
    let cdp = sessions.get(page);
    if (!cdp) {
      cdp = await page.context().newCDPSession(page);
      sessions.set(page, cdp);
    }
    const kind = (
      { touchstart: "touchStart", touchmove: "touchMove", touchend: "touchEnd" } as const
    )[type];
    await cdp.send("Input.dispatchTouchEvent", {
      type: kind,
      touchPoints: type === "touchend" ? [] : [{ x: p.x, y: p.y, id: 1 }],
    });
    return;
  }
  await page.evaluate(
    ([type, x, y]) => {
      // WebKit has no Touch constructor; the handler only reads changedTouches.
      const target = document.elementFromPoint(x, y) ?? document.body;
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

type Box = { x: number; y: number; width: number; height: number };

/** Waits for one second of sim time (120 ticks), however slowly frames arrive under load. */
async function simSecond(page: Page) {
  const t0 = await page.evaluate(() => window.__mm!.perf().ticks);
  await page.waitForFunction((t) => window.__mm!.perf().ticks >= t + 120, t0, { polling: 20 });
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Marble travel in one sim second without input, then in one with the stick dragged down and
 * right from `origin`. Returns the stick's on-screen box too.
 */
async function driftAndSteer(page: Page, origin: Pt) {
  const a0 = await marble(page);
  await simSecond(page);
  const a1 = await marble(page);
  await touch(page, "touchstart", origin);
  await touch(page, "touchmove", { x: origin.x + 30, y: origin.y + 20 });
  await touch(page, "touchmove", { x: origin.x + 60, y: origin.y + 40 });
  await expect(page.locator(".vstick")).toBeVisible();
  const stick = (await page.locator(".vstick").boundingBox())!;
  const b0 = await marble(page);
  await simSecond(page);
  const b1 = await marble(page);
  await touch(page, "touchend", origin);
  await expect(page.locator(".vstick")).toBeHidden();
  return {
    drift: Math.hypot(a1.x - a0.x, a1.y - a0.y),
    steered: Math.hypot(b1.x - b0.x, b1.y - b0.y),
    stick,
  };
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
  const canvas = (await page.locator("canvas.world").boundingBox())!;
  const origin = { x: canvas.x + canvas.width * 0.25, y: canvas.y + canvas.height * 0.5 };
  const { drift, steered, stick } = await driftAndSteer(page, origin);
  // The stick scales with the stage: 13 % of its shorter side, within 40–90 px.
  const radius = stick.width / 2;
  expect(radius).toBeGreaterThanOrEqual(40 - 1);
  expect(radius).toBeLessThanOrEqual(
    Math.max(40, 0.13 * Math.min(canvas.width, canvas.height)) + 1,
  );
  await page.screenshot({ path: info.outputPath("racing.png") });
  info.annotations.push({
    type: "marble",
    description: `drift ${drift.toFixed(3)} steered ${steered.toFixed(3)}`,
  });
  expect(steered).toBeGreaterThan(drift + 0.5);
  expect(await state(page)).toBe("racing");
  expect(errors).toEqual([]);
});

test("the stage fills the screen and the canvas keeps its shape", async ({ page }, info) => {
  await openGame(page);
  const vp = page.viewportSize()!;
  const stage = (await page.getByTestId("stage").boundingBox())!;
  const used = (stage.width * stage.height) / (vp.width * vp.height);
  info.annotations.push({ type: "stage", description: `${(used * 100).toFixed(1)}% of viewport` });
  if (info.project.name.includes("landscape")) expect(used).toBeGreaterThanOrEqual(0.95);
  else expect(used).toBeGreaterThan(0.5);
  const backing = await page.evaluate(() => {
    const c = document.querySelector("canvas.world") as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
  expect(backing.w / backing.h).toBeCloseTo(stage.width / stage.height, 1);
  // At most 1.35× the pixels of the old 960×540 view at the DPR cap of 2.
  expect(backing.w * backing.h).toBeLessThanOrEqual(1.35 * 1920 * 1080 + 4000);
});

test("touches where the letterbox bars used to be steer the marble", async ({ page }, info) => {
  const errors = collectErrors(page);
  await openGame(page);
  await startRacing(page);
  const vp = page.viewportSize()!;
  // The old stage was the largest centred 16:9 box; aim at the middle of the bar beside it.
  const oldW = Math.min(vp.width, (vp.height * 16) / 9);
  const oldH = Math.min(vp.height, (vp.width * 9) / 16);
  const origin =
    vp.width - oldW > vp.height - oldH
      ? { x: (vp.width - oldW) / 4, y: vp.height / 2 }
      : { x: vp.width * 0.3, y: (vp.height - oldH) / 4 };
  const { drift, steered } = await driftAndSteer(page, origin);
  info.annotations.push({
    type: "marble",
    description: `origin ${origin.x.toFixed(0)},${origin.y.toFixed(0)} drift ${drift.toFixed(3)} steered ${steered.toFixed(3)}`,
  });
  expect(steered).toBeGreaterThan(drift + 0.5);
  expect(await state(page)).toBe("racing");
  expect(errors).toEqual([]);
});

test("the pause button stays clear of both players' timers", async ({ page }, info) => {
  await openGame(page);
  await page.evaluate(() => window.__mm!.startCourse(2));
  await expect.poll(() => state(page)).toMatch(/raceIntro|countdown|racing/);
  await page.evaluate(() => window.__mm!.skipIntro());
  await expect.poll(() => state(page), { timeout: 10_000 }).toBe("racing");
  const pause = (await page.locator(".touch-pause").boundingBox())!;
  for (const sel of [".hud-p1", ".hud-p2", '[data-testid="hud-time-1"]']) {
    const box = (await page.locator(sel).boundingBox())!;
    expect(overlaps(pause, box), `${sel} overlaps the pause button`).toBe(false);
  }
  await page.screenshot({ path: info.outputPath("two-players.png") });
  await page.locator(".touch-pause").tap();
  await expect.poll(() => state(page)).toBe("paused");
});

test("the fullscreen toggle enters and leaves fullscreen where the API exists", async ({
  page,
}, info) => {
  test.skip(engine(page) !== "chromium", "desktop WebKit says nothing about iPhone Safari");
  await openGame(page);
  const toggle = page.getByTestId("fullscreen-toggle");
  await expect(toggle).toBeVisible();
  await toggle.tap();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.tap();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});
