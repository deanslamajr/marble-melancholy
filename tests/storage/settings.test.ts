import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createMemoryStorage,
  loadSettings,
  saveSettings,
} from "../../src/storage/settings";

describe("settings", () => {
  it("returns defaults when empty", () => {
    expect(loadSettings(createMemoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      masterVolume: 1,
      musicVolume: 0.6,
      sfxVolume: 0.8,
      mouseSensitivity: 1,
      keyboardMapping: "screen",
      p2Keys: "ijkl",
      showFps: false,
      touchControls: "auto",
      screenShake: true,
      graphics: "normal",
    });
  });

  it("round-trips", () => {
    const st = createMemoryStorage();
    const s = { ...DEFAULT_SETTINGS, musicVolume: 0.2, p2Keys: "wasd" as const, showFps: true };
    saveSettings(s, st);
    expect(st.getItem(SETTINGS_KEY)).not.toBeNull();
    expect(loadSettings(st)).toEqual(s);
  });

  it("tolerates corrupt JSON", () => {
    const st = createMemoryStorage();
    st.setItem(SETTINGS_KEY, "{not json");
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    st.setItem(SETTINGS_KEY, "42");
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps, validates and merges partial data", () => {
    const st = createMemoryStorage();
    st.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        masterVolume: 3,
        sfxVolume: -1,
        mouseSensitivity: 9,
        keyboardMapping: "diagonal",
        touchControls: "on",
        screenShake: "yes",
        musicVolume: null,
        graphics: "ultra",
      }),
    );
    expect(loadSettings(st)).toEqual({
      ...DEFAULT_SETTINGS,
      masterVolume: 1,
      sfxVolume: 0,
      mouseSensitivity: 2,
      touchControls: "on",
    });
    st.setItem(SETTINGS_KEY, JSON.stringify({ mouseSensitivity: 0.1, graphics: "fast" }));
    expect(loadSettings(st).mouseSensitivity).toBe(0.5);
    expect(loadSettings(st).graphics).toBe("fast");
  });

  it("works without an explicit storage in Node", () => {
    saveSettings({ ...DEFAULT_SETTINGS, sfxVolume: 0.3 });
    expect(loadSettings().sfxVolume).toBe(0.3);
  });

  it("swallows storage write errors", () => {
    const st = createMemoryStorage();
    st.setItem = () => {
      throw new Error("quota");
    };
    expect(() => saveSettings(DEFAULT_SETTINGS, st)).not.toThrow();
  });
});
