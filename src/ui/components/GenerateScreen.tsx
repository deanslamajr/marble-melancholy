import { useEffect, useState } from "preact/hooks";
import { GEN_DIFFICULTIES, navigate, route, routeHash, type GenDifficulty } from "../../app/router";
import type { GameController } from "../../game/GameController";
import type { CourseMetrics } from "../../level/generate/metrics";
import type { GenerateProgress } from "../../level/generate/pipeline";
import type { CompiledLevel } from "../../level/types";
import { LevelLoader } from "../../levels/loader";
import { TICK_HZ } from "../../sim/constants";
import { putCustomLevel } from "../../storage/levelsStore";
import { useController } from "../context";
import { PixelText } from "./PixelText";

type Ready = {
  kind: "ready";
  level: CompiledLevel;
  segments: string[];
  attempts: number;
  turns: number;
  forks: number;
  version: number;
  metrics: CourseMetrics;
};
type Busy = { kind: "busy"; progress?: GenerateProgress };
type Status = Busy | Ready | { kind: "error"; message: string };

const ABORTED = "generation cancelled";
/** Longest stretch of solver work between yields to the browser, in ms. */
const SLICE_MS = 30;

const cache = new Map<string, Ready>();

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * Generates through the lazily loaded compile pipeline, then passes the stamp check like any level.
 * The solver runs in slices so the page keeps painting; `live` returning false cancels it.
 */
async function generate(
  difficulty: GenDifficulty,
  seed: number,
  onProgress: (p: GenerateProgress) => void,
  live: () => boolean,
): Promise<Ready | Status> {
  const key = `${difficulty}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const { generateLevel } = await import("../../level/generate/pipeline");
    let last = performance.now();
    const r = await generateLevel({
      seed,
      difficulty,
      onProgress: async (p) => {
        if (performance.now() - last < SLICE_MS) return;
        onProgress(p);
        await new Promise((res) => setTimeout(res, 0));
        last = performance.now();
        if (!live()) throw new Error(ABORTED);
      },
    });
    if (!r.ok) return { kind: "error", message: r.error };
    const level = await LevelLoader.load(r.level);
    const ready: Ready = {
      kind: "ready",
      level,
      segments: r.segments,
      attempts: r.attempts,
      turns: r.stats.turns,
      forks: r.stats.forks,
      version: r.version,
      metrics: r.metrics,
    };
    cache.set(key, ready);
    return ready;
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}

/** Shared links name the generator version, so a later generator can say the course changed. */
export function shareUrl(difficulty: GenDifficulty, seed: number, version?: number): string {
  const hash = routeHash({ name: "playGenerated", difficulty, seed, version });
  return typeof location === "undefined" ? hash : `${location.origin}${location.pathname}${hash}`;
}

/** In-app navigation keeps a link's version only until the player changes the course. */
function show(d: GenDifficulty, s: number, version?: number): void {
  navigate({ name: "generate", difficulty: d, seed: s, version }, { replace: true });
}

function playGenerated(
  c: GameController,
  level: CompiledLevel,
  d: GenDifficulty,
  s: number,
  version?: number,
): void {
  navigate({ name: "playGenerated", difficulty: d, seed: s, version }, { replace: true });
  c.startCustom(level, () => show(d, s, version), { label: `GENERATED · ${d.toUpperCase()}` });
}

export function GenerateScreen() {
  const c = useController();
  const r = route.value;
  const params = r.name === "generate" || r.name === "playGenerated" ? r : null;
  const difficulty: GenDifficulty = params?.difficulty ?? "medium";
  const seed = params?.seed;
  const linkVersion = params?.version;
  const autoPlay = r.name === "playGenerated";
  const [status, setStatus] = useState<Status>({ kind: "busy" });
  const [msg, setMsg] = useState<string | null>(null);
  const [seedText, setSeedText] = useState(seed === undefined ? "" : String(seed));

  const play = (level: CompiledLevel, d: GenDifficulty, s: number) =>
    playGenerated(c, level, d, s, linkVersion);

  useEffect(() => {
    if (seed === undefined) show(difficulty, randomSeed());
    else setSeedText(String(seed));
  }, [difficulty, seed]);

  useEffect(() => {
    if (seed === undefined) return;
    let alive = true;
    setStatus({ kind: "busy" });
    setMsg(null);
    void generate(
      difficulty,
      seed,
      (progress) => alive && setStatus({ kind: "busy", progress }),
      () => alive,
    ).then((s) => {
      if (!alive) return;
      setStatus(s);
      if (s.kind === "ready" && autoPlay) playGenerated(c, s.level, difficulty, seed, linkVersion);
    });
    return () => {
      alive = false;
    };
  }, [c, difficulty, seed, autoPlay, linkVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate({ name: "title" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applySeed = () => {
    const t = seedText.trim();
    if (!/^\d{1,10}$/.test(t) || Number(t) > 0xffffffff) {
      setMsg("seed must be a whole number from 0 to 4294967295");
      return;
    }
    if (Number(t) !== seed) show(difficulty, Number(t));
  };

  const save = async (level: CompiledLevel) => {
    try {
      await putCustomLevel(level);
      setMsg(`saved "${level.name}" to Custom Races`);
    } catch (e) {
      setMsg(`could not save: ${(e as Error).message}`);
    }
  };

  const ready = status.kind === "ready" ? status : null;

  const copyLink = async () => {
    if (seed === undefined) return;
    const url = shareUrl(difficulty, seed, ready?.version);
    try {
      await navigator.clipboard.writeText(url);
      setMsg("link copied");
    } catch {
      setMsg(url);
    }
  };

  const lvl = ready?.level;
  const m = ready?.metrics;
  const busy = status.kind === "busy" ? status.progress : undefined;
  const hazards = lvl ? [...new Set(lvl.entities.map((e) => e.type))] : [];

  return (
    <div class="overlay panel-screen generate-screen" data-testid="generate-screen">
      <PixelText size="l">GENERATE COURSE</PixelText>
      <div class="row-buttons" role="radiogroup" aria-label="Difficulty">
        {GEN_DIFFICULTIES.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={d === difficulty}
            class={`btn small${d === difficulty ? "" : " ghost"}`}
            data-testid={`gen-${d}`}
            onClick={() => seed !== undefined && d !== difficulty && show(d, seed)}
          >
            {d.toUpperCase()}
          </button>
        ))}
      </div>
      <label class="gen-seed">
        <PixelText size="s" tone="dim">
          SEED
        </PixelText>
        <input
          type="text"
          inputMode="numeric"
          value={seedText}
          data-testid="gen-seed"
          onInput={(e) => setSeedText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applySeed();
          }}
          onBlur={applySeed}
        />
      </label>
      <div class="gen-card" data-testid="gen-status" data-status={status.kind}>
        {status.kind === "busy" && (
          <PixelText size="s" tone="dim" testid="gen-progress">
            {busy?.phase === "solve"
              ? `solving ${Math.round(busy.progress * 100)}%`
              : "generating and solving"}
            {busy && busy.attempt > 0 ? ` · layout ${busy.attempt + 1}` : ""}…
          </PixelText>
        )}
        {status.kind === "error" && (
          <PixelText size="s" tone="warn">
            {status.message}
          </PixelText>
        )}
        {lvl && ready && (
          <>
            <PixelText size="m" class="gen-name">
              {lvl.name.toUpperCase()}
            </PixelText>
            <PixelText size="s" tone="dim">
              PAR {lvl.timing.par}s · TIME {lvl.timing.timeLimit}s · SOLVED IN{" "}
              {(lvl.solution.ticks / TICK_HZ).toFixed(2)}s
            </PixelText>
            <PixelText size="s" tone="dim">
              {ready.turns} TURNS · {ready.forks} {ready.forks === 1 ? "FORK" : "FORKS"} ·{" "}
              {hazards.length > 0 ? hazards.join(" · ").toUpperCase() : "NO HAZARDS"}
            </PixelText>
            {m && (
              <PixelText size="s" tone="dim" testid="gen-metrics">
                FRAGILITY {Math.round(m.fragility)}% · {m.dirChanges.toFixed(1)} STEERS/S ·{" "}
                {Math.round(m.offAxis)}% DIAGONAL · MIN WIDTH {m.minWidth.toFixed(1)} ·{" "}
                {Math.round(m.railless)}% RAIL-LESS · {Math.round(m.overVoid)}% OVER VOID ·{" "}
                {m.airborne} AIRBORNE
              </PixelText>
            )}
            {linkVersion !== undefined && linkVersion !== ready.version && (
              <PixelText size="s" tone="warn" class="gen-version-notice">
                THIS LINK IS FROM GENERATOR V{linkVersion}; SHOWING THE V{ready.version} COURSE FOR
                THIS SEED
              </PixelText>
            )}
          </>
        )}
      </div>
      {msg && (
        <PixelText size="s" tone="warn">
          {msg}
        </PixelText>
      )}
      <div class="row-buttons">
        <button
          type="button"
          class="btn"
          data-testid="gen-play"
          disabled={!lvl}
          onClick={() => lvl && seed !== undefined && play(lvl, difficulty, seed)}
        >
          PLAY
        </button>
        <button
          type="button"
          class="btn"
          data-testid="gen-regenerate"
          onClick={() => show(difficulty, randomSeed())}
        >
          REGENERATE
        </button>
        <button
          type="button"
          class="btn"
          data-testid="gen-save"
          disabled={!lvl}
          onClick={() => lvl && void save(lvl)}
        >
          SAVE
        </button>
        <button
          type="button"
          class="btn ghost"
          disabled={seed === undefined}
          onClick={() => void copyLink()}
        >
          COPY LINK
        </button>
        <button type="button" class="btn ghost" onClick={() => navigate({ name: "title" })}>
          BACK
        </button>
      </div>
    </div>
  );
}
