// Hash router (D10): works from file:// and any static host.
import { signal } from "@preact/signals";

export type GenDifficulty = "easy" | "medium" | "hard";

export type Route =
  | { name: "title" }
  | { name: "play" }
  | { name: "playCustom"; id: string }
  | { name: "custom" }
  | { name: "extras" }
  | { name: "playExtra"; id: string }
  | { name: "generate"; difficulty?: GenDifficulty; seed?: number }
  | { name: "playGenerated"; difficulty: GenDifficulty; seed: number }
  | { name: "scores" }
  | { name: "settings" }
  | { name: "builder" }
  | { name: "builderDraft"; draftId: string };

const GEN_DIFFICULTIES: readonly string[] = ["easy", "medium", "hard"];

/** Difficulty and seed from URL parts, or null when either is malformed. */
function genParams(d?: string, s?: string): { difficulty: GenDifficulty; seed: number } | null {
  if (!d || !s || !GEN_DIFFICULTIES.includes(d.toLowerCase()) || !/^\d{1,10}$/.test(s)) return null;
  const seed = Number(s);
  if (seed > 0xffffffff) return null;
  return { difficulty: d.toLowerCase() as GenDifficulty, seed };
}

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d] = parts;
  if (a === undefined) return { name: "title" };
  if (a === "play" && b === "custom" && c) return { name: "playCustom", id: c };
  if (a === "play" && b === "extra" && c) return { name: "playExtra", id: c };
  if (a === "play" && b === "generated") {
    const g = genParams(c, d);
    return g ? { name: "playGenerated", ...g } : { name: "generate" };
  }
  if (a === "extras") return { name: "extras" };
  if (a === "generate") {
    const g = genParams(b, c);
    return g ? { name: "generate", ...g } : { name: "generate" };
  }
  if (a === "play") return { name: "play" };
  if (a === "custom") return { name: "custom" };
  if (a === "scores") return { name: "scores" };
  if (a === "settings") return { name: "settings" };
  if (a === "builder" && b) return { name: "builderDraft", draftId: b };
  if (a === "builder") return { name: "builder" };
  return { name: "title" };
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case "title":
      return "#/";
    case "play":
      return "#/play";
    case "playCustom":
      return `#/play/custom/${encodeURIComponent(r.id)}`;
    case "custom":
      return "#/custom";
    case "extras":
      return "#/extras";
    case "playExtra":
      return `#/play/extra/${encodeURIComponent(r.id)}`;
    case "generate":
      return r.difficulty && r.seed !== undefined
        ? `#/generate/${r.difficulty}/${r.seed}`
        : "#/generate";
    case "playGenerated":
      return `#/play/generated/${r.difficulty}/${r.seed}`;
    case "scores":
      return "#/scores";
    case "settings":
      return "#/settings";
    case "builder":
      return "#/builder";
    case "builderDraft":
      return `#/builder/${encodeURIComponent(r.draftId)}`;
  }
}

export const route = signal<Route>(
  typeof location === "undefined" ? { name: "title" } : parseRoute(location.hash),
);

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeHash(r);
  if (typeof location === "undefined") {
    route.value = r;
    return;
  }
  if (location.hash === hash) {
    route.value = r;
    return;
  }
  if (opts.replace) {
    history.replaceState(null, "", hash);
    route.value = r;
  } else {
    location.hash = hash;
  }
}

export function startRouter(): () => void {
  const onHash = () => {
    route.value = parseRoute(location.hash);
  };
  window.addEventListener("hashchange", onHash);
  return () => window.removeEventListener("hashchange", onHash);
}
