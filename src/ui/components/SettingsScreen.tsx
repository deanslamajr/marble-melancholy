import { useEffect } from "preact/hooks";
import { SENSITIVITY_MAX, SENSITIVITY_MIN } from "../../storage/settings";
import { useController } from "../context";
import { ControlsHelp } from "./ControlsHelp";
import { PixelText } from "./PixelText";
import { Slider } from "./Slider";
import { Toggle } from "./Toggle";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SettingsScreen(props: { onClose: () => void }) {
  const c = useController();
  const s = c.settings.value;
  const set = c.updateSettings.bind(c);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div class="overlay panel-screen" data-testid="settings">
      <PixelText size="l">SETTINGS</PixelText>
      <div class="settings-grid">
        <Slider
          label="MASTER"
          value={s.masterVolume}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={(v) => set({ masterVolume: v })}
        />
        <Slider
          label="MUSIC"
          value={s.musicVolume}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={(v) => set({ musicVolume: v })}
        />
        <Slider
          label="EFFECTS"
          value={s.sfxVolume}
          min={0}
          max={1}
          step={0.05}
          format={pct}
          onChange={(v) => set({ sfxVolume: v })}
        />
        <Slider
          label="MOUSE SENSITIVITY"
          value={s.mouseSensitivity}
          min={SENSITIVITY_MIN}
          max={SENSITIVITY_MAX}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => set({ mouseSensitivity: v })}
        />
        <Toggle
          label="KEYBOARD"
          value={s.keyboardMapping}
          options={[
            { value: "screen", label: "SCREEN" },
            { value: "world", label: "WORLD" },
          ]}
          onChange={(v) => set({ keyboardMapping: v })}
        />
        <Toggle
          label="P2 KEYS"
          value={s.p2Keys}
          options={[
            { value: "ijkl", label: "IJKL" },
            { value: "wasd", label: "WASD" },
          ]}
          onChange={(v) => set({ p2Keys: v })}
        />
        <Toggle
          label="TOUCH STICK"
          value={s.touchControls}
          options={[
            { value: "auto", label: "AUTO" },
            { value: "on", label: "ON" },
            { value: "off", label: "OFF" },
          ]}
          onChange={(v) => set({ touchControls: v })}
        />
        <Toggle
          label="GRAPHICS"
          value={s.graphics}
          options={[
            { value: "fast", label: "FAST" },
            { value: "normal", label: "NORMAL" },
            { value: "sharp", label: "SHARP" },
          ]}
          onChange={(v) => set({ graphics: v })}
        />
        <Toggle
          label="SHOW FPS"
          value={s.showFps}
          options={[
            { value: false, label: "OFF" },
            { value: true, label: "ON" },
          ]}
          onChange={(v) => set({ showFps: v })}
        />
      </div>
      <ControlsHelp />
      <button type="button" class="btn" data-testid="settings-back" onClick={props.onClose}>
        BACK
      </button>
    </div>
  );
}
