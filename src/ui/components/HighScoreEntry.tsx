import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { PixelText } from "./PixelText";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function coarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * Three initials, arcade style: up/down cycles a letter, left/right moves, Enter confirms; typing
 * works too. A text field lies over the letters, so a tap opens the phone's keyboard (G21).
 */
export function HighScoreEntry() {
  const c = useController();
  const e = c.entry.value;
  const [chars, setChars] = useState<number[]>([0, 0, 0]);
  const [pos, setPos] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const submit = (cs: number[]) => c.submitInitials(cs.map((v) => LETTERS[v]).join(""));
  // Layout effects: the reset and the key listener are live before the first paint, so a letter
  // typed the moment the screen appears is neither lost nor wiped (G17).
  useLayoutEffect(() => {
    setChars([0, 0, 0]);
    setPos(0);
    if (field.current) field.current.value = "";
  }, [e]);
  useLayoutEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // The field reads its own text (on-screen keyboards send no usable key codes).
      if (ev.target === field.current) return;
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

  // Typed letters replace the initials from the first one; the rest keep their letters.
  const onInput = (ev: Event) => {
    const el = ev.currentTarget as HTMLInputElement;
    const typed = el.value
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3);
    if (el.value !== typed) el.value = typed;
    setChars((cs) => cs.map((x, i) => (i < typed.length ? LETTERS.indexOf(typed[i]!) : x)));
    setPos(Math.min(2, typed.length));
    // Three letters close the keyboard, which can cover the OK button on a landscape phone.
    if (typed.length === 3) el.blur();
  };

  return (
    <div class="overlay center-col card" data-testid="highscore-entry">
      <PixelText size="l" tone={two ? (e.player === 0 ? "p1" : "p2") : "accent"}>
        {two ? `PLAYER ${e.player + 1} · ` : ""}NEW HIGH SCORE
      </PixelText>
      <PixelText size="l">{formatScore(e.score)}</PixelText>
      <div class="initials-entry">
        {chars.map((v, i) => (
          <span key={i} class={`initial ${i === pos ? "active" : ""}`}>
            {LETTERS[v]}
          </span>
        ))}
        <input
          ref={field}
          class="initials-field"
          data-testid="initials-input"
          aria-label="Initials"
          type="text"
          maxLength={3}
          autoComplete="off"
          autocapitalize="characters"
          spellcheck={false}
          enterkeyhint="done"
          onFocus={(ev) => {
            ev.currentTarget.value = "";
            setPos(0);
          }}
          onBlur={() => window.scrollTo(0, 0)}
          onInput={onInput}
          onKeyDown={(ev) => {
            if (ev.key !== "Enter") return;
            ev.preventDefault();
            submit(chars);
          }}
        />
      </div>
      <button type="button" class="btn" data-testid="initials-ok" onClick={() => submit(chars)}>
        OK
      </button>
      <PixelText size="s" tone="dim">
        {coarsePointer() ? "TAP THE LETTERS TO TYPE" : "↑↓ LETTER · ←→ MOVE · ENTER OK"}
      </PixelText>
    </div>
  );
}
