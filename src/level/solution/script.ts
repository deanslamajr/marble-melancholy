// Timed input segments → per-tick quantized inputs (§6.6).
import { quantizeInt } from "../../sim/quantize";
import type { ScriptSegment } from "../types";

export class ScriptPlayer {
  private seg = 0;
  private left: number;
  private q: [number, number];

  constructor(private readonly segments: readonly ScriptSegment[]) {
    this.left = segments[0]?.ticks ?? 0;
    this.q = segments[0] ? quantizeInt(segments[0].dir[0], segments[0].dir[1]) : [0, 0];
  }

  get ended(): boolean {
    return this.seg >= this.segments.length;
  }

  next(): [number, number] {
    while (this.left <= 0) {
      this.seg++;
      const s = this.segments[this.seg];
      if (!s) return [0, 0];
      this.left = s.ticks;
      this.q = quantizeInt(s.dir[0], s.dir[1]);
    }
    this.left--;
    return this.q;
  }
}

export function scriptToInputs(segments: readonly ScriptSegment[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of segments) {
    const q = quantizeInt(s.dir[0], s.dir[1]);
    for (let i = 0; i < s.ticks; i++) out.push(q);
  }
  return out;
}
