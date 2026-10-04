import type { P2Keys, StickVector } from "./types";

/** `KeyboardEvent.code` → screen direction contribution (x right+, y down+). */
export type KeyBindings = Readonly<Record<string, readonly [number, number]>>;

export const ARROW_KEYS: KeyBindings = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export const NUMPAD_KEYS: KeyBindings = {
  Numpad8: [0, -1],
  Numpad2: [0, 1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad7: [-1, -1],
  Numpad9: [1, -1],
  Numpad1: [-1, 1],
  Numpad3: [1, 1],
};

export const WASD_KEYS: KeyBindings = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

export const IJKL_KEYS: KeyBindings = {
  KeyI: [0, -1],
  KeyK: [0, 1],
  KeyJ: [-1, 0],
  KeyL: [1, 0],
};

/** Seconds for the magnitude to ramp 0→1 while a direction is held. */
export const KEY_RAMP_UP = 0.12;
/** Seconds for the magnitude to decay 1→0 once released. */
export const KEY_DECAY = 0.08;

/** Bindings per player (§7.6): P1 arrows + numpad (+WASD in 1P when P2 uses IJKL). */
export function bindingsFor(player: 0 | 1, players: 1 | 2, p2Keys: P2Keys): KeyBindings {
  if (player === 1) return p2Keys === "wasd" ? WASD_KEYS : IJKL_KEYS;
  if (p2Keys === "ijkl" && players === 1) return { ...ARROW_KEYS, ...NUMPAD_KEYS, ...WASD_KEYS };
  return { ...ARROW_KEYS, ...NUMPAD_KEYS };
}

/**
 * One player's keys. DOM-free: feed it key codes via keyDown/keyUp or applyKeys, then call
 * tick(dt) once per sim tick to get the screen-space stick.
 */
export class KeyboardSource {
  private bindings: KeyBindings;
  private readonly pressed = new Set<string>();
  private mag = 0;
  private dirX = 0;
  private dirY = 0;

  constructor(bindings: KeyBindings) {
    this.bindings = bindings;
  }

  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
  }

  handles(code: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.bindings, code);
  }

  /** Returns true when the code is bound for this player. */
  keyDown(code: string): boolean {
    this.pressed.add(code);
    return this.handles(code);
  }

  keyUp(code: string): void {
    this.pressed.delete(code);
  }

  /** Replace the whole pressed set (tests, focus restore). */
  applyKeys(pressed: Iterable<string>): void {
    this.pressed.clear();
    for (const code of pressed) this.pressed.add(code);
  }

  releaseAll(): void {
    this.pressed.clear();
  }

  /** Current pressed direction, normalized; zero when nothing (or only opposing keys) is held. */
  direction(): StickVector {
    let x = 0;
    let y = 0;
    for (const code of this.pressed) {
      const d = this.bindings[code];
      if (d) {
        x += d[0];
        y += d[1];
      }
    }
    x = Math.sign(x);
    y = Math.sign(y);
    if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
    return { x, y };
  }

  tick(dt: number): StickVector {
    const d = this.direction();
    if (d.x !== 0 || d.y !== 0) {
      this.dirX = d.x;
      this.dirY = d.y;
      this.mag = Math.min(1, this.mag + dt / KEY_RAMP_UP);
    } else {
      this.mag = Math.max(0, this.mag - dt / KEY_DECAY);
    }
    if (this.mag === 0) return { x: 0, y: 0 };
    return { x: this.dirX * this.mag, y: this.dirY * this.mag };
  }

  /** Drop the ramp but keep the pressed set (window listeners keep it accurate). */
  reset(): void {
    this.mag = 0;
    this.dirX = 0;
    this.dirY = 0;
  }
}
