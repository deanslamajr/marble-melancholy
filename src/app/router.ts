// Hash router (D10): works from file:// and any static host.
import { signal } from "@preact/signals";

export type Route =
  | { name: "title" }
  | { name: "play" }
  | { name: "playCustom"; id: string }
  | { name: "custom" }
  | { name: "scores" }
  | { name: "settings" }
  | { name: "builder" }
  | { name: "builderDraft"; draftId: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  if (a === undefined) return { name: "title" };
  if (a === "play" && b === "custom" && c) return { name: "playCustom", id: c };
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
