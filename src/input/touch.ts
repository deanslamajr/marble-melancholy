import type { StickVector } from "./types";

export const TOUCH_RADIUS_PX = 60;
export const TOUCH_DEADZONE_PX = 8;
/** Fraction of the target width (from the left) that hosts the floating stick. */
export const TOUCH_STICK_ZONE = 0.6;
const TAP_MAX_MS = 350;
const TAP_MAX_MOVE_PX = 16;

export interface TouchStickState {
  active: boolean;
  /** Stick origin relative to the target's top-left, CSS px. */
  originX: number;
  originY: number;
  /** Knob offset from the origin, clamped to TOUCH_RADIUS_PX. */
  knobX: number;
  knobY: number;
}

type Listener = (s: TouchStickState) => void;

interface Tap {
  x: number;
  y: number;
  t: number;
  moved: boolean;
}

const IDLE: TouchStickState = Object.freeze({
  active: false,
  originX: 0,
  originY: 0,
  knobX: 0,
  knobY: 0,
});

/**
 * Floating virtual stick (P1 only, §7.6). The start/move/end methods take coordinates relative to
 * the target element, so the state machine is testable without a DOM; attach() wires touch events.
 */
export class TouchStickSource {
  onPauseRequest: (() => void) | null = null;
  enabled = true;
  private s: TouchStickState = IDLE;
  private stickId: number | null = null;
  private readonly taps = new Map<number, Tap>();
  private readonly listeners = new Set<Listener>();
  private el: HTMLElement | null = null;
  private readonly onTouch = (e: TouchEvent) => this.handleTouch(e);

  get state(): TouchStickState {
    return this.s;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.s);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private set(next: TouchStickState): void {
    this.s = next;
    for (const cb of this.listeners) cb(next);
  }

  start(id: number, x: number, y: number, width: number, timeMs = 0): void {
    if (!this.enabled) return;
    if (x < width * TOUCH_STICK_ZONE) {
      if (this.stickId !== null) return;
      this.stickId = id;
      this.set({ active: true, originX: x, originY: y, knobX: 0, knobY: 0 });
    } else {
      this.taps.set(id, { x, y, t: timeMs, moved: false });
    }
  }

  move(id: number, x: number, y: number): void {
    const tap = this.taps.get(id);
    if (tap) {
      if (Math.abs(x - tap.x) > TAP_MAX_MOVE_PX || Math.abs(y - tap.y) > TAP_MAX_MOVE_PX) {
        tap.moved = true;
      }
      return;
    }
    if (id !== this.stickId) return;
    let dx = x - this.s.originX;
    let dy = y - this.s.originY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > TOUCH_RADIUS_PX) {
      dx = (dx / d) * TOUCH_RADIUS_PX;
      dy = (dy / d) * TOUCH_RADIUS_PX;
    }
    this.set({ ...this.s, knobX: dx, knobY: dy });
  }

  end(id: number, timeMs = 0): void {
    const tap = this.taps.get(id);
    if (tap) {
      this.taps.delete(id);
      if (!tap.moved && timeMs - tap.t <= TAP_MAX_MS) this.onPauseRequest?.();
      return;
    }
    if (id !== this.stickId) return;
    this.stickId = null;
    this.set(IDLE);
  }

  cancelAll(): void {
    this.taps.clear();
    if (this.stickId !== null) {
      this.stickId = null;
      this.set(IDLE);
    }
  }

  /** Screen-space stick. */
  tick(): StickVector {
    if (!this.s.active) return { x: 0, y: 0 };
    const { knobX, knobY } = this.s;
    if (knobX * knobX + knobY * knobY < TOUCH_DEADZONE_PX * TOUCH_DEADZONE_PX) {
      return { x: 0, y: 0 };
    }
    return { x: knobX / TOUCH_RADIUS_PX, y: knobY / TOUCH_RADIUS_PX };
  }

  /** Clears the stick (the finger must lift and touch again). */
  reset(): void {
    this.cancelAll();
  }

  attach(el: HTMLElement): void {
    if (this.el === el) return;
    this.detach();
    this.el = el;
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener("touchstart", this.onTouch, opts);
    el.addEventListener("touchmove", this.onTouch, opts);
    el.addEventListener("touchend", this.onTouch, opts);
    el.addEventListener("touchcancel", this.onTouch, opts);
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener("touchstart", this.onTouch);
    el.removeEventListener("touchmove", this.onTouch);
    el.removeEventListener("touchend", this.onTouch);
    el.removeEventListener("touchcancel", this.onTouch);
    this.el = null;
    this.cancelAll();
  }

  private handleTouch(e: TouchEvent): void {
    const el = this.el;
    if (!el || !this.enabled) return;
    if (e.cancelable) e.preventDefault();
    const r = el.getBoundingClientRect();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t) continue;
      const x = t.clientX - r.left;
      const y = t.clientY - r.top;
      switch (e.type) {
        case "touchstart":
          this.start(t.identifier, x, y, r.width, e.timeStamp);
          break;
        case "touchmove":
          this.move(t.identifier, x, y);
          break;
        case "touchend":
          this.end(t.identifier, e.timeStamp);
          break;
        default:
          if (t.identifier === this.stickId) this.end(t.identifier, e.timeStamp);
          this.taps.delete(t.identifier);
      }
    }
  }
}
