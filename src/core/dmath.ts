// Deterministic math (D06). Only + - * / and Math.sqrt/floor/ceil/round/abs/min/max/trunc.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Sine via range reduction to [-π/2, π/2] and an odd Taylor polynomial up to x¹¹. */
export function dsin(x: number): number {
  const k = Math.floor((x + PI) / TWO_PI);
  let r = x - k * TWO_PI;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800))))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

function atanUnit(t: number): number {
  const t2 = t * t;
  return (
    t *
    (0.9999993329 +
      t2 *
        (-0.3332985605 +
          t2 *
            (0.1994653599 +
              t2 *
                (-0.1390853351 +
                  t2 *
                    (0.0964200441 +
                      t2 * (-0.0559098861 + t2 * (0.0218612288 + t2 * -0.004054058)))))))
  );
}

/** atan2 via octant reduction to |t| ≤ 1 and a minimax polynomial. */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a: number;
  if (ax >= ay) a = atanUnit(ay / ax);
  else a = HALF_PI - atanUnit(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function normalize(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  if (l === 0) return [0, 0];
  return [x / l, y / l];
}

/** Clamp a 2D vector to the unit disk. */
export function clampToUnitDisk(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  if (l <= 1) return [x, y];
  return [x / l, y / l];
}

/** Round to 4 decimal places (compiled level numbers, §5.4). */
export function round4(v: number): number {
  const r = Math.round(v * 10000) / 10000;
  return r === 0 ? 0 : r;
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  return a - Math.floor(a / n) * n;
}
