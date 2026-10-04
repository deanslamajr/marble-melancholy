import { describe, expect, it } from "vitest";
import {
  HIGHSCORES_KEY,
  TABLE_SIZE,
  defaultTable,
  insertScore,
  loadHighScores,
  qualifies,
  saveHighScores,
  type HighScoreEntry,
} from "../../src/storage/highscores";
import { createMemoryStorage } from "../../src/storage/settings";

function entry(score: number, initials = "abc"): HighScoreEntry {
  return { initials, score, race: 3, players: 1, date: "2026-10-04T00:00:00.000Z" };
}

describe("highscores", () => {
  it("seeds a descending 10-entry table", () => {
    const t = defaultTable();
    expect(t).toHaveLength(TABLE_SIZE);
    expect(t[0]!.score).toBe(20000);
    expect(t[9]!.score).toBe(2000);
    for (let i = 1; i < t.length; i++) expect(t[i]!.score).toBeLessThan(t[i - 1]!.score);
    for (const e of t) expect(e.initials).toMatch(/^[A-Z]{3}$/);
  });

  it("loads defaults when missing or corrupt", () => {
    const st = createMemoryStorage();
    expect(loadHighScores(st)).toEqual(defaultTable());
    st.setItem(HIGHSCORES_KEY, "[[[");
    expect(loadHighScores(st)).toEqual(defaultTable());
    st.setItem(HIGHSCORES_KEY, JSON.stringify({ a: 1 }));
    expect(loadHighScores(st)).toEqual(defaultTable());
  });

  it("round-trips and sanitizes", () => {
    const st = createMemoryStorage();
    const { table } = insertScore(defaultTable(), entry(15000, "zz"));
    saveHighScores(table, st);
    expect(loadHighScores(st)).toEqual(table);
    st.setItem(HIGHSCORES_KEY, JSON.stringify([entry(5), { score: "x" }, entry(9, "q1w2e3r")]));
    const loaded = loadHighScores(st);
    expect(loaded.map((e) => e.score)).toEqual([9, 5]);
    expect(loaded[0]!.initials).toBe("QWE");
  });

  it("qualifies only above the 10th entry", () => {
    const t = defaultTable();
    expect(qualifies(t, 2000)).toBe(false);
    expect(qualifies(t, 2001)).toBe(true);
    expect(qualifies([], 1)).toBe(true);
  });

  it("inserts at the right rank with ties below existing entries", () => {
    const t = defaultTable();
    const r = insertScore(t, entry(18000, "x-y"));
    expect(r.rank).toBe(2);
    expect(r.table).toHaveLength(TABLE_SIZE);
    expect(r.table[1]!.initials).toBe(t[1]!.initials);
    expect(r.table[2]!.initials).toBe("XYA");
    expect(r.table[9]!.score).toBe(4000);
    expect(t[2]!.score).toBe(16000);
  });

  it("puts a new top score first and rejects low scores", () => {
    expect(insertScore(defaultTable(), entry(99999)).rank).toBe(0);
    const r = insertScore(defaultTable(), entry(1500));
    expect(r.rank).toBe(-1);
    expect(r.table).toEqual(defaultTable());
  });

  it("fills a short table", () => {
    const r = insertScore([entry(10)], entry(10, "new"));
    expect(r.rank).toBe(1);
    expect(r.table.map((e) => e.initials)).toEqual(["abc", "NEW"]);
  });
});
