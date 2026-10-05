// window.__mm when ?e2e=1 (D37): drives the game headlessly for Playwright.
import type { GameController } from "../game/GameController";
import { LevelLoader } from "../levels/loader";
import { courseIds } from "../levels/manifest";
import { runReplay } from "../sim/replayRunner";
import { quantizeInput } from "../sim/quantize";

export interface MmTestApi {
  state(): string;
  /** Skip the race intro card and the countdown. */
  skipIntro(): void;
  /** Make real-time phases (intro, result cards) advance immediately. */
  fastPhases(on: boolean): void;
  setTimer(player: number, seconds: number): void;
  /** Force a world-space input for a player; null releases it. */
  injectInput(player: number, ax: number | null, ay?: number): void;
  perf(): { fps: number; frameMs: number; worstMs: number; frames: number; ticks: number };
  stateHash(): string | null;
  marble(player: number): ReturnType<GameController["marble"]>;
  hud(): unknown;
  startCourse(players: 1 | 2): void;
  /** Play race `index` (0-based course order) in custom mode. */
  startRace(index: number): Promise<void>;
  courseIds(): readonly string[];
  /** Audio context state ("none" before the first gesture) and the count of music (re)starts. */
  audio(): { context: string; musicStarts: number };
  /** Re-run a level's embedded solution in this browser; compare with the stamped hash. */
  verifyReplay(
    id: string,
  ): Promise<{ stateHash: string; expected: string; ticks: number; reached: boolean }>;
}

declare global {
  interface Window {
    __mm?: MmTestApi;
  }
}

export function installTestApi(c: GameController): void {
  const api: MmTestApi = {
    state: () => c.state.value,
    skipIntro: () => c.skipIntro(),
    fastPhases: (on) => {
      c.fastPhases = on;
    },
    setTimer: (p, s) => c.setTimer(p, s),
    injectInput: (p, ax, ay = 0) => {
      c.injected[p] = ax === null ? null : quantizeInput(ax, ay);
    },
    perf: () => ({ fps: c.fps.value, ...c.perf }),
    stateHash: () => c.stateHash(),
    marble: (p) => c.marble(p),
    hud: () => c.hud.value,
    startCourse: (n) => c.startCourse(n),
    startRace: async (index) => {
      const id = courseIds()[index];
      if (!id) throw new Error(`no race ${index}`);
      c.startCustom(await LevelLoader.load(id));
    },
    courseIds: () => courseIds(),
    audio: () => c.audio.debugState,
    verifyReplay: async (id) => {
      const level = await LevelLoader.load(id);
      const r = runReplay(level, level.solution.runs);
      return {
        stateHash: r.stateHash,
        expected: level.solution.stateHash,
        ticks: r.ticks,
        reached: r.reached,
      };
    },
  };
  window.__mm = api;
}
