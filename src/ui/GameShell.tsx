import { useEffect, useRef, useState } from "preact/hooks";
import { navigate, route, type Route } from "../app/router";
import type { GameController } from "../game/GameController";
import type { GameState } from "../game/states";
import { LevelLoader } from "../levels/loader";
import { bestTicksFor, recordBestTime } from "../storage/bestTimes";
import { getCustomLevel } from "../storage/levelsStore";
import { CourseComplete } from "./components/CourseComplete";
import { CustomLevels } from "./components/CustomLevels";
import { GameOver } from "./components/GameOver";
import { HighScoreEntry } from "./components/HighScoreEntry";
import { HighScoreTable } from "./components/HighScoreTable";
import { Hud } from "./components/Hud";
import { PauseMenu } from "./components/PauseMenu";
import { PlayerSelect } from "./components/PlayerSelect";
import { RaceComplete } from "./components/RaceComplete";
import { RaceIntro } from "./components/RaceIntro";
import { SettingsScreen } from "./components/SettingsScreen";
import { AttractOverlay, TitleScreen } from "./components/TitleScreen";
import { TouchButtons } from "./components/TouchButtons";
import { VirtualStick } from "./components/VirtualStick";
import { ControllerContext } from "./context";

const MENU_STATES: readonly GameState[] = [
  "title",
  "attract",
  "playerSelect",
  "settings",
  "scores",
  "custom",
];
const RACE_STATES: readonly GameState[] = [
  "raceIntro",
  "countdown",
  "racing",
  "paused",
  "raceComplete",
  "courseComplete",
  "gameOver",
];

function coarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

export function GameShell(props: { controller: GameController }) {
  const c = props.controller;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settingsFromPause, setSettingsFromPause] = useState(false);
  const state = c.state.value;
  const r = route.value;
  const prevRoute = useRef<Route | null>(null);
  const prevState = useRef<GameState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    c.attachCanvas(canvas);
    const onResize = () => c.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      c.detachCanvas();
    };
  }, [c]);

  // Route ⇄ state sync: route changes drive menu states; game-driven returns to title update the hash.
  useEffect(() => {
    // Leaving "boot" counts as a route change so deep links (e.g. shared generated courses) open.
    const routeChanged =
      prevRoute.current === null || prevRoute.current !== r || prevState.current === "boot";
    const stateChanged = prevState.current !== state;
    prevRoute.current = r;
    prevState.current = state;
    if (state === "boot") return;
    if (routeChanged && MENU_STATES.includes(state)) {
      switch (r.name) {
        case "title":
          if (state !== "title" && state !== "attract") c.toTitle();
          break;
        case "play":
          if (state !== "playerSelect") c.openPlayerSelect();
          break;
        case "custom":
        case "extras":
        case "generate":
        case "playGenerated":
          if (state !== "custom") c.openCustom();
          break;
        case "playExtra":
          void startExtraById(c, r.id);
          break;
        case "scores":
          if (state !== "scores") c.openScores();
          break;
        case "settings":
          if (state !== "settings") c.openSettings();
          break;
        case "playCustom":
          void startCustomById(c, r.id);
          break;
        default:
          break;
      }
      return;
    }
    if (stateChanged && state === "title" && r.name !== "title")
      navigate({ name: "title" }, { replace: true });
  }, [c, r, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      c.unlockAudio();
      const s = c.state.value;
      if (s === "attract") c.dismiss();
      else if (s === "title") c.noteActivity();
      else if ((s === "racing" || s === "countdown") && (e.key === "Escape" || e.code === "KeyP"))
        c.pause();
    };
    const onPointer = () => {
      c.unlockAudio();
      if (c.state.value === "attract") c.dismiss();
      else c.noteActivity();
    };
    // A touch pointerdown is not a user activation; audio can only resume on the matching pointerup.
    const onPointerUp = () => c.unlockAudio();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [c]);

  const touch = c.settings.value.touchControls;
  const showTouch = touch === "on" || (touch === "auto" && coarsePointer());
  const inRace = RACE_STATES.includes(state);
  const custom = c.intro.value?.custom ?? false;

  return (
    <ControllerContext.Provider value={c}>
      <div class="stage-wrap">
        <div class="rotate-hint" aria-hidden="true">
          ↻ ROTATE FOR A BIGGER VIEW
        </div>
        <div class="stage" data-state={state} data-testid="stage">
          <canvas id="world" ref={canvasRef} class="world" onClick={() => c.requestPointerLock()} />
          {state === "title" && <TitleScreen />}
          {state === "attract" && <AttractOverlay />}
          {state === "playerSelect" && <PlayerSelect />}
          {state === "settings" && (
            <SettingsScreen
              onClose={() => {
                if (settingsFromPause) {
                  setSettingsFromPause(false);
                  c.closeSettings();
                } else navigate({ name: "title" });
              }}
            />
          )}
          {state === "scores" && <HighScoreTable onClose={() => navigate({ name: "title" })} />}
          {state === "custom" && <SingleRaceMenu />}
          {inRace && state !== "raceIntro" && <Hud />}
          {state === "raceIntro" && <RaceIntro />}
          {state === "paused" && (
            <PauseMenu
              custom={custom}
              onSettings={() => {
                setSettingsFromPause(true);
                c.openSettings();
              }}
              onQuit={() => c.quit()}
            />
          )}
          {state === "raceComplete" && <RaceComplete />}
          {state === "courseComplete" && <CourseComplete />}
          {state === "gameOver" && <GameOver />}
          {state === "highScoreEntry" && <HighScoreEntry />}
          {state === "highScoreTable" && (
            <HighScoreTable testId="highscore-table" onClose={() => c.dismiss()} />
          )}
          {showTouch && (state === "racing" || state === "countdown") && (
            <>
              <VirtualStick />
              <TouchButtons />
            </>
          )}
          {c.input.absoluteMouse.active && state === "racing" && <div class="abs-ring" />}
        </div>
      </div>
    </ControllerContext.Provider>
  );
}

type MenuComponent = () => preact.JSX.Element;

/** The extras and generator menus are code-split like the builder. */
function LazyMenu({ load }: { load: () => Promise<MenuComponent> }) {
  const [Comp, setComp] = useState<MenuComponent | null>(null);
  useEffect(() => {
    let alive = true;
    void load().then((m) => {
      if (alive) setComp(() => m);
    });
    return () => {
      alive = false;
    };
  }, [load]);
  return Comp ? <Comp /> : null;
}

const loadExtras = () => import("./components/ExtraCourses").then((m) => m.ExtraCourses);
const loadGenerate = () => import("./components/GenerateScreen").then((m) => m.GenerateScreen);

/** The "custom" game state hosts every single-race menu; the route picks which one. */
function SingleRaceMenu() {
  const name = route.value.name;
  if (name === "extras" || name === "playExtra") return <LazyMenu load={loadExtras} />;
  if (name === "generate" || name === "playGenerated") return <LazyMenu load={loadGenerate} />;
  return <CustomLevels />;
}

async function startExtraById(c: GameController, id: string): Promise<void> {
  try {
    const level = await LevelLoader.load(id);
    if (level.course) throw new Error(`${id} is a main-course race`);
    c.startCustom(level, () => navigate({ name: "extras" }, { replace: true }), {
      label: "EXTRA COURSE",
      recordBest: recordBestTime,
      bestTicks: bestTicksFor(id),
    });
  } catch (e) {
    c.error.value = (e as Error).message;
    navigate({ name: "extras" }, { replace: true });
  }
}

async function startCustomById(c: GameController, id: string): Promise<void> {
  try {
    const rec = await getCustomLevel(id).catch(() => undefined);
    const level = await LevelLoader.load(rec ? rec.level : id);
    c.startCustom(level, () => navigate({ name: "custom" }, { replace: true }), {
      bestTicks: rec?.bestTicks ?? null,
    });
  } catch (e) {
    c.error.value = (e as Error).message;
    navigate({ name: "custom" }, { replace: true });
  }
}
