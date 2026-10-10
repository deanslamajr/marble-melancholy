import type { InputFrame } from "../sim/types";
import { GamepadSource, type PadProvider } from "./gamepad";
import { KeyboardSource, bindingsFor } from "./keyboard";
import { keyboardToWorld, largestMagnitude, screenToWorld, toInputFrame } from "./mapping";
import { MouseSource } from "./mouse";
import { TouchStickSource } from "./touch";
import { TICK_DT, type ButtonPress, type StickVector } from "./types";

export interface InputSettings {
  mouseSensitivity: number;
  keyboardMapping: "screen" | "world";
  p2Keys: "ijkl" | "wasd";
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Owns every device and assigns them to players (§7.6). Keyboard listens on the window; mouse and
 * touch on the attached target. Gamepad menu presses come from pollButtons(); while racing,
 * sample() consumes pad presses and turns a pause press into onPauseRequest.
 */
export class InputManager {
  onPauseRequest: (() => void) | null = null;
  readonly touch = new TouchStickSource();
  readonly mouse = new MouseSource();
  readonly gamepads: GamepadSource;
  private readonly keyboards: [KeyboardSource, KeyboardSource];
  private settings: InputSettings;
  private players: 1 | 2 = 1;
  private readonly injected: [InputFrame | null, InputFrame | null] = [null, null];
  private target: HTMLElement | null = null;
  private locked = false;
  private exitingByUs = false;
  private mouseEnabled = true;
  private cursorX = 0;
  private cursorY = 0;

  constructor(settings: InputSettings, padProvider?: PadProvider) {
    this.settings = { ...settings };
    this.gamepads = new GamepadSource(padProvider);
    this.keyboards = [
      new KeyboardSource(bindingsFor(0, 1, settings.p2Keys)),
      new KeyboardSource(bindingsFor(1, 1, settings.p2Keys)),
    ];
    this.mouse.sensitivity = settings.mouseSensitivity;
  }

  get enableMouse(): boolean {
    return this.mouseEnabled;
  }

  set enableMouse(v: boolean) {
    this.mouseEnabled = v;
    if (!v) {
      this.exitPointerLock();
      this.mouse.setCursor(null);
      this.mouse.reset();
    }
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** Cursor relative to the target's top-left (CSS px); active only in absolute fallback mode. */
  get absoluteMouse(): { active: boolean; x: number; y: number } {
    return {
      active: this.mouseEnabled && !this.locked && this.mouse.absoluteActive,
      x: this.cursorX,
      y: this.cursorY,
    };
  }

  /** Mouse input uses `target`; touch input uses `touchTarget`, which may be larger (I13). */
  attach(target: HTMLElement, touchTarget: HTMLElement = target): void {
    if (this.target === target) return;
    this.detach();
    this.target = target;
    const doc = target.ownerDocument;
    const win = doc.defaultView;
    win?.addEventListener("keydown", this.onKeyDown);
    win?.addEventListener("keyup", this.onKeyUp);
    win?.addEventListener("blur", this.onBlur);
    doc.addEventListener("pointerlockchange", this.onLockChange);
    doc.addEventListener("pointerlockerror", this.onLockError);
    doc.addEventListener("mousemove", this.onMouseMove);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerleave", this.onPointerLeave);
    this.touch.attach(touchTarget);
    this.locked = doc.pointerLockElement === target;
  }

  detach(): void {
    const target = this.target;
    if (!target) return;
    this.exitPointerLock();
    const doc = target.ownerDocument;
    const win = doc.defaultView;
    win?.removeEventListener("keydown", this.onKeyDown);
    win?.removeEventListener("keyup", this.onKeyUp);
    win?.removeEventListener("blur", this.onBlur);
    doc.removeEventListener("pointerlockchange", this.onLockChange);
    doc.removeEventListener("pointerlockerror", this.onLockError);
    doc.removeEventListener("mousemove", this.onMouseMove);
    target.removeEventListener("pointermove", this.onPointerMove);
    target.removeEventListener("pointerleave", this.onPointerLeave);
    this.touch.detach();
    for (const k of this.keyboards) k.releaseAll();
    this.mouse.setCursor(null);
    this.target = null;
    this.locked = false;
    this.reset();
  }

  setPlayers(n: 1 | 2): void {
    this.players = n;
    this.applyBindings();
  }

  updateSettings(s: Partial<InputSettings>): void {
    this.settings = { ...this.settings, ...s };
    this.mouse.sensitivity = this.settings.mouseSensitivity;
    this.applyBindings();
  }

  private applyBindings(): void {
    this.keyboards[0].setBindings(bindingsFor(0, this.players, this.settings.p2Keys));
    this.keyboards[1].setBindings(bindingsFor(1, this.players, this.settings.p2Keys));
  }

  sample(player: 0 | 1): InputFrame {
    if (player === 0) {
      this.gamepads.update();
      const presses = this.gamepads.drain();
      if (presses.some((p) => p.button === "pause")) this.onPauseRequest?.();
    }
    const candidates: StickVector[] = [
      keyboardToWorld(this.keyboards[player].tick(TICK_DT), this.settings.keyboardMapping),
    ];
    if (player === 0) {
      const m = this.mouse.tick();
      if (this.mouseEnabled) candidates.push(screenToWorld(m.x, m.y));
      const t = this.touch.tick();
      candidates.push(screenToWorld(t.x, t.y));
    }
    const pad =
      this.players === 1
        ? player === 0
          ? this.gamepads.anyStick()
          : null
        : this.gamepads.stick(player);
    if (pad) candidates.push(screenToWorld(pad.x, pad.y));

    const inj = this.injected[player];
    if (inj) return toInputFrame({ x: inj.ax, y: inj.ay });
    return toInputFrame(largestMagnitude(candidates));
  }

  reset(): void {
    for (const k of this.keyboards) k.reset();
    this.mouse.reset();
    this.touch.reset();
    this.gamepads.reset();
  }

  setInjected(player: 0 | 1, frame: InputFrame | null): void {
    this.injected[player] = frame ? { ax: frame.ax, ay: frame.ay } : null;
  }

  requestPointerLock(): void {
    const target = this.target;
    if (!target || !this.mouseEnabled || this.locked) return;
    if (typeof target.requestPointerLock !== "function") {
      this.mouse.absoluteMode = true;
      return;
    }
    try {
      const r = target.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>).catch(() => {
          this.mouse.absoluteMode = true;
        });
      }
    } catch {
      this.mouse.absoluteMode = true;
    }
  }

  exitPointerLock(): void {
    const target = this.target;
    if (!target || !this.locked) return;
    this.exitingByUs = true;
    target.ownerDocument.exitPointerLock?.();
  }

  pollButtons(): ButtonPress[] {
    return this.gamepads.pollButtons();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isEditable(e.target)) return;
    this.keyboards[0].keyDown(e.code);
    this.keyboards[1].keyDown(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keyboards[0].keyUp(e.code);
    this.keyboards[1].keyUp(e.code);
  };

  private readonly onBlur = (): void => {
    for (const k of this.keyboards) k.releaseAll();
  };

  private readonly onLockChange = (): void => {
    const target = this.target;
    if (!target) return;
    const now = target.ownerDocument.pointerLockElement === target;
    const was = this.locked;
    this.locked = now;
    if (now) {
      this.mouse.absoluteMode = false;
      this.mouse.reset();
    } else if (was) {
      this.mouse.reset();
      const byUs = this.exitingByUs;
      this.exitingByUs = false;
      if (!byUs) this.onPauseRequest?.();
    }
  };

  private readonly onLockError = (): void => {
    this.mouse.absoluteMode = true;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (this.locked && this.mouseEnabled) this.mouse.feed(e.movementX, e.movementY);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const target = this.target;
    if (!target || e.pointerType !== "mouse" || this.locked) return;
    const r = target.getBoundingClientRect();
    this.cursorX = e.clientX - r.left;
    this.cursorY = e.clientY - r.top;
    this.mouse.setCursor({ x: this.cursorX - r.width / 2, y: this.cursorY - r.height / 2 });
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === "mouse") this.mouse.setCursor(null);
  };
}
