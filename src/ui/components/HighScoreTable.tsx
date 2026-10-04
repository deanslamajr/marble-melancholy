import { useEffect } from "preact/hooks";
import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { PixelText } from "./PixelText";

export function HighScoreTable(props: { onClose: () => void; testId?: string }) {
  const c = useController();
  const rows = c.highScores.value;
  const hi = c.highlightRank.value;
  useEffect(() => {
    const onKey = () => props.onClose();
    const t = setTimeout(() => {
      window.addEventListener("keydown", onKey);
      window.addEventListener("pointerdown", onKey);
    }, 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onKey);
    };
  }, [props]);
  return (
    <div class="overlay center-col" data-testid={props.testId ?? "highscores"}>
      <PixelText size="l">HIGH SCORES</PixelText>
      <table class="scores">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} class={i === hi ? "hl" : ""}>
              <td class="rank">{i + 1}.</td>
              <td class="initials">{r.initials}</td>
              <td class="score">{formatScore(r.score)}</td>
              <td class="race">R{r.race}</td>
              <td class="pl">{r.players}P</td>
            </tr>
          ))}
        </tbody>
      </table>
      <PixelText size="s" tone="dim">
        PRESS ANY KEY
      </PixelText>
    </div>
  );
}
