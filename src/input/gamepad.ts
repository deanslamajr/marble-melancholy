import { radialDeadzone } from "./mapping";
import type { ButtonPress, MenuButton, StickVector } from "./types";

export const GAMEPAD_DEADZONE = 0.15;
const FLICK_ON = 0.6;
const FLICK_OFF = 0.35;

/** The subset of the Gamepad API we read; lets tests pass plain objects. */
export interface PadLike {
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export type PadProvider = () => readonly (PadLike | null | undefined)[];

const BUTTON_MAP: readonly (readonly [number, MenuButton])[] = [
  [0, "confirm"],
  [1, "back"],
  [9, "pause"],
  [8, "select"],
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];

type Flick = "up" | "down" | "left" | "right" | null;

interface PadState {
  stick: StickVector;
  held: Set<MenuButton>;
  flick: Flick;
}

function defaultProvider(): readonly (PadLike | null)[] {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav || typeof nav.getGamepads !== "function") return [];
  try {
    return nav.getGamepads();
  } catch {
    return [];
  }
}

function flickOf(stick: readonly number[], prev: Flick): Flick {
  const x = stick[0] ?? 0;
  const y = stick[1] ?? 0;
  if (prev !== null) {
    const along = prev === "left" ? -x : prev === "right" ? x : prev === "up" ? -y : y;
    if (along > FLICK_OFF) return prev;
  }
  if (Math.abs(x) >= Math.abs(y)) {
    if (x > FLICK_ON) return "right";
    if (x < -FLICK_ON) return "left";
  } else {
    if (y > FLICK_ON) return "down";
    if (y < -FLICK_ON) return "up";
  }
  return null;
}

/**
 * Pads are numbered by order among connected pads (first connected = pad 0 = P1), which is
 * robust to browsers that leave holes in getGamepads().
 */
export class GamepadSource {
  private pads: PadState[] = [];
  private queue: ButtonPress[] = [];

  constructor(private readonly provider: PadProvider = defaultProvider) {}

  /** Read the pads once; sticks and button edges are taken from this snapshot. */
  update(): void {
    const raw = this.provider().filter((p): p is PadLike => !!p && p.connected);
    const next: PadState[] = [];
    raw.forEach((pad, i) => {
      const prev = this.pads[i];
      const held = new Set<MenuButton>();
      for (const [idx, name] of BUTTON_MAP) {
        if (pad.buttons[idx]?.pressed) {
          held.add(name);
          if (prev && !prev.held.has(name)) this.push({ pad: i, button: name });
        }
      }
      const flick = flickOf(pad.axes, prev?.flick ?? null);
      if (prev && flick !== null && flick !== prev.flick) this.push({ pad: i, button: flick });
      next.push({
        stick: radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, GAMEPAD_DEADZONE),
        held,
        flick,
      });
    });
    this.pads = next;
  }

  private push(p: ButtonPress): void {
    if (this.queue.length < 64) this.queue.push(p);
  }

  get count(): number {
    return this.pads.length;
  }

  /** Screen-space stick of pad `i` after the dead zone; zero if absent. */
  stick(i: number): StickVector {
    const s = this.pads[i]?.stick;
    return s ? { x: s.x, y: s.y } : { x: 0, y: 0 };
  }

  /** Largest stick among all connected pads (1P: any pad drives P1). */
  anyStick(): StickVector {
    let best: StickVector = { x: 0, y: 0 };
    let bestM2 = 0;
    for (const p of this.pads) {
      const m2 = p.stick.x * p.stick.x + p.stick.y * p.stick.y;
      if (m2 > bestM2) {
        best = { x: p.stick.x, y: p.stick.y };
        bestM2 = m2;
      }
    }
    return best;
  }

  /** Update, then return and clear the edge-triggered presses since the last drain. */
  pollButtons(): ButtonPress[] {
    this.update();
    return this.drain();
  }

  drain(): ButtonPress[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /** Forget queued presses; held state is kept so a still-held button does not re-fire. */
  reset(): void {
    this.queue = [];
  }
}
