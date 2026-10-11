// Shared courses (P19): the public list, and the card a share link opens.
import { useEffect, useState } from "preact/hooks";
import { navigate, route } from "../../app/router";
import { loadSharedCourse } from "../../app/sharedCourse";
import type { CompiledLevel } from "../../level/types";
import { listSharedCourses, shareUrl, type SharedSummary } from "../../net/courses";
import { TICK_HZ } from "../../sim/constants";
import { bestTicksFor } from "../../storage/bestTimes";
import { getCustomLevel, putCustomLevel } from "../../storage/levelsStore";
import { formatTop, useBestTimes } from "../useBestTimes";
import { PixelText } from "./PixelText";

export function SharedCourses() {
  const r = route.value;
  if (r.name === "sharedCourse" || r.name === "playShared") return <SharedCourse code={r.code} />;
  return <SharedList />;
}

function useEscapeTo(target: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") target();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);
}

const toTitle = () => navigate({ name: "title" });
const toList = () => navigate({ name: "shared" });

function SharedList() {
  const [sort, setSort] = useState<"new" | "popular">("new");
  const [rows, setRows] = useState<SharedSummary[] | null>(null);
  const [more, setMore] = useState(false);
  const [offline, setOffline] = useState(false);
  useEscapeTo(toTitle);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setOffline(false);
    void listSharedCourses(sort).then((r) => {
      if (!alive) return;
      if (!r) return setOffline(true);
      setRows(r.courses);
      setMore(r.more);
    });
    return () => {
      alive = false;
    };
  }, [sort]);

  const loadMore = async () => {
    const r = await listSharedCourses(sort, rows?.length ?? 0);
    if (!r) return;
    setRows((cur) => [...(cur ?? []), ...r.courses]);
    setMore(r.more);
  };

  return (
    <div class="overlay panel-screen" data-testid="shared-courses">
      <PixelText size="l">SHARED COURSES</PixelText>
      <PixelText size="s" tone="dim">
        Courses players shared. Share yours from CUSTOM RACES.
      </PixelText>
      <div class="toggle" role="radiogroup" aria-label="SORT">
        {(["new", "popular"] as const).map((s) => (
          <button
            type="button"
            key={s}
            role="radio"
            aria-checked={sort === s}
            class={sort === s ? "on" : ""}
            onClick={() => setSort(s)}
          >
            {s === "new" ? "NEW" : "MOST RACED"}
          </button>
        ))}
      </div>
      <div class="list">
        {offline && (
          <PixelText size="s" tone="warn">
            The course server cannot be reached; try again later.
          </PixelText>
        )}
        {rows === null && !offline && (
          <PixelText size="s" tone="dim">
            loading…
          </PixelText>
        )}
        {rows?.length === 0 && (
          <PixelText size="s" tone="dim">
            No shared courses yet. Be the first: SHARE one from CUSTOM RACES.
          </PixelText>
        )}
        {rows?.map((r) => (
          <div class="list-row" key={r.code} data-testid="shared-row">
            <span class="name">{r.name}</span>
            {r.author && <span class="meta">by {r.author}</span>}
            <span class="meta">par {r.par}s</span>
            <span class="meta">top {formatTop(r.best ?? undefined)}</span>
            <button
              type="button"
              class="btn small"
              onClick={() => navigate({ name: "playShared", code: r.code })}
            >
              PLAY
            </button>
            <button
              type="button"
              class="btn small ghost"
              onClick={() => navigate({ name: "sharedCourse", code: r.code })}
            >
              OPEN
            </button>
          </div>
        ))}
      </div>
      <div class="row-buttons">
        {more && (
          <button type="button" class="btn" onClick={() => void loadMore()}>
            MORE
          </button>
        )}
        <button type="button" class="btn ghost" data-testid="shared-back" onClick={toTitle}>
          BACK
        </button>
      </div>
    </div>
  );
}

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; level: CompiledLevel };

/** The card a share link opens: the course, its board, PLAY, SAVE and the link. */
function SharedCourse(props: { code: string }) {
  const { code } = props;
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEscapeTo(toList);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    void loadSharedCourse(code).then(async (r) => {
      if (!alive) return;
      if ("error" in r) return setState({ kind: "error", message: r.error });
      setState({ kind: "ready", level: r });
      const mine = await getCustomLevel(r.id).catch(() => undefined);
      if (alive) setSaved(mine?.level.stamp.contentHash === r.stamp.contentHash);
    });
    return () => {
      alive = false;
    };
  }, [code]);

  const level = state.kind === "ready" ? state.level : null;
  const top = useBestTimes(level ? [level.stamp.contentHash] : []);
  const mine = level ? bestTicksFor(level.stamp.contentHash) : null;

  const save = async (lvl: CompiledLevel) => {
    const old = await getCustomLevel(lvl.id).catch(() => undefined);
    if (old && old.level.stamp.contentHash !== lvl.stamp.contentHash) {
      setMsg(`CUSTOM RACES already has a different course with the id "${lvl.id}"`);
      return;
    }
    try {
      await putCustomLevel(lvl);
      setSaved(true);
      setMsg("saved to CUSTOM RACES");
    } catch (e) {
      setMsg(`could not save: ${(e as Error).message}`);
    }
  };

  const copyLink = async () => {
    const url = shareUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      setMsg("link copied");
    } catch {
      setMsg(url);
    }
  };

  return (
    <div class="overlay panel-screen" data-testid="shared-course">
      <PixelText size="s" tone="dim">
        SHARED COURSE · {code.toUpperCase()}
      </PixelText>
      {state.kind === "loading" && (
        <PixelText size="s" tone="dim">
          loading…
        </PixelText>
      )}
      {state.kind === "error" && (
        <PixelText size="s" tone="warn" testid="shared-error">
          {state.message}
        </PixelText>
      )}
      {level && (
        <>
          <PixelText size="l" testid="shared-name">
            {level.name.toUpperCase()}
          </PixelText>
          {level.author && (
            <PixelText size="s" tone="dim">
              BY {level.author.toUpperCase()}
            </PixelText>
          )}
          <PixelText size="s" tone="dim">
            PAR {level.timing.par}s · TIME {level.timing.timeLimit}s
          </PixelText>
          <PixelText size="s" tone="dim" testid="shared-board">
            {top ? `TOP ${formatTop(top[level.stamp.contentHash])} · ` : ""}YOUR BEST{" "}
            {mine === null ? "—" : `${(mine / TICK_HZ).toFixed(2)}s`}
          </PixelText>
        </>
      )}
      {msg && (
        <PixelText size="s" tone="dim" testid="shared-msg">
          {msg}
        </PixelText>
      )}
      <div class="row-buttons">
        {level && (
          <>
            <button
              type="button"
              class="btn"
              data-testid="shared-play"
              onClick={() => navigate({ name: "playShared", code })}
            >
              PLAY
            </button>
            <button
              type="button"
              class="btn"
              data-testid="shared-save"
              disabled={saved}
              onClick={() => void save(level)}
            >
              {saved ? "SAVED" : "SAVE"}
            </button>
            <button type="button" class="btn" onClick={() => void copyLink()}>
              COPY LINK
            </button>
          </>
        )}
        <button type="button" class="btn ghost" onClick={toList}>
          ALL SHARED
        </button>
      </div>
    </div>
  );
}
