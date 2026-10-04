// Game FSM states and the allowed transitions (§7.9).

export type GameState =
  | "boot"
  | "title"
  | "attract"
  | "playerSelect"
  | "settings"
  | "scores"
  | "custom"
  | "raceIntro"
  | "countdown"
  | "racing"
  | "paused"
  | "raceComplete"
  | "courseComplete"
  | "gameOver"
  | "highScoreEntry"
  | "highScoreTable";

export const TRANSITIONS: Readonly<Record<GameState, readonly GameState[]>> = {
  boot: ["title"],
  title: ["attract", "playerSelect", "settings", "scores", "custom", "raceIntro"],
  attract: ["title"],
  playerSelect: ["raceIntro", "title"],
  settings: ["title", "paused"],
  scores: ["title"],
  custom: ["raceIntro", "title"],
  raceIntro: ["countdown", "title", "custom"],
  countdown: ["racing", "paused", "title", "custom"],
  racing: ["paused", "raceComplete", "gameOver", "title", "custom"],
  paused: ["racing", "countdown", "raceIntro", "settings", "title", "custom"],
  raceComplete: ["raceIntro", "courseComplete", "custom", "title"],
  courseComplete: ["highScoreEntry", "highScoreTable"],
  gameOver: ["highScoreEntry", "highScoreTable", "custom"],
  highScoreEntry: ["highScoreEntry", "highScoreTable"],
  highScoreTable: ["title"],
};

export function canTransition(from: GameState, to: GameState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Seconds a timed phase lasts before the controller advances automatically. */
export const PHASE_SECONDS = {
  raceIntro: 2.0,
  raceComplete: 3.0,
  raceCompleteDelay1P: 1.5,
  timeoutToGameOver: 2.0,
  courseComplete: 4.0,
  gameOver: 2.5,
  highScoreTable: 8.0,
  titleIdleToAttract: 25.0,
} as const;

/** States in which the sim advances. */
export function simRuns(s: GameState): boolean {
  return s === "countdown" || s === "racing";
}
