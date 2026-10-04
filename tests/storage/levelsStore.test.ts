import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { CompiledLevel, LevelSource } from "../../src/level/types";
import { _resetDbForTests, idbGet, idbList, idbPut, openDb } from "../../src/storage/idb";
import {
  deleteCustomLevel,
  deleteDraft,
  duplicateDraft,
  getCustomLevel,
  getDraft,
  listCustomLevels,
  listDrafts,
  newDraftId,
  putCustomLevel,
  recordBestTicks,
  saveDraft,
} from "../../src/storage/levelsStore";

function level(id: string, name = "Level"): CompiledLevel {
  return { id, name, format: "mm-level/1" } as unknown as CompiledLevel;
}

function source(id: string): LevelSource {
  return {
    format: "mm-level-source/1",
    id,
    name: "Src",
    theme: "practice",
    music: "m1-first-steps",
    grid: { width: 16, height: 24 },
    layers: { heights: "" },
    start: { p1: [7, 2], p2: [8, 2] },
    goal: { at: [7, 21] },
    timing: { timeLimit: 30, par: 20 },
  } as unknown as LevelSource;
}

afterEach(async () => {
  await _resetDbForTests();
});

describe("idb", () => {
  it("creates both stores with keyPath id", async () => {
    const db = await openDb();
    expect(db.name).toBe("marble-melancholy");
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(["drafts", "levels"]);
    await idbPut("drafts", { id: "x", v: 1 });
    expect(await idbGet("drafts", "x")).toEqual({ id: "x", v: 1 });
    expect(await idbList("levels")).toEqual([]);
  });
});

describe("custom levels", () => {
  it("puts, lists, gets and deletes", async () => {
    await putCustomLevel(level("a"));
    await new Promise((r) => setTimeout(r, 2));
    await putCustomLevel(level("b"));
    expect((await listCustomLevels()).map((r) => r.id)).toEqual(["b", "a"]);
    const a = await getCustomLevel("a");
    expect(a).toMatchObject({ id: "a", bestTicks: null });
    expect(a!.level.id).toBe("a");
    await deleteCustomLevel("a");
    expect(await getCustomLevel("a")).toBeUndefined();
  });

  it("records best ticks and preserves them on re-put", async () => {
    const first = await putCustomLevel(level("c"));
    expect(await recordBestTicks("c", 3000)).toBe(true);
    expect(await recordBestTicks("c", 3500)).toBe(false);
    expect(await recordBestTicks("c", 3000)).toBe(false);
    expect(await recordBestTicks("c", 2400)).toBe(true);
    const again = await putCustomLevel(level("c", "Renamed"));
    expect(again.bestTicks).toBe(2400);
    expect(again.addedAt).toBe(first.addedAt);
    expect((await getCustomLevel("c"))!.level.name).toBe("Renamed");
    expect(await recordBestTicks("missing", 1)).toBe(false);
  });
});

describe("drafts", () => {
  it("generates distinct draft ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newDraftId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^d-[a-z0-9]+$/);
  });

  it("saves, lists by modifiedAt desc, and deletes", async () => {
    const base = { name: "One", source: source("one"), solved: false, gridW: 16, gridH: 24 };
    await saveDraft({ ...base, id: "d1", modifiedAt: 100 });
    await saveDraft({ ...base, id: "d2", name: "Two", modifiedAt: 300 });
    const d3 = await saveDraft({ ...base, id: "d3", name: "Three" });
    expect(d3.modifiedAt).toBeGreaterThan(300);
    expect((await listDrafts()).map((d) => d.id)).toEqual(["d3", "d2", "d1"]);
    await deleteDraft("d2");
    expect(await getDraft("d2")).toBeUndefined();
    expect((await listDrafts()).map((d) => d.id)).toEqual(["d3", "d1"]);
  });

  it("duplicates with a new id, name and source id", async () => {
    await saveDraft({
      id: "orig",
      name: "My Chute",
      source: source("my-chute"),
      solved: true,
      gridW: 24,
      gridH: 40,
      modifiedAt: 5,
    });
    const copy = await duplicateDraft("orig");
    expect(copy.id).not.toBe("orig");
    expect(copy.name).toBe("My Chute copy");
    expect(copy.source.id).toBe("my-chute-copy");
    expect(copy.source.name).toBe("My Chute copy");
    expect(copy.modifiedAt).toBeGreaterThan(5);
    expect(copy).toMatchObject({ solved: true, gridW: 24, gridH: 40 });
    const copy2 = await duplicateDraft("orig");
    expect(copy2.source.id).toBe("my-chute-copy2");
    expect((await getDraft("orig"))!.source.id).toBe("my-chute");
    await expect(duplicateDraft("nope")).rejects.toThrow();
  });
});
