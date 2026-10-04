// Builder test-play (§6.2): a single-player race on the draft, optionally recorded as a replay solution.
import type { AudioEngine } from "../../audio/AudioEngine";
import { FixedStepper } from "../../core/fixedStep";
import { RunEncoder } from "../../level/solution/replay";
import type { UnstampedLevel } from "../../level/types";
import type { InputManager } from "../../input/InputManager";
import type { Camera } from "../../render/camera";
import type { Renderer } from "../../render/Renderer";
import { TICK_HZ } from "../../sim/constants";
import { dequantize, quantizeInt } from "../../sim/quantize";
import { RaceSim } from "../../sim/race";
import type { SimEvent, SimSnapshot } from "../../sim/types";

export interface TestPlayResult {
  reached: boolean;
  timedOut: boolean;
  ticks: number;
  deaths: number;
  /** Recorded inputs (record mode only, goal reached). */
  runs: number[] | null;
}

export interface TestPlayDeps {
  renderer: Renderer;
  camera: Camera;
  input: InputManager;
  audio: AudioEngine;
  onHud(text: string): void;
  onEnd(r: TestPlayResult): void;
}

/** Extra ticks simulated after the goal so the finish reads on screen. */
const TAIL_TICKS = 90;

export class TestPlay {
  readonly sim: RaceSim;
  private readonly stepper = new FixedStepper(TICK_HZ, 8);
  private readonly encoder: RunEncoder | null;
  private prev: SimSnapshot;
  private cur: SimSnapshot;
  private raf = 0;
  private last = 0;
  private goalTick = -1;
  private tail = 0;
  private ended = false;

  constructor(
    readonly level: UnstampedLevel,
    private readonly deps: TestPlayDeps,
    record: boolean,
  ) {
    this.sim = new RaceSim(level, { players: 1 });
    this.encoder = record ? new RunEncoder() : null;
    this.cur = this.prev = this.sim.snapshot();
    deps.renderer.setLevel(level);
    deps.camera.setBounds(level.bounds);
    deps.camera.free = false;
    deps.camera.snapTo(this.cur);
    deps.input.reset();
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      if (!this.ended) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private frame(dt: number): void {
    const { steps, alpha } = this.stepper.advance(dt);
    const all: SimEvent[] = [];
    for (let i = 0; i < steps && !this.ended; i++) {
      let input = { ax: 0, ay: 0 };
      if (this.goalTick < 0) {
        const raw = this.deps.input.sample(0);
        const [qx, qy] = quantizeInt(raw.ax, raw.ay);
        this.encoder?.push(qx, qy);
        input = dequantize(qx, qy);
      }
      const events = this.sim.step([input]);
      this.prev = this.cur;
      this.cur = this.sim.snapshot();
      for (const e of events) {
        all.push(e);
        if (e.t === "goal" && this.goalTick < 0) this.goalTick = e.tick;
        if (e.t === "timeout") this.finish(false, true);
      }
      if (this.goalTick >= 0 && ++this.tail >= TAIL_TICKS) this.finish(true, false);
    }
    if (all.length > 0) {
      this.deps.audio.handleEvents(all);
      this.deps.renderer.handleEvents(all, this.cur);
    }
    this.deps.audio.updateFrame(this.cur, this.level);
    this.deps.camera.update(this.cur, dt);
    this.deps.renderer.draw(this.prev, this.cur, alpha, this.deps.camera, dt);
    const p = this.sim.players[0]!;
    const secs = Math.max(0, Math.ceil(p.timeTicks / TICK_HZ));
    const rec = this.encoder ? "● REC  " : "";
    this.deps.onHud(
      `${rec}TIME ${secs}   ${(this.sim.tick / TICK_HZ).toFixed(2)} s   deaths ${p.deaths}   Esc: stop`,
    );
  }

  private finish(reached: boolean, timedOut: boolean): void {
    if (this.ended) return;
    this.ended = true;
    cancelAnimationFrame(this.raf);
    this.deps.audio.silenceContinuous();
    const p = this.sim.players[0]!;
    const ticks = reached ? this.goalTick : this.sim.tick;
    const runs = reached && this.encoder ? trimRuns(this.encoder.runs, this.goalTick) : null;
    this.deps.onEnd({ reached, timedOut, ticks, deaths: p.deaths, runs });
  }

  /** User abort (Esc). */
  stop(): void {
    this.finish(this.goalTick >= 0, false);
  }

  dispose(): void {
    this.ended = true;
    cancelAnimationFrame(this.raf);
  }
}

/** Keep only the inputs up to and including the goal tick. */
function trimRuns(runs: readonly number[], goalTick: number): number[] {
  const out: number[] = [];
  let left = goalTick + 1;
  for (let i = 0; i + 2 < runs.length && left > 0; i += 3) {
    const n = Math.min(runs[i]!, left);
    out.push(n, runs[i + 1]!, runs[i + 2]!);
    left -= n;
  }
  return out;
}
