import { useEffect, useState } from "preact/hooks";
import { navigate, route, routeHash, type GenDifficulty } from "../../app/router";
import type { GameController } from "../../game/GameController";
import type { CompiledLevel } from "../../level/types";
import { LevelLoader } from "../../levels/loader";
import { TICK_HZ } from "../../sim/constants";
import { putCustomLevel } from "../../storage/levelsStore";
import { useController } from "../context";
import { PixelText } from "./PixelText";

const DIFFICULTIES: readonly GenDifficulty[] = ["easy", "medium", "hard"];

type Ready = { kind: "ready"; level: CompiledLevel; segments: string[]; attempts: number };
type Status = { kind: "busy" } | Ready | { kind: "error"; message: string };

const cache = new Map<string, Ready>();

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Generates through the lazily loaded compile pipeline, then passes the stamp check like any level. */
async function generate(difficulty: GenDifficulty, seed: number): Promise<Ready | Status> {
  const key = `${difficulty}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const { generateLevel } = await import("../../level/generate/pipeline");
    const r = await generateLevel({ seed, difficulty });
    if (!r.ok) return { kind: "error", message: r.error };
    const level = await LevelLoader.load(r.level);
    const ready: Ready = { kind: "ready", level, segments: r.segments, attempts: r.attempts };
    cache.set(key, ready);
    return ready;
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}

export function shareUrl(difficulty: GenDifficulty, seed: number): string {
  const hash = routeHash({ name: "playGenerated", difficulty, seed });
  return typeof location === "undefined" ? hash : `${location.origin}${location.pathname}${hash}`;
}

function show(d: GenDifficulty, s: number): void {
  navigate({ name: "generate", difficulty: d, seed: s }, { replace: true });
}

function playGenerated(c: GameController, level: CompiledLevel, d: GenDifficulty, s: number): void {
  navigate({ name: "playGenerated", difficulty: d, seed: s }, { replace: true });
  c.startCustom(level, () => show(d, s), { label: `GENERATED · ${d.toUpperCase()}` });
}

export function GenerateScreen() {
  const c = useController();
  const r = route.value;
  const params = r.name === "generate" || r.name === "playGenerated" ? r : null;
  const difficulty: GenDifficulty = params?.difficulty ?? "medium";
  const seed = params?.seed;
  const autoPlay = r.name === "playGenerated";
  const [status, setStatus] = useState<Status>({ kind: "busy" });
  const [msg, setMsg] = useState<string | null>(null);
  const [seedText, setSeedText] = useState(seed === undefined ? "" : String(seed));

  const play = (level: CompiledLevel, d: GenDifficulty, s: number) => playGenerated(c, level, d, s);

  useEffect(() => {
    if (seed === undefined) show(difficulty, randomSeed());
    else setSeedText(String(seed));
  }, [difficulty, seed]);

  useEffect(() => {
    if (seed === undefined) return;
    let alive = true;
    setStatus({ kind: "busy" });
    setMsg(null);
    void generate(difficulty, seed).then((s) => {
      if (!alive) return;
      setStatus(s);
      if (s.kind === "ready" && autoPlay) playGenerated(c, s.level, difficulty, seed);
    });
    return () => {
      alive = false;
    };
  }, [c, difficulty, seed, autoPlay]);

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

  const copyLink = async () => {
    if (seed === undefined) return;
    try {
      await navigator.clipboard.writeText(shareUrl(difficulty, seed));
      setMsg("link copied");
    } catch {
      setMsg(shareUrl(difficulty, seed));
    }
  };

  const ready = status.kind === "ready" ? status : null;
  const lvl = ready?.level;
  const hazards = lvl ? [...new Set(lvl.entities.map((e) => e.type))] : [];

  return (
    <div class="overlay panel-screen generate-screen" data-testid="generate-screen">
      <PixelText size="l">GENERATE COURSE</PixelText>
      <div class="row-buttons" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
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
          <PixelText size="s" tone="dim">
            generating and solving…
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
              {hazards.length > 0 ? hazards.join(" · ").toUpperCase() : "NO HAZARDS"}
            </PixelText>
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
