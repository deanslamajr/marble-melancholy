import type { LevelSource } from "../../level/types";

export const HISTORY_MAX = 200;

/** Undo/redo of whole-source snapshots (§6.2). Brush strokes coalesce into one entry. */
export class History {
  past: LevelSource[] = [];
  future: LevelSource[] = [];
  private strokeBase: LevelSource | null = null;

  /** Record `prev` as the state before an edit. Inside a stroke only the first call counts. */
  record(prev: LevelSource): void {
    if (this.strokeBase !== null) return;
    this.push(prev);
  }

  beginStroke(current: LevelSource): void {
    this.strokeBase = current;
  }

  /** Close a stroke; pushes the pre-stroke snapshot if anything changed. */
  endStroke(current: LevelSource): void {
    const base = this.strokeBase;
    this.strokeBase = null;
    if (base !== null && base !== current) this.push(base);
  }

  get inStroke(): boolean {
    return this.strokeBase !== null;
  }

  private push(prev: LevelSource): void {
    this.past.push(structuredClone(prev));
    if (this.past.length > HISTORY_MAX) this.past.shift();
    this.future = [];
  }

  undo(current: LevelSource): LevelSource | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: LevelSource): LevelSource | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(structuredClone(current));
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.strokeBase = null;
  }
}
