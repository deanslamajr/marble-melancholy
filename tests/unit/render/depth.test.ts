// Painter's-order anchor of a marble against terrain strips (R02, R15).
import { describe, expect, it } from "vitest";
import type { UnstampedLevel } from "../../../src/level/types";
import { SLOPE } from "../../../src/level/types";
import { sphereAnchor } from "../../../src/render/depth";
import { createCellEnv, groundAt } from "../../../src/render/draw/cell";
import { MARBLE_RADIUS } from "../../../src/sim/constants";
import { loadCore } from "../../helpers";

const R = MARBLE_RADIUS;

/** 3×4 grid; column 1 holds the cells under test, rows 0..3 from far (north) to near (south). */
function env(column: Array<[number, number]>, east?: Array<[number, number]>) {
  const base = loadCore("practice");
  const W = 3;
  const H = column.length;
  const heights: number[] = [];
  const slopes: number[] = [];
  for (let y = 0; y < H; y++) {
    const [eh, es] = east?.[y] ?? [-1, 0];
    heights.push(-1, column[y]![0], eh);
    slopes.push(0, column[y]![1], es);
  }
  const level = {
    ...base,
    grid: { width: W, height: H },
    cells: {
      ...base.cells,
      heights,
      slopes,
      surfaces: heights.map(() => 0),
      walls: heights.map(() => 0),
    },
    entities: [],
    start: { p1: [1, 0], p2: [1, 0] },
  } as unknown as UnstampedLevel;
  return createCellEnv(level);
}

function anchorOnGround(e: ReturnType<typeof env>, x: number, y: number): number {
  return sphereAnchor(e, x, y, groundAt(e, x, y, 0)!, R, 0);
}

describe("sphereAnchor", () => {
  it("draws a marble rolling up a ramp toward the viewer after the next ramp row", () => {
    // Slope N descends toward the far side, so each row toward the viewer is 0.5 higher.
    const e = env([
      [4, SLOPE.N],
      [5, SLOPE.N],
      [6, SLOPE.N],
      [6, SLOPE.flat],
    ]);
    expect(anchorOnGround(e, 1.5, 0.9)).toBe(2);
    expect(anchorOnGround(e, 1.5, 1.5)).toBe(2);
  });

  it("draws a marble at the crest of an upward ramp after the flat landing", () => {
    const e = env([
      [4, SLOPE.N],
      [5, SLOPE.N],
      [5, SLOPE.flat],
      [5, SLOPE.flat],
    ]);
    expect(anchorOnGround(e, 1.5, 1.85)).toBe(3);
  });

  it("still draws a marble behind a step up in front of it", () => {
    const e = env([
      [4, SLOPE.flat],
      [4, SLOPE.flat],
      [5, SLOPE.flat],
      [5, SLOPE.flat],
    ]);
    expect(anchorOnGround(e, 1.5, 1.85)).toBe(2);
  });

  it("bumps on descending ramps and over void, as before", () => {
    const e = env([
      [8, SLOPE.S],
      [7, SLOPE.S],
      [6, SLOPE.S],
      [5, SLOPE.S],
    ]);
    expect(anchorOnGround(e, 1.5, 1.85)).toBe(3);
    expect(anchorOnGround(e, 1.85, 1.5)).toBe(3);
    expect(anchorOnGround(e, 1.5, 1.5)).toBe(2);
  });

  it("does not bump past a tall diagonal neighbour when overhanging both axes", () => {
    const e = env(
      [
        [4, SLOPE.flat],
        [4, SLOPE.flat],
        [4, SLOPE.flat],
        [4, SLOPE.flat],
      ],
      [
        [4, SLOPE.flat],
        [4, SLOPE.flat],
        [8, SLOPE.flat],
        [4, SLOPE.flat],
      ],
    );
    expect(anchorOnGround(e, 1.85, 1.85)).toBe(3);
    expect(anchorOnGround(e, 1.85, 0.85)).toBe(3);
  });

  it("race 5's last ramp: the marble climbing to the goal is drawn after the landing", () => {
    const level = loadCore("silly");
    const e = createCellEnv(level);
    // Columns 19–20, rows 38–44 rise toward the goal platform at row 45.
    expect(anchorOnGround(e, 20.5, 44.85)).toBe(20 + 45);
    expect(anchorOnGround(e, 20.85, 44.85)).toBe(20 + 44 + 2);
    expect(anchorOnGround(e, 19.5, 40.9)).toBe(19 + 41);
  });
});
