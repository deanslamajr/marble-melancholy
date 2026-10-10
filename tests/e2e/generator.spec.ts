import { expect, test } from "@playwright/test";
import { collectErrors, openGame } from "./helpers";

// The search solver runs inside the browser, so a shared link only reproduces a course if every
// engine builds the same stamped level as Node (T17). Hashes come from
// `npm run mmlevel -- generate --seed 7919 --difficulty <tier> --compiled <file>`; a generator
// change that alters them must bump GENERATOR_VERSION (L24) and update this table.
const EXPECTED: Record<string, string> = {
  hard: "sha256:6b5f9cfee333b508fe263f021d379957770bc23b380db8cd30288b8fdd0d8c48",
  insane: "sha256:26adb2a80bc92451b854c703503f30b68d44eb90e35eff2edcf263dbca7fcb37",
};

for (const [tier, hash] of Object.entries(EXPECTED)) {
  test(`${tier} seed 7919 builds the same stamped course as Node`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await openGame(page, `#/generate/${tier}/7919`);
    const card = page.getByTestId("gen-status");
    await expect(card).toHaveAttribute("data-status", "ready", { timeout: 100_000 });
    await expect(card).toHaveAttribute("data-hash", hash);
    await expect(page.getByTestId("gen-input-hint")).toHaveCount(tier === "insane" ? 1 : 0);
    expect(errors).toEqual([]);
  });
}
