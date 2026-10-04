// Editor state as signals (§6.2). Every edit goes through apply() so history and validation stay in sync.
import { batch, signal, type Signal } from "@preact/signals";
import { buildUnstamped } from "../../level/compile";
import type { Diagnostic } from "../../level/diagnostics";
import { solveSolution } from "../../level/solution/solve";
import type { Cell, EntityType, LevelSource, UnstampedLevel } from "../../level/types";
import { SLOPE, SURFACE } from "../../level/types";
import { validateSource } from "../../level/validate";
import { TICK_HZ } from "../../sim/constants";
import { saveDraft } from "../../storage/levelsStore";
import type { TestPlayResult } from "../testplay/TestPlay";
import { History } from "./history";

export type ToolId =
  | "select"
  | "height"
  | "setHeight"
  | "slope"
  | "surface"
  | "wall"
  | "void"
  | "entity"
  | "p1"
  | "p2"
  | "goal"
  | "checkpoint"
  | "waypoint";

export type Selection =
  | { kind: "entities"; indices: number[] }
  | { kind: "checkpoint"; index: number }
  | { kind: "waypoint"; index: number }
  | null;

export interface LayerVisibility {
  heights: boolean;
  slopes: boolean;
  surfaces: boolean;
  walls: boolean;
  entities: boolean;
  waypoints: boolean;
}

export interface SolveView {
  ok: boolean;
  text: string;
  path: Cell[];
  deathCells: Cell[];
}

export type PlayMode = null | { record: boolean };

const VALIDATE_DEBOUNCE_MS = 150;

export class EditorState {
  readonly source: Signal<LevelSource>;
  readonly tool = signal<ToolId>("height");
  readonly view = signal<"top" | "iso">("top");
  readonly selection = signal<Selection>(null);
  readonly brush = signal<1 | 3 | 5>(1);
  readonly heightValue = signal(10);
  readonly slopeValue = signal<number>(SLOPE.S);
  readonly surfaceValue = signal<number>(SURFACE.ice);
  readonly paletteType = signal<EntityType>("steelie");
  readonly layers = signal<LayerVisibility>({
    heights: true,
    slopes: true,
    surfaces: true,
    walls: true,
    entities: true,
    waypoints: true,
  });
  readonly diagnostics = signal<Diagnostic[]>([]);
  readonly solve = signal<SolveView | null>(null);
  readonly hover = signal<Cell | null>(null);
  readonly zoom = signal(24);
  readonly pan = signal({ x: 16, y: 16 });
  readonly focusCell = signal<Cell | null>(null);
  readonly dirty = signal(false);
  readonly toast = signal<string | null>(null);
  readonly playing = signal<PlayMode>(null);
  readonly playHud = signal<string>("");
  readonly pendingRecording = signal<{ runs: number[]; ticks: number; deaths: number } | null>(
    null,
  );
  /** Select-tool marquee in cell coordinates (inclusive corners). */
  readonly marquee = signal<{ a: Cell; b: Cell } | null>(null);
  readonly exportMenu = signal(false);
  /** Path entity being placed with successive clicks (Entity tool). */
  readonly pendingPath = signal<number | null>(null);
  readonly version = signal(0);

  readonly history = new History();
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly draftId: string,
    initial: LevelSource,
  ) {
    this.source = signal(initial);
    this.runValidation();
  }

  get src(): LevelSource {
    return this.source.value;
  }

  /** Apply a pure edit. Inside a stroke (pointer drag) history coalesces into one entry. */
  apply(fn: (s: LevelSource) => LevelSource): void {
    const prev = this.source.value;
    const next = fn(prev);
    if (next === prev) return;
    this.history.record(prev);
    batch(() => {
      this.source.value = next;
      this.dirty.value = true;
      this.version.value++;
    });
    this.scheduleValidation();
  }

  beginStroke(): void {
    this.history.beginStroke(this.source.value);
  }

  endStroke(): void {
    this.history.endStroke(this.source.value);
  }

  undo(): void {
    const prev = this.history.undo(this.source.value);
    if (prev) this.replace(prev);
  }

  redo(): void {
    const next = this.history.redo(this.source.value);
    if (next) this.replace(next);
  }

  private replace(s: LevelSource): void {
    batch(() => {
      this.source.value = s;
      this.dirty.value = true;
      this.selection.value = null;
      this.version.value++;
    });
    this.scheduleValidation();
  }

  private scheduleValidation(): void {
    if (this.validateTimer) clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => this.runValidation(), VALIDATE_DEBOUNCE_MS);
  }

  runValidation(): Diagnostic[] {
    const r = validateSource(this.source.value);
    const all = [...r.errors, ...r.warnings];
    this.diagnostics.value = all;
    return all;
  }

  get errorCount(): number {
    return this.diagnostics.value.filter((d) => d.severity === "error").length;
  }

  /** Unstamped playable level for preview/test-play, or null when the draft has errors. */
  playable(): UnstampedLevel | null {
    const b = buildUnstamped(this.source.value);
    return b.ok ? b.level : null;
  }

  autoSolve(): SolveView {
    const src = this.source.value;
    const level = this.playable();
    let view: SolveView;
    if (!level) {
      view = { ok: false, text: "Fix validation errors first.", path: [], deathCells: [] };
    } else if (!src.solution) {
      view = {
        ok: false,
        text: "No solution: add waypoints (P) or record a run (R).",
        path: [],
        deathCells: [],
      };
    } else {
      const r = solveSolution(level, src.solution);
      if (r.ok) {
        const d = r.deaths === 1 ? "1 death" : `${r.deaths} deaths`;
        view = {
          ok: true,
          text: `GOAL at ${(r.ticks / TICK_HZ).toFixed(1)} s (par ${level.timing.par}) — ${d}`,
          path: r.path,
          deathCells: r.deathCells,
        };
      } else {
        const wp = r.waypointIndex !== undefined ? `, waypoint ${r.waypointIndex}` : "";
        const pos = r.pos.map((v) => v.toFixed(1)).join(", ");
        view = {
          ok: false,
          text: `FAIL: ${r.reason} at ${(r.tick / TICK_HZ).toFixed(1)} s${wp}; marble at (${pos}); ${r.deaths} deaths`,
          path: r.path ?? [],
          deathCells: r.deathCells,
        };
      }
    }
    this.solve.value = view;
    return view;
  }

  async save(): Promise<void> {
    const s = this.source.value;
    const solved = this.solve.value?.ok ?? false;
    await saveDraft({
      id: this.draftId,
      name: s.name,
      source: s,
      solved,
      gridW: s.grid.width,
      gridH: s.grid.height,
    });
    this.dirty.value = false;
    this.notify("Saved");
  }

  startTestPlay(record: boolean): void {
    if (this.playing.value) return;
    if (this.errorCount > 0) {
      this.notify("Fix validation errors before test-play");
      return;
    }
    this.view.value = "iso";
    this.playing.value = { record };
  }

  finishTestPlay(r: TestPlayResult): void {
    const mode = this.playing.value;
    batch(() => {
      this.playing.value = null;
      this.playHud.value = "";
    });
    const t = (r.ticks / TICK_HZ).toFixed(2);
    if (!r.reached) {
      this.notify(r.timedOut ? "TIME OUT" : `Test-play stopped at ${t} s`);
      return;
    }
    if (mode?.record && r.runs)
      this.pendingRecording.value = { runs: r.runs, ticks: r.ticks, deaths: r.deaths };
    else this.notify(`GOAL in ${t} s (${r.deaths} deaths)`);
  }

  acceptRecording(): void {
    const rec = this.pendingRecording.value;
    this.pendingRecording.value = null;
    if (!rec) return;
    this.apply((s) => ({
      ...s,
      solution: { kind: "replay", runs: rec.runs, expectedTicks: rec.ticks },
    }));
    this.autoSolve();
    this.notify(`Saved the ${(rec.ticks / TICK_HZ).toFixed(2)} s run as the solution`);
  }

  discardRecording(): void {
    this.pendingRecording.value = null;
  }

  notify(msg: string): void {
    this.toast.value = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast.value = null), 2200);
  }

  dispose(): void {
    if (this.validateTimer) clearTimeout(this.validateTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }
}
