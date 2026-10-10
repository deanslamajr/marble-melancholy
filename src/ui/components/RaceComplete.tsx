import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatScore } from "../../game/scoring";
import type { TimeEntry } from "../../net/boards";
import { TICK_HZ } from "../../sim/constants";
import { loadInitials } from "../../storage/initials";
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
        {c.board.value && c.board.value.status !== "offline" && <BoardPanel />}
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

const TOP_ROWS = 3;

function seconds(ticks: number): string {
  return `${(ticks / TICK_HZ).toFixed(2)}s`;
}

function coarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** The course's shared best times under a single race's result (P17). */
function BoardPanel() {
  const c = useController();
  const b = c.board.value!;
  useEffect(() => {
    if (b.entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") c.continueRace();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c, b.entry]);
  const rows: Array<[number, TimeEntry]> = b.table.slice(0, TOP_ROWS).map((e, i) => [i, e]);
  if (b.highlight >= TOP_ROWS && b.table[b.highlight]) {
    rows.push([b.highlight, b.table[b.highlight]!]);
  }
  return (
    <div class="board" data-testid="race-board">
      <PixelText size="s" tone="dim">
        {b.status === "loading" ? "LOADING BOARD" : "ALL PLAYERS · BEST TIMES"}
      </PixelText>
      {b.status === "ready" && rows.length === 0 && (
        <PixelText size="s" tone="dim">
          NO TIMES YET
        </PixelText>
      )}
      {rows.length > 0 && (
        <table class="scores board-rows">
          <tbody>
            {rows.map(([i, e]) => (
              <tr key={i} class={i === b.highlight ? "hl" : ""}>
                <td class="rank">{i + 1}.</td>
                <td class="initials">{e.initials}</td>
                <td class="score">{seconds(e.ticks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {b.entry ? (
        <BoardEntry />
      ) : (
        <button
          type="button"
          class="btn small"
          data-testid="race-continue"
          onClick={() => c.continueRace()}
        >
          CONTINUE
        </button>
      )}
    </div>
  );
}

/** Initials for a finish that makes the board; the last initials used are offered first. */
function BoardEntry() {
  const c = useController();
  const e = c.board.value!.entry!;
  const [text, setText] = useState(() => loadInitials() ?? "");
  const field = useRef<HTMLInputElement>(null);
  // Desktop players can type at once; a phone opens its keyboard only on a tap.
  useLayoutEffect(() => {
    if (!coarsePointer()) field.current?.focus();
  }, []);
  const save = () => {
    if (text.length > 0) c.submitBoardInitials(text);
  };
  return (
    <div class="board-entry" data-testid="board-entry">
      <PixelText size="s" tone="accent">
        YOUR TIME MAKES THE BOARD
      </PixelText>
      <div class="row-buttons">
        <input
          ref={field}
          class="initials-box"
          data-testid="board-initials"
          aria-label="Initials"
          type="text"
          value={text}
          placeholder="AAA"
          maxLength={3}
          autoComplete="off"
          autocapitalize="characters"
          spellcheck={false}
          enterkeyhint="done"
          onInput={(ev) =>
            setText(
              ev.currentTarget.value
                .toUpperCase()
                .replace(/[^A-Z]/g, "")
                .slice(0, 3),
            )
          }
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              save();
            } else if (ev.key === "Escape") c.skipBoardEntry();
          }}
        />
        <button
          type="button"
          class="btn small"
          data-testid="board-save"
          disabled={e.sending || text.length === 0}
          onClick={save}
        >
          {e.sending ? "SAVING…" : "SAVE"}
        </button>
        <button
          type="button"
          class="btn small ghost"
          data-testid="board-skip"
          disabled={e.sending}
          onClick={() => c.skipBoardEntry()}
        >
          SKIP
        </button>
      </div>
      {e.error && (
        <PixelText size="s" tone="dim" testid="board-error">
          {e.error.toUpperCase()}
        </PixelText>
      )}
    </div>
  );
}
