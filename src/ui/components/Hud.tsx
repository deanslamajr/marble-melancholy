import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { PixelText } from "./PixelText";

export function Hud() {
  const c = useController();
  const hud = c.hud.value;
  if (!hud) return null;
  const two = hud.players.length === 2;
  return (
    <div class="hud" data-testid="hud">
      <div class="hud-row">
        {hud.players.map((p) => (
          <div key={p.index} class={`hud-player hud-p${p.index + 1} ${two ? "" : "solo"}`}>
            <PixelText size="s" tone={two ? (p.index === 0 ? "p1" : "p2") : "dim"}>
              {two
                ? `P${p.index + 1}`
                : hud.raceNumber
                  ? `RACE ${hud.raceNumber}`
                  : (c.intro.value?.label.split(" ")[0] ?? "CUSTOM")}
            </PixelText>
            <PixelText
              size="l"
              tone={p.lowTime ? "warn" : "normal"}
              class={p.lowTime ? "blink-fast" : ""}
            >
              <span data-testid={`hud-time-${p.index}`}>{String(p.timeSec).padStart(2, "0")}</span>
            </PixelText>
            <PixelText size="s">
              <span data-testid={`hud-score-${p.index}`}>{formatScore(p.score)}</span>
            </PixelText>
            {p.finished && (
              <PixelText size="s" tone="accent">
                HOME
              </PixelText>
            )}
            {hud.timeOut[p.index] && (
              <PixelText size="s" tone="warn">
                TIME OUT
              </PixelText>
            )}
          </div>
        ))}
      </div>
      {hud.finishIn !== null && (
        <PixelText size="m" tone="warn" class="hud-finish">
          FINISH IN {hud.finishIn}
        </PixelText>
      )}
      {hud.countdown !== null && (
        <div class="countdown" data-testid="countdown">
          <PixelText size="xl">{hud.countdown === 0 ? "GO!" : hud.countdown}</PixelText>
        </div>
      )}
      {c.settings.value.showFps && <div class="fps">{c.fps.value} FPS</div>}
    </div>
  );
}
