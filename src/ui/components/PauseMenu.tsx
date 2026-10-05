import { FEEDBACK_URL, openFeedback } from "../../version";
import { useController } from "../context";
import { fullscreenSupported, isFullscreen, toggleFullscreen } from "../fullscreen";
import { MenuList, type MenuItem } from "./MenuList";
import { PixelText } from "./PixelText";

export function PauseMenu(props: { custom: boolean; onSettings: () => void; onQuit: () => void }) {
  const c = useController();
  const items: MenuItem[] = [{ label: "RESUME", onSelect: () => c.resume() }];
  if (props.custom) items.push({ label: "RESTART RACE", onSelect: () => c.restartRace() });
  items.push({ label: "SETTINGS", onSelect: props.onSettings });
  if (fullscreenSupported()) {
    items.push({
      label: isFullscreen.value ? "EXIT FULLSCREEN" : "FULLSCREEN",
      onSelect: () => void toggleFullscreen(),
    });
  }
  if (FEEDBACK_URL) items.push({ label: "FEEDBACK", onSelect: openFeedback, hint: "↗" });
  items.push({ label: "QUIT", onSelect: props.onQuit });
  return (
    <div class="overlay center-col modal-backdrop" data-testid="pause-menu">
      <PixelText size="xl">PAUSED</PixelText>
      <MenuList items={items} onBack={() => c.resume()} />
    </div>
  );
}
