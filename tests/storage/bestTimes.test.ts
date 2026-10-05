import { describe, expect, it } from "vitest";
import {
  BEST_TIMES_KEY,
  bestTicksFor,
  loadBestTimes,
  recordBestTime,
} from "../../src/storage/bestTimes";
import { createMemoryStorage } from "../../src/storage/settings";

describe("extra-course best times", () => {
  it("starts empty and records only improvements", () => {
    const s = createMemoryStorage();
    expect(bestTicksFor("puddle-hop", s)).toBeNull();
    expect(recordBestTime("puddle-hop", 900, s)).toBe(true);
    expect(recordBestTime("puddle-hop", 950, s)).toBe(false);
    expect(recordBestTime("puddle-hop", 900, s)).toBe(false);
    expect(recordBestTime("puddle-hop", 800, s)).toBe(true);
    expect(recordBestTime("tea-kettle", 1500, s)).toBe(true);
    expect(loadBestTimes(s)).toEqual({ "puddle-hop": 800, "tea-kettle": 1500 });
  });

  it("ignores invalid times and malformed storage", () => {
    const s = createMemoryStorage();
    expect(recordBestTime("x", 0, s)).toBe(false);
    expect(recordBestTime("x", 1.5, s)).toBe(false);
    s.setItem(BEST_TIMES_KEY, JSON.stringify({ a: 10, b: "fast", c: -3, d: 2.5 }));
    expect(loadBestTimes(s)).toEqual({ a: 10 });
    s.setItem(BEST_TIMES_KEY, "[1,2]");
    expect(loadBestTimes(s)).toEqual({});
    s.setItem(BEST_TIMES_KEY, "{not json");
    expect(loadBestTimes(s)).toEqual({});
  });
});
