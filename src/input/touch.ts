import type { StickVector } from "./types";

/** Default stick radius, CSS px; the game scales it with the stage (touchRadiusFor). */
export const TOUCH_RADIUS_PX = 60;
export const TOUCH_RADIUS_MIN_PX = 40;
export const TOUCH_RADIUS_MAX_PX = 90;
/** Stick radius as a fraction of the stage's shorter side. */
export const TOUCH_RADIUS_FRACTION = 0.13;
/** Dead zone as a fraction of the radius (8 px at the default 60 px). */
export const TOUCH_DEADZONE = 8 / 60;
/** Touches that start on these elements belong to the page (buttons, links), not the stick. */
const UI_SELECTOR = "button, a, input, select, textarea, label, [data-touch-ui]";

/** Stick radius for a stage of the given CSS size. */
export function touchRadiusFor(stageW: number, stageH: number): number {
  const r = Math.min(stageW, stageH) * TOUCH_RADIUS_FRACTION;
  return Math.round(Math.min(TOUCH_RADIUS_MAX_PX, Math.max(TOUCH_RADIUS_MIN_PX, r)));
}

export interface TouchStickState {
  active: boolean;
  /** Stick origin relative to the target's top-left, CSS px. */
  originX: number;
  originY: number;
  /** Knob offset from the origin, clamped to the radius. */
  knobX: number;
  knobY: number;
  /** Stick radius, CSS px, fixed for the duration of a touch. */
  radius: number;
}

type Listener = (s: TouchStickState) => void;

const IDLE: TouchStickState = Object.freeze({
  active: false,
  originX: 0,
  originY: 0,
  knobX: 0,
  knobY: 0,
  radius: TOUCH_RADIUS_PX,
});

/**
 * Floating virtual stick (P1 only, §7.6). The first touch anywhere on the target drives it (I13).
 * Touches never pause; the visible pause button does (I14). The start/move/end methods take
 * coordinates relative to the target element, so the state machine is testable without a DOM;
 * attach() wires touch events.
 */
export class TouchStickSource {
  /** Stick radius in CSS px for touches that start from now on. */
  radius = TOUCH_RADIUS_PX;
  private on = true;
  private s: TouchStickState = IDLE;
  private stickId: number | null = null;
  private readonly listeners = new Set<Listener>();
  private el: HTMLElement | null = null;
  private readonly onTouch = (e: TouchEvent) => this.handleTouch(e);

  get state(): TouchStickState {
    return this.s;
  }

  /** While disabled, touches pass through to the page untouched and the stick is released. */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(v: boolean) {
    if (v === this.on) return;
    this.on = v;
    this.cancelAll();
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

  start(id: number, x: number, y: number): void {
    if (!this.on || this.stickId !== null) return;
    this.stickId = id;
    this.set({ active: true, originX: x, originY: y, knobX: 0, knobY: 0, radius: this.radius });
  }

  move(id: number, x: number, y: number): void {
    if (id !== this.stickId) return;
    const r = this.s.radius;
    let dx = x - this.s.originX;
    let dy = y - this.s.originY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > r) {
      dx = (dx / d) * r;
      dy = (dy / d) * r;
    }
    this.set({ ...this.s, knobX: dx, knobY: dy });
  }

  end(id: number): void {
    if (id !== this.stickId) return;
    this.stickId = null;
    this.set(IDLE);
  }

  cancelAll(): void {
    if (this.stickId !== null) {
      this.stickId = null;
      this.set(IDLE);
    }
  }

  /** Screen-space stick. */
  tick(): StickVector {
    if (!this.s.active) return { x: 0, y: 0 };
    const { knobX, knobY, radius } = this.s;
    const dead = radius * TOUCH_DEADZONE;
    if (knobX * knobX + knobY * knobY < dead * dead) return { x: 0, y: 0 };
    return { x: knobX / radius, y: knobY / radius };
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
    if (!el || !this.on) return;
    const r = el.getBoundingClientRect();
    let handled = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (!t || isPageUi(t.target)) continue;
      handled = true;
      const x = t.clientX - r.left;
      const y = t.clientY - r.top;
      switch (e.type) {
        case "touchstart":
          this.start(t.identifier, x, y);
          break;
        case "touchmove":
          this.move(t.identifier, x, y);
          break;
        default:
          this.end(t.identifier);
      }
    }
    if (handled && e.cancelable) e.preventDefault();
  }
}

function isPageUi(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return typeof el?.closest === "function" && el.closest(UI_SELECTOR) !== null;
}
