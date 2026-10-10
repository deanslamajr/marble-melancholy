export const SETTINGS_KEY = "marble-melancholy.settings.v1";

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  mouseSensitivity: number;
  keyboardMapping: "screen" | "world";
  p2Keys: "ijkl" | "wasd";
  showFps: boolean;
  touchControls: "auto" | "on" | "off";
  screenShake: boolean;
  /** Canvas pixels per screen point: fast 1, normal 2, sharp up to 3 (R20). */
  graphics: "fast" | "normal" | "sharp";
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  masterVolume: 1,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  mouseSensitivity: 1.0,
  keyboardMapping: "screen",
  p2Keys: "ijkl",
  showFps: false,
  touchControls: "auto",
  screenShake: true,
  graphics: "normal",
});

export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 2.0;

/** In-memory Storage used when localStorage is missing (Node) or unusable. */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  const s = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  return s as Storage;
}

let fallback: Storage | null = null;

/** globalThis.localStorage when accessible, else a process-wide in-memory store. */
export function defaultStorage(): Storage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) return ls;
  } catch {
    // Accessing localStorage throws in some sandboxed contexts.
  }
  fallback ??= createMemoryStorage();
  return fallback;
}

export function readJson(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

export function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode: settings simply do not persist.
  }
}

function num(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function oneOf<T extends string>(v: unknown, options: readonly T[], def: T): T {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : def;
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

/** Merge an untrusted object over the defaults, clamping and dropping invalid fields. */
export function sanitizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    masterVolume: num(o.masterVolume, d.masterVolume, 0, 1),
    musicVolume: num(o.musicVolume, d.musicVolume, 0, 1),
    sfxVolume: num(o.sfxVolume, d.sfxVolume, 0, 1),
    mouseSensitivity: num(o.mouseSensitivity, d.mouseSensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX),
    keyboardMapping: oneOf(o.keyboardMapping, ["screen", "world"], d.keyboardMapping),
    p2Keys: oneOf(o.p2Keys, ["ijkl", "wasd"], d.p2Keys),
    showFps: bool(o.showFps, d.showFps),
    touchControls: oneOf(o.touchControls, ["auto", "on", "off"], d.touchControls),
    screenShake: bool(o.screenShake, d.screenShake),
    graphics: oneOf(o.graphics, ["fast", "normal", "sharp"], d.graphics),
  };
}

export function loadSettings(storage: Storage = defaultStorage()): Settings {
  return sanitizeSettings(readJson(storage, SETTINGS_KEY));
}

export function saveSettings(s: Settings, storage: Storage = defaultStorage()): void {
  writeJson(storage, SETTINGS_KEY, sanitizeSettings(s));
}
