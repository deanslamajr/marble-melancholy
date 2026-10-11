import { navigate } from "../../app/router";
import { BUILD_LABEL, FEEDBACK_URL, openFeedback } from "../../version";
import { useController } from "../context";
import { FullscreenButton } from "./FullscreenButton";
import { MenuList, type MenuItem } from "./MenuList";
import { PixelText } from "./PixelText";

export function TitleScreen() {
  const c = useController();
  const err = c.error.value;
  const items: MenuItem[] = [
    {
      label: "PLAY",
      onSelect: () => navigate({ name: "play" }),
      disabled: c.courseLevels.length === 0,
    },
    { label: "EXTRA COURSES", onSelect: () => navigate({ name: "extras" }) },
    { label: "GENERATE COURSE", onSelect: () => navigate({ name: "generate" }) },
    { label: "CUSTOM RACES", onSelect: () => navigate({ name: "custom" }) },
    { label: "SHARED COURSES", onSelect: () => navigate({ name: "shared" }) },
    { label: "LEVEL BUILDER", onSelect: () => navigate({ name: "builder" }) },
    { label: "HIGH SCORES", onSelect: () => navigate({ name: "scores" }) },
    { label: "SETTINGS", onSelect: () => navigate({ name: "settings" }) },
  ];
  if (FEEDBACK_URL) items.push({ label: "FEEDBACK", onSelect: openFeedback, hint: "↗" });
  return (
    <div class="overlay title-screen" data-testid="title-screen">
      <div class="title-logo">
        <PixelText as="h1" size="xl" class="logo-line">
          MARBLE
        </PixelText>
        <PixelText as="h1" size="xl" class="logo-line logo-sub">
          MELANCHOLY
        </PixelText>
        <PixelText size="s" tone="dim">
          a short, sad race downhill
        </PixelText>
      </div>
      {err && (
        <PixelText size="s" tone="warn" class="error-line">
          {err}
        </PixelText>
      )}
      <MenuList testId="title-menu" items={items} />
      <PixelText size="s" tone="dim" class="version">
        {BUILD_LABEL}
      </PixelText>
      <FullscreenButton />
    </div>
  );
}

export function AttractOverlay() {
  return (
    <div class="overlay attract" data-testid="attract">
      <PixelText size="l" class="blink">
        DEMO
      </PixelText>
      <PixelText size="s" tone="dim">
        PRESS ANY KEY
      </PixelText>
    </div>
  );
}
