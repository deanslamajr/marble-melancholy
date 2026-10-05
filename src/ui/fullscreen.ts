// Fullscreen toggle (G09). Uses the Fullscreen API where the browser offers it for elements
// (desktop, Android, iPad); iPhone Safari does not, so the toggle is hidden there.
import { signal } from "@preact/signals";

type Doc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type Orientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/** True while the page is fullscreen through the API (not as an installed app). */
export const isFullscreen = signal(false);

function doc(): Doc | null {
  return typeof document === "undefined" ? null : (document as Doc);
}

function current(): Element | null {
  const d = doc();
  return d ? (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) : null;
}

/** Launched from the home screen with `display: fullscreen`: already fullscreen, no toggle. */
function installedFullscreen(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(display-mode: fullscreen)").matches &&
    current() === null
  );
}

export function fullscreenSupported(): boolean {
  const d = doc();
  if (!d) return false;
  const el = d.documentElement as El;
  const api =
    (d.fullscreenEnabled === true && typeof el.requestFullscreen === "function") ||
    (d.webkitFullscreenEnabled === true && typeof el.webkitRequestFullscreen === "function");
  return api && !installedFullscreen();
}

export async function toggleFullscreen(): Promise<void> {
  const d = doc();
  if (!d) return;
  try {
    if (current()) {
      await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
      return;
    }
    const el = d.documentElement as El;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else await el.webkitRequestFullscreen?.();
  } catch {
    return;
  }
  // Landscape lock is only allowed in fullscreen on some browsers (Android Chrome); elsewhere
  // it rejects or is missing, and the game simply stays in whatever orientation it is in.
  const o = (typeof screen !== "undefined" ? screen.orientation : undefined) as
    Orientation | undefined;
  await o?.lock?.("landscape").catch(() => undefined);
}

let listening = false;

/** Keeps isFullscreen in sync; safe to call more than once. */
export function watchFullscreen(): void {
  const d = doc();
  if (!d || listening) return;
  listening = true;
  const sync = () => (isFullscreen.value = current() !== null);
  d.addEventListener("fullscreenchange", sync);
  d.addEventListener("webkitfullscreenchange", sync);
  sync();
}
