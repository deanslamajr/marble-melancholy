import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { FeedbackLink } from "./FeedbackLink";
import { PixelText } from "./PixelText";

export function RaceComplete() {
  const c = useController();
  const r = c.results.value;
  if (!r) return null;
  if (r.custom) {
    const cu = r.custom;
    const under = cu.timeSec <= cu.par;
    return (
      <div class="overlay center-col card" data-testid="race-complete">
        <PixelText size="xl">{cu.finished ? "HOME!" : "TIME OUT"}</PixelText>
        {cu.finished && (
          <>
            <PixelText size="l">TIME {cu.timeSec.toFixed(2)}s</PixelText>
            <PixelText size="m" tone={under ? "accent" : "dim"}>
              PAR {cu.par}s {under ? "· UNDER PAR" : ""}
            </PixelText>
            {cu.newBest && <PixelText tone="accent">NEW BEST</PixelText>}
            {!cu.newBest && cu.bestSec !== null && (
              <PixelText size="s" tone="dim">
                BEST {cu.bestSec.toFixed(2)}s
              </PixelText>
            )}
          </>
        )}
        <FeedbackLink />
      </div>
    );
  }
  const two = r.rows.length === 2;
  return (
    <div class="overlay center-col card" data-testid="race-complete">
      <PixelText size="xl">RACE COMPLETE</PixelText>
      <table class="results">
        <thead>
          <tr>
            <th />
            {r.rows.map((row) => (
              <th key={row.player} class={two ? `p${row.player + 1}` : ""}>
                {two ? `P${row.player + 1}` : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row
            label="TIME LEFT"
            values={r.rows.map((x) => (x.finished ? `${x.timeLeftSec}s` : "—"))}
          />
          <Row label="PROGRESS" values={r.rows.map((x) => formatScore(x.progress))} />
          <Row label="GOAL" values={r.rows.map((x) => formatScore(x.goal))} />
          <Row label="TIME BONUS" values={r.rows.map((x) => formatScore(x.timeBonus))} />
          {two && <Row label="FIRST HOME" values={r.rows.map((x) => formatScore(x.firstHome))} />}
          <Row label="TOTAL" values={r.rows.map((x) => formatScore(x.total))} strong />
        </tbody>
      </table>
      <FeedbackLink />
    </div>
  );
}

function Row(props: { label: string; values: string[]; strong?: boolean }) {
  return (
    <tr class={props.strong ? "strong" : ""}>
      <th>{props.label}</th>
      {props.values.map((v, i) => (
        <td key={i}>{v}</td>
      ))}
    </tr>
  );
}
