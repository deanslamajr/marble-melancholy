import { useEffect, useState } from "preact/hooks";
import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { PixelText } from "./PixelText";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Three initials, arcade style: up/down cycles a letter, left/right moves, Enter confirms; typing works too. */
export function HighScoreEntry() {
  const c = useController();
  const e = c.entry.value;
  const [chars, setChars] = useState<number[]>([0, 0, 0]);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    setChars([0, 0, 0]);
    setPos(0);
  }, [e]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const k = ev.key;
      if (k === "ArrowUp" || k === "ArrowDown") {
        ev.preventDefault();
        const d = k === "ArrowUp" ? 1 : -1;
        setChars((cs) => cs.map((v, i) => (i === pos ? (v + d + 26) % 26 : v)));
      } else if (k === "ArrowLeft") {
        setPos((p) => Math.max(0, p - 1));
      } else if (k === "ArrowRight") {
        setPos((p) => Math.min(2, p + 1));
      } else if (k === "Backspace") {
        setPos((p) => Math.max(0, p - 1));
      } else if (k === "Enter") {
        ev.preventDefault();
        if (pos < 2) setPos(pos + 1);
        else c.submitInitials(chars.map((v) => LETTERS[v]).join(""));
      } else if (/^[a-zA-Z]$/.test(k)) {
        const v = LETTERS.indexOf(k.toUpperCase());
        setChars((cs) => cs.map((x, i) => (i === pos ? v : x)));
        setPos((p) => Math.min(2, p + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c, chars, pos]);
  if (!e) return null;
  const two = (c.final.value?.scores.length ?? 1) > 1;
  return (
    <div class="overlay center-col card" data-testid="highscore-entry">
      <PixelText size="l" tone={two ? (e.player === 0 ? "p1" : "p2") : "accent"}>
        {two ? `PLAYER ${e.player + 1} · ` : ""}NEW HIGH SCORE
      </PixelText>
      <PixelText size="l">{formatScore(e.score)}</PixelText>
      <div class="initials-entry">
        {chars.map((v, i) => (
          <button
            type="button"
            key={i}
            class={`initial ${i === pos ? "active" : ""}`}
            onClick={() => {
              if (i === pos) setChars((cs) => cs.map((x, j) => (j === i ? (x + 1) % 26 : x)));
              setPos(i);
            }}
          >
            {LETTERS[v]}
          </button>
        ))}
      </div>
      <button
        type="button"
        class="btn"
        data-testid="initials-ok"
        onClick={() => c.submitInitials(chars.map((v) => LETTERS[v]).join(""))}
      >
        OK
      </button>
      <PixelText size="s" tone="dim">
        ↑↓ LETTER · ←→ MOVE · ENTER OK
      </PixelText>
    </div>
  );
}
