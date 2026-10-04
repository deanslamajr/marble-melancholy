/**
 * Fixed-timestep accumulator (§3.3). The caller supplies real elapsed seconds;
 * the stepper returns how many ticks to run and the interpolation alpha.
 */
export class FixedStepper {
  readonly dt: number;
  private acc = 0;

  constructor(
    readonly stepHz = 120,
    readonly maxStepsPerFrame = 8,
  ) {
    this.dt = 1 / stepHz;
  }

  advance(elapsedSeconds: number): { steps: number; alpha: number } {
    const clamped = Math.min(Math.max(elapsedSeconds, 0), 0.25);
    this.acc += clamped;
    let steps = Math.floor(this.acc / this.dt);
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.acc = 0;
    } else {
      this.acc -= steps * this.dt;
    }
    return { steps, alpha: this.acc / this.dt };
  }

  reset(): void {
    this.acc = 0;
  }
}
