// Game FSM (§7.9): owns the RaceSim, Renderer, Camera, AudioEngine and InputManager.
import { signal } from "@preact/signals";
import { AudioEngine } from "../audio/AudioEngine";
import { FixedStepper } from "../core/fixedStep";
import { InputManager } from "../input/InputManager";
import type { CompiledLevel, EntityType } from "../level/types";
import { LevelLoader } from "../levels/loader";
import { Camera } from "../render/camera";
import { Renderer } from "../render/Renderer";
import { TICK_HZ } from "../sim/constants";
import { RaceSim } from "../sim/race";
import type { InputFrame, SimEvent, SimSnapshot } from "../sim/types";
import {
  insertScore,
  loadHighScores,
  qualifies,
  saveHighScores,
  type HighScoreEntry,
} from "../storage/highscores";
import { recordBestTicks } from "../storage/levelsStore";
import { loadSettings, saveSettings, type Settings } from "../storage/settings";
import { AttractReel, type AttractRun } from "./attract";
import { displaySeconds, elapsedTicks, raceBreakdown, type RaceBreakdown } from "./scoring";
import { GameSession } from "./session";
import { canTransition, PHASE_SECONDS, simRuns, type GameState } from "./states";

export interface HudPlayer {
  index: number;
  timeSec: number;
  score: number;
  deaths: number;
  finished: boolean;
  eliminated: boolean;
  lowTime: boolean;
}

export interface HudState {
  players: HudPlayer[];
  /** Seconds left in the 2P finish window, or null. */
  finishIn: number | null;
  /** 3, 2, 1 during the countdown, 0 for "GO" (shown briefly), null otherwise. */
  countdown: number | null;
  raceNumber: number | null;
  raceName: string;
  timeOut: boolean[];
}

export interface RaceIntroInfo {
  number: number | null;
  name: string;
  timeSec: number[];
  hazards: EntityType[];
  custom: boolean;
  par: number;
}

export interface RaceResults {
  rows: RaceBreakdown[];
  custom: null | {
    finished: boolean;
    timeSec: number;
    par: number;
    bestSec: number | null;
    newBest: boolean;
  };
}

export interface FinalCard {
  title: "COURSE COMPLETE" | "GAME OVER";
  scores: number[];
}

export interface PendingEntry {
  player: number;
  score: number;
  race: number;
}

const GO_FLASH_SECONDS = 0.8;

export class GameController {
  readonly state = signal<GameState>("boot");
  readonly hud = signal<HudState | null>(null);
  readonly intro = signal<RaceIntroInfo | null>(null);
  readonly results = signal<RaceResults | null>(null);
  readonly final = signal<FinalCard | null>(null);
  readonly entry = signal<PendingEntry | null>(null);
  readonly highScores = signal<HighScoreEntry[]>(loadHighScores());
  readonly highlightRank = signal<number>(-1);
  readonly settings = signal<Settings>(loadSettings());
  readonly error = signal<string | null>(null);
  readonly paused = signal(false);
  readonly playersSelected = signal<1 | 2>(1);
  readonly fps = signal(0);

  readonly input: InputManager;
  readonly audio = new AudioEngine();
  private renderer: Renderer | null = null;
  private camera: Camera | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly stepper = new FixedStepper(120, 8);

  private course: CompiledLevel[] = [];
  private session: GameSession | null = null;
  private sim: RaceSim | null = null;
  private prev: SimSnapshot | null = null;
  private cur: SimSnapshot | null = null;
  private phaseTime = 0;
  private completeAt = -1;
  private goTime = -1;
  private timeOutFlags: boolean[] = [];
  private pendingEntries: PendingEntry[] = [];
  private reel: AttractReel | null = null;
  private attract: AttractRun | null = null;
  private stateBeforeSettings: GameState | null = null;
  private stateBeforePause: GameState | null = null;
  private raf = 0;
  private lastNow = -1;
  private lowTimeSecond: number[] = [];
  private customOnExit: (() => void) | null = null;
  private raceEpoch = 0;
  private attractEpoch = 0;

  /** E2E hook: per-player forced input (window.__mm.injectInput). */
  readonly injected: Array<InputFrame | null> = [null, null];
  /** E2E hook: real-time phases are skipped when true. */
  fastPhases = false;
  readonly perf = { frames: 0, frameMs: 0, worstMs: 0, ticks: 0 };

  constructor() {
    const s = this.settings.value;
    this.input = new InputManager({
      mouseSensitivity: s.mouseSensitivity,
      keyboardMapping: s.keyboardMapping,
      p2Keys: s.p2Keys,
    });
    this.input.onPauseRequest = () => this.pause();
    this.audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
  }

  // ---------- lifecycle ----------

  async boot(): Promise<void> {
    try {
      this.course = await LevelLoader.loadCourse();
    } catch (e) {
      this.error.value = (e as Error).message;
      this.course = [];
    }
    this.reel = new AttractReel(this.course);
    this.go("title");
  }

  attachCanvas(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return;
    this.canvas = canvas;
    this.renderer?.dispose();
    this.renderer = new Renderer(canvas, {
      debug: new URLSearchParams(location.search).has("debug"),
    });
    this.renderer.resize();
    this.input.attach(canvas);
    const lvl = this.sim?.level ?? this.attract?.level ?? this.course[0];
    if (lvl) this.useLevel(lvl as CompiledLevel);
    this.start();
  }

  detachCanvas(): void {
    this.stop();
    this.input.detach();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
  }

  resize(): void {
    this.renderer?.resize();
  }

  start(): void {
    if (this.raf) return;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.lastNow = -1;
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Gesture handler: resumes or creates the audio context; never (re)starts music. */
  unlockAudio(): void {
    void this.audio.unlock();
  }

  /**
   * Hidden tab or unfocused window: suspend all audio. A race is auto-paused only when the page is
   * hidden (rAF stops, and the player cannot see the marble); a mere blur keeps it running.
   */
  setPageBackground(hidden: boolean, blurred: boolean): void {
    this.audio.setBackground(hidden || blurred);
    if (hidden) this.pause();
  }

  /** Installs visibility and focus listeners for setPageBackground; returns an uninstaller. */
  watchPage(): () => void {
    let hidden = document.visibilityState === "hidden";
    let blurred = false;
    const sync = () => this.setPageBackground(hidden, blurred);
    const onVis = () => {
      hidden = document.visibilityState === "hidden";
      sync();
    };
    const onBlur = () => {
      blurred = true;
      sync();
    };
    const onFocus = () => {
      blurred = false;
      sync();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }

  // ---------- state machine ----------

  private go(next: GameState): void {
    const from = this.state.value;
    if (from !== next && !canTransition(from, next)) {
      console.warn(`game: illegal transition ${from} -> ${next}`);
    }
    this.state.value = next;
    this.phaseTime = 0;
    if (next !== "racing" && next !== "countdown") {
      this.input.exitPointerLock();
      this.audio.silenceContinuous();
    }
    if (next === "attract") this.nextAttract();
    if (next === "title") {
      this.attract = null;
      if (this.course[0]) this.useLevel(this.course[0]);
    }
    this.syncMusic();
  }

  /** Music per screen; cues make repeat calls no-ops, so only a new race or attract run restarts. */
  private syncMusic(): void {
    const s = this.state.value;
    if (simRuns(s) || s === "raceIntro" || s === "paused" || s === "raceComplete") {
      const level = this.sim?.level;
      if (level) this.audio.startMusic(level.music, 1, `race${this.raceEpoch}`);
    } else if (s === "attract" && this.attract) {
      this.audio.startMusic(this.attract.level.music, 0.4, `attract${this.attractEpoch}`);
    } else if (
      s === "title" ||
      s === "playerSelect" ||
      s === "settings" ||
      s === "scores" ||
      s === "custom"
    ) {
      this.audio.startMusic("m1-first-steps", 0.4, "menu");
    } else {
      this.audio.stopMusic();
    }
  }

  toTitle(): void {
    this.sim = null;
    this.session = null;
    this.hud.value = null;
    this.paused.value = false;
    this.go("title");
  }

  openPlayerSelect(): void {
    this.go("playerSelect");
  }

  openSettings(): void {
    this.stateBeforeSettings = this.state.value;
    this.go("settings");
  }

  closeSettings(): void {
    const back = this.stateBeforeSettings === "paused" ? "paused" : "title";
    this.stateBeforeSettings = null;
    this.go(back);
  }

  openScores(): void {
    this.highScores.value = loadHighScores();
    this.highlightRank.value = -1;
    this.go("scores");
  }

  openCustom(): void {
    this.go("custom");
  }

  updateSettings(patch: Partial<Settings>): void {
    const s = { ...this.settings.value, ...patch };
    this.settings.value = s;
    saveSettings(s);
    this.input.updateSettings({
      mouseSensitivity: s.mouseSensitivity,
      keyboardMapping: s.keyboardMapping,
      p2Keys: s.p2Keys,
    });
    this.audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
  }

  /** Begin the six-race course. */
  startCourse(players: 1 | 2): void {
    if (this.course.length === 0) {
      this.error.value ??= "No races available";
      return;
    }
    this.playersSelected.value = players;
    this.session = new GameSession("course", players, this.course);
    this.input.setPlayers(players);
    this.beginRaceIntro();
  }

  /** One-race custom mode; `onExit` returns to the custom list. */
  startCustom(level: CompiledLevel, onExit?: () => void): void {
    this.session = new GameSession("custom", 1, [level]);
    this.customOnExit = onExit ?? null;
    this.input.setPlayers(1);
    this.beginRaceIntro();
  }

  private beginRaceIntro(): void {
    const session = this.session!;
    const level = session.level;
    const start = session.startTicks();
    this.raceEpoch++;
    this.sim = new RaceSim(level, {
      players: session.players,
      startTimeTicks: start,
      countdown: true,
      sittingOut: session.sittingOut,
      baseScores: session.scores,
    });
    this.timeOutFlags = session.scores.map(() => false);
    this.lowTimeSecond = session.scores.map(() => -1);
    this.completeAt = -1;
    this.goTime = -1;
    this.useLevel(level);
    this.cur = this.sim.snapshot();
    this.prev = this.cur;
    this.camera?.snapTo(this.cur);
    const hazards = [...new Set(level.entities.map((e) => e.type))];
    this.intro.value = {
      number: session.mode === "course" ? session.raceNumber : null,
      name: level.name,
      timeSec: start.map((t) => displaySeconds(t)),
      hazards,
      custom: session.mode === "custom",
      par: level.timing.par,
    };
    this.results.value = null;
    this.input.reset();
    this.updateHud();
    this.go("raceIntro");
  }

  private useLevel(level: CompiledLevel): void {
    if (!this.renderer) return;
    this.renderer.setLevel(level);
    if (this.camera) this.camera.setBounds(level.bounds);
    else this.camera = new Camera(level.bounds);
  }

  pause(): void {
    const s = this.state.value;
    if (s !== "racing" && s !== "countdown") return;
    this.stateBeforePause = s;
    this.paused.value = true;
    this.audio.silenceContinuous();
    this.input.exitPointerLock();
    this.go("paused");
  }

  resume(): void {
    if (this.state.value !== "paused") return;
    this.paused.value = false;
    this.input.reset();
    this.stepper.reset();
    this.go(this.stateBeforePause ?? "racing");
  }

  /** Custom mode only (§7.9 pause menu). */
  restartRace(): void {
    if (!this.session) return;
    this.paused.value = false;
    this.beginRaceIntro();
  }

  quit(): void {
    this.paused.value = false;
    if (this.session?.mode === "custom") {
      this.leaveCustom();
      return;
    }
    this.toTitle();
  }

  private leaveCustom(): void {
    this.sim = null;
    this.session = null;
    this.hud.value = null;
    this.go("custom");
    const cb = this.customOnExit;
    this.customOnExit = null;
    cb?.();
  }

  requestPointerLock(): void {
    if (simRuns(this.state.value)) this.input.requestPointerLock();
  }

  submitInitials(initials: string): void {
    const e = this.entry.value;
    if (!e) return;
    const res = insertScore(this.highScores.value, {
      initials,
      score: e.score,
      race: e.race,
      players: this.session?.players ?? 1,
      date: new Date().toISOString(),
    });
    saveHighScores(res.table);
    this.highScores.value = res.table;
    this.highlightRank.value = res.rank;
    this.audio.playUi("highScore");
    this.nextEntryOrTable();
  }

  /** Any key on the high-score table / attract returns to title. */
  dismiss(): void {
    const s = this.state.value;
    if (s === "highScoreTable") this.toTitle();
    else if (s === "attract") this.go("title");
  }

  noteActivity(): void {
    if (this.state.value === "title") this.phaseTime = 0;
  }

  // ---------- test hooks ----------

  skipIntro(): void {
    const s = this.state.value;
    if (s === "raceIntro") this.beginCountdown();
    if (this.state.value === "countdown" && this.sim) {
      this.sim.countdown = Math.min(this.sim.countdown, 1);
    }
  }

  setTimer(player: number, seconds: number): void {
    const p = this.sim?.players[player];
    if (p) p.timeTicks = Math.max(1, Math.round(seconds * TICK_HZ));
  }

  get currentSim(): RaceSim | null {
    return this.sim;
  }

  get courseLevels(): readonly CompiledLevel[] {
    return this.course;
  }

  // ---------- frame ----------

  private frame(now: number): void {
    const t0 = performance.now();
    const dt = this.lastNow < 0 ? 0 : Math.min(0.25, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.phaseTime += dt;
    const s = this.state.value;

    if (s !== "racing" && s !== "countdown") this.pollMenuButtons();

    switch (s) {
      case "title":
        if (this.phaseTime > PHASE_SECONDS.titleIdleToAttract && this.course.length > 0) {
          this.go("attract");
        }
        this.drawBackdrop(dt);
        break;
      case "attract":
        this.frameAttract(dt);
        break;
      case "raceIntro":
        if (this.fastPhases || this.phaseTime >= PHASE_SECONDS.raceIntro) this.beginCountdown();
        this.drawRace(0, dt);
        break;
      case "countdown":
      case "racing":
        this.frameRace(dt);
        break;
      case "raceComplete":
        if (this.fastPhases || this.phaseTime >= PHASE_SECONDS.raceComplete)
          this.afterRaceComplete();
        else this.idleRace(dt);
        break;
      case "courseComplete":
        if (this.fastPhases || this.phaseTime >= PHASE_SECONDS.courseComplete)
          this.nextEntryOrTable();
        this.idleRace(dt);
        break;
      case "gameOver":
        if (this.fastPhases || this.phaseTime >= PHASE_SECONDS.gameOver) {
          if (this.session?.mode === "custom") this.leaveCustom();
          else this.nextEntryOrTable();
        }
        this.idleRace(dt);
        break;
      case "highScoreTable":
        if (this.phaseTime >= PHASE_SECONDS.highScoreTable) this.toTitle();
        this.drawBackdrop(dt);
        break;
      case "paused":
        this.drawRace(1, 0);
        break;
      default:
        this.drawBackdrop(dt);
    }

    const ms = performance.now() - t0;
    this.perf.frames++;
    this.perf.frameMs = this.perf.frameMs * 0.9 + ms * 0.1;
    this.perf.worstMs = Math.max(this.perf.worstMs, ms);
    if (this.renderer) this.fps.value = Math.round(this.renderer.stats.fps);
  }

  private beginCountdown(): void {
    this.stepper.reset();
    this.input.reset();
    this.go("countdown");
  }

  private frameRace(dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    const { steps, alpha } = this.stepper.advance(dt);
    const allEvents: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      const inputs: InputFrame[] = [];
      for (let p = 0; p < sim.playerCount; p++) {
        inputs.push(this.injected[p] ?? this.input.sample(p as 0 | 1));
      }
      const events = sim.step(inputs);
      this.perf.ticks++;
      this.prev = this.cur;
      this.cur = sim.snapshot();
      for (const e of events) allEvents.push(e);
      this.handleSimEvents(events);
      if (this.state.value !== "countdown" && this.state.value !== "racing") break;
    }
    if (allEvents.length > 0) {
      this.audio.handleEvents(allEvents);
      if (this.cur) this.renderer?.handleEvents(allEvents, this.cur);
    }
    if (this.cur) this.audio.updateFrame(this.cur, sim.level);
    if (this.cur && this.camera) {
      const trailing = this.camera.update(this.cur, dt);
      if (trailing !== null && sim.playerCount === 2) sim.leaveBehind(trailing);
    }
    this.timeWarnings();
    this.updateHud();
    this.draw(alpha, dt);
    if (this.completeAt >= 0 && this.phaseClock() >= this.completeAt) this.enterRaceComplete();
  }

  private raceClock = 0;
  private phaseClock(): number {
    return this.raceClock;
  }

  private handleSimEvents(events: readonly SimEvent[]): void {
    const sim = this.sim!;
    const session = this.session!;
    for (const e of events) {
      switch (e.t) {
        case "go":
          this.goTime = 0;
          this.raceClock = 0;
          this.go("racing");
          break;
        case "goal":
          if (sim.playerCount === 1) this.scheduleComplete(PHASE_SECONDS.raceCompleteDelay1P);
          break;
        case "timeout":
          this.timeOutFlags[e.player] = true;
          if (sim.playerCount === 1) this.scheduleComplete(PHASE_SECONDS.timeoutToGameOver);
          break;
        case "raceOver":
          if (sim.playerCount === 2) this.scheduleComplete(0.5);
          break;
        default:
          break;
      }
    }
    if (session && this.goTime >= 0) this.raceClock += 1 / TICK_HZ;
  }

  private scheduleComplete(delay: number): void {
    const at = this.raceClock + (this.fastPhases ? 0 : delay);
    this.completeAt = this.completeAt < 0 ? at : Math.min(this.completeAt, at);
  }

  private enterRaceComplete(): void {
    const sim = this.sim!;
    const session = this.session!;
    this.completeAt = -1;
    session.recordRace(sim);
    const anyFinished = sim.players.some((p) => p.marble.status === "finished");
    if (session.mode === "custom") {
      const p = sim.players[0]!;
      const finished = p.marble.status === "finished";
      const ticks = elapsedTicks(p, session.currentStartTicks[0]!);
      const results: RaceResults = {
        rows: [raceBreakdown(p, sim.level as CompiledLevel)],
        custom: {
          finished,
          timeSec: ticks / TICK_HZ,
          par: sim.level.timing.par,
          bestSec: null,
          newBest: false,
        },
      };
      this.results.value = results;
      if (finished) {
        void recordBestTicks(sim.level.id, ticks)
          .then((newBest) => {
            if (this.results.value === results) {
              this.results.value = { ...results, custom: { ...results.custom!, newBest } };
            }
          })
          .catch(() => undefined);
      }
      this.go("raceComplete");
      return;
    }
    if (!anyFinished && session.allOut()) {
      this.final.value = { title: "GAME OVER", scores: [...session.scores] };
      this.queueEntries();
      this.go("gameOver");
      return;
    }
    this.results.value = {
      rows: sim.players.map((p) => raceBreakdown(p, sim.level as CompiledLevel)),
      custom: null,
    };
    this.go("raceComplete");
  }

  private afterRaceComplete(): void {
    const session = this.session;
    if (!session) return this.toTitle();
    if (session.mode === "custom") return this.leaveCustom();
    if (session.allOut()) {
      this.final.value = { title: "GAME OVER", scores: [...session.scores] };
      this.queueEntries();
      this.go("gameOver");
      return;
    }
    if (session.hasNext()) {
      session.advance();
      this.beginRaceIntro();
      return;
    }
    this.final.value = { title: "COURSE COMPLETE", scores: [...session.scores] };
    this.queueEntries();
    this.go("courseComplete");
  }

  private queueEntries(): void {
    const session = this.session!;
    this.highScores.value = loadHighScores();
    this.highlightRank.value = -1;
    let table = this.highScores.value;
    this.pendingEntries = [];
    for (let p = 0; p < session.players; p++) {
      const score = session.scores[p]!;
      if (qualifies(table, score)) {
        this.pendingEntries.push({ player: p, score, race: session.reached[p]! });
        table = insertScore(table, {
          initials: "AAA",
          score,
          race: 1,
          players: session.players,
          date: "",
        }).table;
      }
    }
  }

  private nextEntryOrTable(): void {
    const next = this.pendingEntries.shift();
    if (next) {
      this.entry.value = next;
      this.go("highScoreEntry");
      return;
    }
    this.entry.value = null;
    this.go("highScoreTable");
  }

  private timeWarnings(): void {
    const sim = this.sim;
    if (!sim || this.state.value !== "racing") return;
    for (const p of sim.players) {
      if (p.eliminated || p.marble.status === "finished") continue;
      const sec = displaySeconds(p.timeTicks);
      if (sec <= 10 && sec !== this.lowTimeSecond[p.index]) {
        this.lowTimeSecond[p.index] = sec;
        this.audio.playUi("timeWarning");
      }
    }
  }

  private updateHud(): void {
    const sim = this.sim;
    const session = this.session;
    if (!sim || !session) {
      this.hud.value = null;
      return;
    }
    const cd = sim.countdown;
    let countdown: number | null = null;
    if (cd > 0) countdown = Math.ceil(cd / TICK_HZ);
    else if (this.state.value === "racing" && this.raceClock < GO_FLASH_SECONDS) countdown = 0;
    this.hud.value = {
      players: sim.players.map((p) => {
        const timeSec = displaySeconds(p.timeTicks);
        return {
          index: p.index,
          timeSec,
          score: p.score,
          deaths: p.deaths,
          finished: p.marble.status === "finished",
          eliminated: p.eliminated && p.marble.status !== "finished",
          lowTime: timeSec <= 10 && !p.eliminated,
        };
      }),
      finishIn: sim.finishWindow > 0 ? Math.ceil(sim.finishWindow / TICK_HZ) : null,
      countdown,
      raceNumber: session.mode === "course" ? session.raceNumber : null,
      raceName: sim.level.name,
      timeOut: [...this.timeOutFlags],
    };
  }

  private idleRace(dt: number): void {
    const sim = this.sim;
    if (sim && !sim.over) {
      // Finished marbles keep rolling out behind the result cards.
      const inputs = sim.players.map(() => ({ ax: 0, ay: 0 }));
      const { steps, alpha } = this.stepper.advance(dt);
      for (let i = 0; i < steps; i++) {
        const events = sim.step(inputs);
        this.prev = this.cur;
        this.cur = sim.snapshot();
        if (this.cur) this.renderer?.handleEvents(events, this.cur);
      }
      if (this.cur && this.camera) this.camera.update(this.cur, dt);
      this.draw(alpha, dt);
      return;
    }
    if (this.cur && this.camera) this.camera.update(this.cur, dt);
    this.draw(1, dt);
  }

  private drawRace(alpha: number, dt: number): void {
    this.draw(alpha, dt);
  }

  private draw(alpha: number, dt: number): void {
    if (!this.renderer || !this.camera || !this.prev || !this.cur) return;
    this.renderer.draw(this.prev, this.cur, alpha, this.camera, dt);
  }

  private drawBackdrop(dt: number): void {
    if (!this.renderer || !this.camera) return;
    this.camera.free = true;
    this.camera.pan(dt * 14, dt * 4);
    this.renderer.drawStatic(this.camera, dt);
    this.camera.free = false;
  }

  private nextAttract(): void {
    const run = this.reel?.next() ?? null;
    this.attract = run;
    this.attractEpoch++;
    if (run) {
      this.useLevel(run.level);
      this.camera?.snapTo(run.cur);
      this.stepper.reset();
    }
  }

  private frameAttract(dt: number): void {
    const run = this.attract;
    if (!run) return this.go("title");
    const { steps, alpha } = this.stepper.advance(dt);
    for (let i = 0; i < steps && !run.done; i++) {
      const events = run.step();
      this.renderer?.handleEvents(events, run.cur);
    }
    if (run.done) {
      this.nextAttract();
      this.syncMusic();
      return;
    }
    this.camera?.update(run.cur, dt);
    if (this.renderer && this.camera) this.renderer.draw(run.prev, run.cur, alpha, this.camera, dt);
  }

  private pollMenuButtons(): void {
    const presses = this.input.pollButtons();
    if (presses.length === 0) return;
    const keyFor: Record<string, string> = {
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      confirm: "Enter",
      back: "Escape",
      pause: "Escape",
    };
    for (const p of presses) {
      const key = keyFor[p.button];
      if (!key) continue;
      window.dispatchEvent(new KeyboardEvent("keydown", { key, code: `MM${key}` }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key, code: `MM${key}` }));
    }
  }

  stateHash(): string | null {
    return this.sim ? this.sim.hash() : null;
  }

  marble(player: number): { x: number; y: number; vx: number; vy: number; status: string } | null {
    const p = this.cur?.players[player];
    return p ? { x: p.x, y: p.y, vx: p.vx, vy: p.vy, status: p.status } : null;
  }
}
