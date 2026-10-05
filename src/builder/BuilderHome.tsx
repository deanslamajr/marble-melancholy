import { useCallback, useEffect, useState } from "preact/hooks";
import { navigate } from "../app/router";
import { TICK_HZ } from "../sim/constants";
import {
  deleteCustomLevel,
  deleteDraft,
  duplicateDraft,
  listCustomLevels,
  listDrafts,
  newDraftId,
  putCustomLevel,
  saveDraft,
  type CustomLevelRecord,
  type DraftRecord,
} from "../storage/levelsStore";
import { DIFFICULTIES, type Difficulty } from "../level/generate/generate";
import { generateLevel } from "../level/generate/pipeline";
import { newDraftSource } from "./editor/commands";
import { downloadText, importText, pickFile, sourceFromCompiled } from "./editor/io";
import {
  EXAMPLE_GROUP_LABEL,
  EXAMPLE_GROUPS,
  exampleDraftSource,
  exampleSource,
  listExamples,
  type ExampleEntry,
} from "./examples";

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(ms).toLocaleDateString();
}

function uniqueLevelId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 44)}-${n}`;
    if (!taken.has(id)) return id;
  }
}

async function createDraft(source: DraftRecord["source"], solved = false): Promise<DraftRecord> {
  return saveDraft({
    id: newDraftId(),
    name: source.name,
    source,
    solved,
    gridW: source.grid.width,
    gridH: source.grid.height,
  });
}

export function BuilderHome() {
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [levels, setLevels] = useState<CustomLevelRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [d, l] = await Promise.all([listDrafts(), listCustomLevels()]);
    setDrafts(d);
    setLevels(l);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const takenIds = () => new Set([...drafts.map((d) => d.source.id), ...levels.map((l) => l.id)]);

  const onNew = async () => {
    const taken = takenIds();
    let n = drafts.length + 1;
    while (taken.has(`untitled-${n}`)) n++;
    const d = await createDraft(newDraftSource(`untitled-${n}`, `Untitled ${n}`));
    navigate({ name: "builderDraft", draftId: d.id });
  };

  const onImport = async () => {
    const f = await pickFile(".level.yaml,.level.json,.yaml,.yml,.json");
    if (!f) return;
    const r = await importText(f.text, f.name);
    if (r.kind === "error") {
      setMessage(`Import failed: ${r.message}`);
      return;
    }
    if (r.kind === "compiled") {
      await putCustomLevel(r.level);
      setMessage(`Added "${r.level.name}" to Custom Races`);
    } else {
      if (r.compiled) await putCustomLevel(r.compiled);
      await createDraft(r.source);
      setMessage(`Imported "${r.source.name}" as a draft${r.compiled ? " and a custom race" : ""}`);
    }
    await refresh();
  };

  const editCopy = async (rec: CustomLevelRecord) => {
    const src = sourceFromCompiled(rec.level);
    src.id = uniqueLevelId(`${src.id}-edit`.slice(0, 48), takenIds());
    const d = await createDraft(src);
    navigate({ name: "builderDraft", draftId: d.id });
  };

  const [examples, setExamples] = useState<ExampleEntry[]>([]);
  const [exampleId, setExampleId] = useState("");
  useEffect(() => {
    let alive = true;
    void listExamples().then((list) => {
      if (!alive) return;
      setExamples(list);
      setExampleId((id) => id || (list[0]?.id ?? ""));
    });
    return () => {
      alive = false;
    };
  }, []);
  const [opening, setOpening] = useState(false);
  const openExample = async () => {
    if (!exampleId || opening) return;
    setOpening(true);
    try {
      const { source } = await exampleSource(exampleId);
      const taken = new Set([...takenIds(), ...examples.map((e) => e.id)]);
      const d = await createDraft(exampleDraftSource(source, taken));
      navigate({ name: "builderDraft", draftId: d.id });
    } catch (e) {
      setMessage(`Could not open example: ${(e as Error).message}`);
    } finally {
      setOpening(false);
    }
  };
  const [genDifficulty, setGenDifficulty] = useState<Difficulty>("medium");
  const [genSeed, setGenSeed] = useState("");
  const [generating, setGenerating] = useState(false);
  const onGenerate = async () => {
    if (generating) return;
    const text = genSeed.trim();
    if (text !== "" && (!/^\d{1,10}$/.test(text) || Number(text) > 0xffffffff)) {
      setMessage("Seed must be a whole number from 0 to 4294967295 (or empty for a random one)");
      return;
    }
    const seed = text === "" ? Math.floor(Math.random() * 1_000_000_000) : Number(text);
    setGenerating(true);
    try {
      const r = await generateLevel({ seed, difficulty: genDifficulty });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      const source = structuredClone(r.source);
      source.id = uniqueLevelId(source.id, takenIds());
      const d = await createDraft(source, true);
      navigate({ name: "builderDraft", draftId: d.id });
    } catch (e) {
      setMessage(`Could not generate: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const groups = EXAMPLE_GROUPS.map((g) => ({
    g,
    items: examples.filter((e) => e.group === g),
  })).filter((x) => x.items.length > 0);

  return (
    <div class="builder-home" data-testid="builder-home">
      <header class="bh-header">
        <h1>MARBLE MELANCHOLY · LEVEL BUILDER</h1>
        <button class="bbtn" onClick={() => navigate({ name: "title" })} data-testid="back-to-game">
          ← Game
        </button>
      </header>
      <div class="row">
        <button class="bbtn on" onClick={() => void onNew()} data-testid="new-level">
          + New level
        </button>
        <button class="bbtn" onClick={() => void onImport()}>
          Import .level.yaml / .level.json
        </button>
      </div>
      {examples.length > 0 && (
        <div class="row" data-testid="examples">
          <label>
            Examples:{" "}
            <select
              value={exampleId}
              onChange={(e) => setExampleId((e.target as HTMLSelectElement).value)}
              data-testid="examples-select"
            >
              {groups.map(({ g, items }) => (
                <optgroup key={g} label={EXAMPLE_GROUP_LABEL[g]}>
                  {items.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            class="bbtn"
            disabled={opening}
            onClick={() => void openExample()}
            data-testid="open-example"
          >
            Open as new draft
          </button>
          <span class="dim">A copy you can edit; the shipped level is not changed.</span>
        </div>
      )}
      <div class="row" data-testid="generate">
        <label>
          Generate:{" "}
          <select
            value={genDifficulty}
            onChange={(e) => setGenDifficulty((e.target as HTMLSelectElement).value as Difficulty)}
            data-testid="generate-difficulty"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          seed{" "}
          <input
            type="text"
            inputMode="numeric"
            placeholder="random"
            size={11}
            value={genSeed}
            onInput={(e) => setGenSeed((e.target as HTMLInputElement).value)}
            data-testid="generate-seed"
          />
        </label>
        <button
          class="bbtn"
          disabled={generating}
          onClick={() => void onGenerate()}
          data-testid="generate-draft"
        >
          {generating ? "Generating…" : "Generate draft"}
        </button>
        <span class="dim">A new solved draft from a procedural course.</span>
      </div>
      {message && (
        <p class="toast" role="status">
          {message}
        </p>
      )}

      <h2>Drafts</h2>
      {drafts.length === 0 ? (
        <p class="dim">No drafts yet.</p>
      ) : (
        <table class="bh-table" data-testid="drafts-table">
          <thead>
            <tr>
              <th>name</th>
              <th>grid</th>
              <th>modified</th>
              <th>solved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>
                  {d.gridW}×{d.gridH}
                </td>
                <td>{ago(d.modifiedAt)}</td>
                <td>{d.solved ? "✔" : "✘"}</td>
                <td class="actions">
                  <button
                    class="bbtn small"
                    onClick={() => navigate({ name: "builderDraft", draftId: d.id })}
                  >
                    Open
                  </button>
                  <button
                    class="bbtn small"
                    onClick={() => void duplicateDraft(d.id).then(refresh)}
                  >
                    Dup
                  </button>
                  <button
                    class="bbtn small danger"
                    onClick={() => void deleteDraft(d.id).then(refresh)}
                  >
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Custom levels (compiled, playable)</h2>
      {levels.length === 0 ? (
        <p class="dim">None yet. Export a solved draft as .level.json to add it here.</p>
      ) : (
        <table class="bh-table" data-testid="custom-table">
          <thead>
            <tr>
              <th>name</th>
              <th>par</th>
              <th>best</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => (
              <tr key={l.id}>
                <td>{l.level.name}</td>
                <td>{l.level.timing.par} s</td>
                <td>{l.bestTicks === null ? "—" : `${(l.bestTicks / TICK_HZ).toFixed(2)} s`}</td>
                <td class="actions">
                  <button
                    class="bbtn small"
                    onClick={() => navigate({ name: "playCustom", id: l.id })}
                  >
                    Play
                  </button>
                  <button class="bbtn small" onClick={() => void editCopy(l)}>
                    Edit copy
                  </button>
                  <button
                    class="bbtn small"
                    onClick={() =>
                      downloadText(
                        `${l.id}.level.json`,
                        `${JSON.stringify(l.level, null, 2)}\n`,
                        "application/json",
                      )
                    }
                  >
                    Export
                  </button>
                  <button
                    class="bbtn small danger"
                    onClick={() => void deleteCustomLevel(l.id).then(refresh)}
                  >
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
