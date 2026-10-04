import type { ResolvedTheme, ThemeId, ThemeOverride } from "./types";

/** Base palettes for every ThemeId. Lives in src/level so the compiler can resolve themes. */
export const THEMES: Record<ThemeId, ResolvedTheme> = {
  practice: {
    id: "practice",
    top: "#8fb8de",
    sideLight: "#5a7fa8",
    sideDark: "#3b5a80",
    rail: "#d9e6f2",
    bgTop: "#1b2440",
    bgBottom: "#3a4f7a",
    accent: "#ffd166",
  },
  descent: {
    id: "descent",
    top: "#b7a6d9",
    sideLight: "#7d6aa8",
    sideDark: "#54467a",
    rail: "#ece4ff",
    bgTop: "#140f24",
    bgBottom: "#3c2a5c",
    accent: "#7cf2c8",
  },
  clockwork: {
    id: "clockwork",
    top: "#d9b77a",
    sideLight: "#a37e45",
    sideDark: "#6e532b",
    rail: "#f4e3c1",
    bgTop: "#1e140a",
    bgBottom: "#4a3218",
    accent: "#ff8a5c",
  },
  skyways: {
    id: "skyways",
    top: "#e8f1f8",
    sideLight: "#a9c2d6",
    sideDark: "#7896ad",
    rail: "#ffffff",
    bgTop: "#5aa0e0",
    bgBottom: "#cfe6f7",
    accent: "#ff5c8a",
  },
  topsy: {
    id: "topsy",
    top: "#f2a0c4",
    sideLight: "#c46a96",
    sideDark: "#8e456b",
    rail: "#fff0f7",
    bgTop: "#2a0e3a",
    bgBottom: "#7a2a6a",
    accent: "#b6ff5c",
  },
  lastledge: {
    id: "lastledge",
    top: "#9a9aa6",
    sideLight: "#5e5e6a",
    sideDark: "#3a3a44",
    rail: "#e0c0a0",
    bgTop: "#0a0608",
    bgBottom: "#3a1410",
    accent: "#ff6a2a",
  },
};

export function resolveTheme(theme: ThemeId | ThemeOverride): ResolvedTheme {
  if (typeof theme === "string") return { ...THEMES[theme] };
  const base = THEMES[theme.base];
  return {
    id: theme.base,
    top: theme.top ?? base.top,
    sideLight: theme.sideLight ?? base.sideLight,
    sideDark: theme.sideDark ?? base.sideDark,
    rail: theme.rail ?? base.rail,
    bgTop: theme.bgTop ?? base.bgTop,
    bgBottom: theme.bgBottom ?? base.bgBottom,
    accent: theme.accent ?? base.accent,
  };
}
