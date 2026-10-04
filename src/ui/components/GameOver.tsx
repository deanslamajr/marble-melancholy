import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { PixelText } from "./PixelText";

export function GameOver() {
  const c = useController();
  const f = c.final.value;
  return (
    <div class="overlay center-col card" data-testid="game-over">
      <PixelText size="xl" tone="warn">
        GAME OVER
      </PixelText>
      {f?.scores.map((s, i) => (
        <PixelText key={i} size="l" tone={f.scores.length > 1 ? (i === 0 ? "p1" : "p2") : "normal"}>
          {f.scores.length > 1 ? `P${i + 1} ` : ""}
          {formatScore(s)}
        </PixelText>
      ))}
    </div>
  );
}
