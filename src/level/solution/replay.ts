// Replay RLE codec (§5.5). Runs are flat triples [count, qx, qy, ...], qx/qy ∈ −127..127.

export interface Replay {
  runs: number[];
}

export class RunEncoder {
  readonly runs: number[] = [];
  private ticks = 0;

  push(qx: number, qy: number): void {
    const n = this.runs.length;
    if (n >= 3 && this.runs[n - 2] === qx && this.runs[n - 1] === qy) {
      this.runs[n - 3]!++;
    } else {
      this.runs.push(1, qx, qy);
    }
    this.ticks++;
  }

  get length(): number {
    return this.ticks;
  }
}

export function encodeRuns(inputs: ReadonlyArray<readonly [number, number]>): number[] {
  const enc = new RunEncoder();
  for (const [qx, qy] of inputs) enc.push(qx, qy);
  return enc.runs;
}

export function decodeRuns(runs: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 2 < runs.length; i += 3) {
    const n = runs[i]!;
    for (let k = 0; k < n; k++) out.push([runs[i + 1]!, runs[i + 2]!]);
  }
  return out;
}

export function runsLength(runs: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < runs.length; i += 3) n += runs[i]!;
  return n;
}

/** Streaming decoder: next() returns the quantized pair for the next tick, or null when exhausted. */
export class RunCursor {
  private i = 0;
  private left: number;

  constructor(private readonly runs: readonly number[]) {
    this.left = runs.length >= 3 ? runs[0]! : 0;
  }

  next(): [number, number] | null {
    while (this.left <= 0) {
      this.i += 3;
      if (this.i + 2 >= this.runs.length) return null;
      this.left = this.runs[this.i]!;
    }
    this.left--;
    return [this.runs[this.i + 1]!, this.runs[this.i + 2]!];
  }
}

/** Validate a runs array shape (triples, positive counts, in-range values inside the unit disk). */
export function runsWellFormed(runs: readonly number[]): boolean {
  if (runs.length % 3 !== 0) return false;
  for (let i = 0; i < runs.length; i += 3) {
    const n = runs[i]!;
    const qx = runs[i + 1]!;
    const qy = runs[i + 2]!;
    if (!Number.isInteger(n) || n < 1) return false;
    if (!Number.isInteger(qx) || !Number.isInteger(qy)) return false;
    if (qx < -127 || qx > 127 || qy < -127 || qy > 127) return false;
    if (qx * qx + qy * qy > 127 * 127) return false;
  }
  return true;
}
