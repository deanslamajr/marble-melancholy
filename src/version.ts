export const APP_VERSION: string = typeof BUILD_VERSION === "string" ? BUILD_VERSION : "dev";

export const BUILD_SHA: string = typeof BUILD_COMMIT === "string" ? BUILD_COMMIT : "dev";

/** Shown in the title screen corner so feedback can name the exact build. */
export const BUILD_LABEL = `BETA ${APP_VERSION} · ${BUILD_SHA}`;

function feedbackUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** External feedback form (`VITE_FEEDBACK_URL` at build time); feedback links are hidden when unset. */
export const FEEDBACK_URL: string | null = feedbackUrl(import.meta.env.VITE_FEEDBACK_URL);

export function openFeedback(): void {
  if (FEEDBACK_URL) window.open(FEEDBACK_URL, "_blank", "noopener,noreferrer");
}
