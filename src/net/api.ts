// Shared fetch for the score server (P15). Every failure, timeout or non-JSON answer is null, so
// callers fall back to local data offline and on the static dev server.
const TIMEOUT_MS = 8000;

export async function call(
  path: string,
  init?: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  if (typeof fetch !== "function" || typeof document === "undefined") return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(new URL(`api/${path}`, document.baseURI), {
      ...init,
      signal: ctl.signal,
      headers: { "content-type": "application/json" },
    });
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
