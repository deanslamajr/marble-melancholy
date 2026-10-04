/** A 2D stick vector inside (or on) the unit disk. Screen space: x right+, y down+. */
export interface StickVector {
  x: number;
  y: number;
}

export type Device = "keyboard" | "mouse" | "gamepad" | "touch";

export type PlayerIndex = 0 | 1;

export type MenuButton = "confirm" | "back" | "pause" | "select" | "up" | "down" | "left" | "right";

export interface ButtonPress {
  pad: number;
  button: MenuButton;
}

export type KeyboardMapping = "screen" | "world";

export type P2Keys = "ijkl" | "wasd";

export const ZERO_STICK: Readonly<StickVector> = Object.freeze({ x: 0, y: 0 });

/** Fixed sim step (§7.1); every source advances by exactly this per sample. */
export const TICK_DT = 1 / 120;
