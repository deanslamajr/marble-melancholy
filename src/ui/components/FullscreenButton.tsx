import { fullscreenSupported, isFullscreen, toggleFullscreen } from "../fullscreen";

/** Corner toggle for the Fullscreen API; renders nothing where the API is unavailable. */
export function FullscreenButton() {
  if (!fullscreenSupported()) return null;
  const on = isFullscreen.value;
  // Corner brackets pointing out (enter) or in (exit).
  const d = on
    ? "M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"
    : "M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6";
  return (
    <button
      type="button"
      class="fullscreen-btn"
      data-testid="fullscreen-toggle"
      aria-label={on ? "Exit fullscreen" : "Fullscreen"}
      aria-pressed={on}
      onClick={() => void toggleFullscreen()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} />
      </svg>
    </button>
  );
}
