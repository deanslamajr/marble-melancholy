import { useCallback, useEffect, useState } from "preact/hooks";
import { navigate } from "../../app/router";
import { importText, pickFile } from "../../builder/editor/io";
import { LevelLoader } from "../../levels/loader";
import { fixtureIds } from "../../levels/manifest";
import { TICK_HZ } from "../../sim/constants";
import {
  deleteCustomLevel,
  listCustomLevels,
  putCustomLevel,
  type CustomLevelRecord,
} from "../../storage/levelsStore";
import { useController } from "../context";
import { PixelText } from "./PixelText";

export function CustomLevels() {
  const c = useController();
  const [rows, setRows] = useState<CustomLevelRecord[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listCustomLevels()
      .then(setRows)
      .catch((e: Error) => {
        setRows([]);
        setMsg(`storage unavailable: ${e.message}`);
      });
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate({ name: "title" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const play = async (json: unknown) => {
    try {
      const level = await LevelLoader.load(json);
      navigate({ name: "playCustom", id: level.id }, { replace: true });
      c.startCustom(level, () => {
        navigate({ name: "custom" }, { replace: true });
        refresh();
      });
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const doImport = async () => {
    const f = await pickFile();
    if (!f) return;
    const r = await importText(f.text, f.name);
    if (r.kind === "error") return setMsg(r.message);
    const level = r.kind === "compiled" ? r.level : r.compiled;
    if (!level) return setMsg("imported source has no passing solution; open it in the builder");
    await putCustomLevel(level);
    setMsg(`imported ${level.name}`);
    refresh();
  };

  return (
    <div class="overlay panel-screen" data-testid="custom-levels">
      <PixelText size="l">CUSTOM RACES</PixelText>
      {msg && (
        <PixelText size="s" tone="warn">
          {msg}
        </PixelText>
      )}
      <div class="list">
        {rows === null && (
          <PixelText size="s" tone="dim">
            loading…
          </PixelText>
        )}
        {rows?.length === 0 && (
          <PixelText size="s" tone="dim">
            No custom races yet. Build one in the level builder or import a .level.json.
          </PixelText>
        )}
        {rows?.map((r) => (
          <div class="list-row" key={r.id} data-testid="custom-row">
            <span class="name">{r.level.name}</span>
            <span class="meta">par {r.level.timing.par}s</span>
            <span class="meta">
              best {r.bestTicks === null ? "—" : `${(r.bestTicks / TICK_HZ).toFixed(2)}s`}
            </span>
            <button type="button" class="btn small" onClick={() => void play(r.level)}>
              PLAY
            </button>
            <button
              type="button"
              class="btn small ghost"
              onClick={() => {
                if (confirm(`Delete ${r.level.name}?`)) void deleteCustomLevel(r.id).then(refresh);
              }}
            >
              DEL
            </button>
          </div>
        ))}
      </div>
      <details class="fixtures">
        <summary>MECHANIC TEST TRACKS</summary>
        <div class="list">
          {fixtureIds().map((id) => (
            <div class="list-row" key={id}>
              <span class="name">{id}</span>
              <button
                type="button"
                class="btn small"
                onClick={() => void LevelLoader.load(id).then(play)}
              >
                PLAY
              </button>
            </div>
          ))}
        </div>
      </details>
      <div class="row-buttons">
        <button type="button" class="btn" onClick={() => void doImport()}>
          IMPORT
        </button>
        <button type="button" class="btn" onClick={() => navigate({ name: "builder" })}>
          LEVEL BUILDER
        </button>
        <button
          type="button"
          class="btn ghost"
          data-testid="custom-back"
          onClick={() => navigate({ name: "title" })}
        >
          BACK
        </button>
      </div>
    </div>
  );
}
