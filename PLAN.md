# Marble Melancholy — Implementation Plan

**Title:** Marble Melancholy  **Slug:** `marble-melancholy`  **CLI binary:** `mmlevel`  **Level file extensions:** `*.level.yaml` (source), `*.level.json` (compiled canonical)

**Pitch.** Marble Melancholy is a browser remake, faithful in spirit, of the 1984 isometric trackball racer. You steer a glass marble with real momentum down a floating Escher-style course of ramps, chutes, funnels and gaps while a countdown bleeds away; falling off an edge shatters the marble and costs you the seconds it takes to respawn. Six original races of rising difficulty (Practice, Beginner, Intermediate, Aerial, Silly, Ultimate) introduce Steelies, Marble Munchers, acid, Hoovers, hammers, catapults, wave floors, moving platforms, pipes, speed strips and funnels. Two players race on one shared, scrolling screen. Every level — including the six shipped races — is produced by the built-in level builder, which has a visual in-browser editor and a headless CLI that accepts a hand-authorable YAML source, validates it, embeds a replayed solution proving it is beatable, and stamps the compiled file. The engine refuses to load anything that was not stamped by that builder. Everything is TypeScript, procedurally drawn and synthesized, statically deployable, with no backend and no external assets.

---

## 1. Title, slug, pitch

See above. In-game text, `package.json` `name`, repository name, IndexedDB database name and localStorage key prefix all use `marble-melancholy` / `Marble Melancholy`. The strings "Marble Madness" and "Atari" appear only in `README.md` as the inspiration credit and nowhere in `src/`, `levels/`, or `index.html`. A unit test enforces this (see §10, `tests/enforcement/no-trademarks.test.ts`).

---

## 2. Decision log

Every default chosen for this plan. The building agent appends to `DECISIONS.md` (same table format) whenever it makes a decision not covered here.

| # | Area | Decision | Rationale |
|---|------|----------|-----------|
| D01 | Language | TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true`, ESM only | Required; strictness catches determinism bugs early |
| D02 | Package manager / runtime | npm (lockfile committed), Node 20 LTS, `"engines": {"node": ">=20"}` | Prompt's `npm install && npm test && npm run build` contract |
| D03 | Build tool | Vite 5 with `@preact/preset-vite`; output to `dist/` with relative base (`base: "./"`) | Static deploy from any plain file server or sub-path |
| D04 | Rendering | Canvas 2D, single `<canvas>` for the world; isometric painter's algorithm with cached diagonal terrain strips | Procedural vector art is trivial in 2D; no shader/asset pipeline; deterministic look across browsers; 60 fps is achievable at 960×540 with strip caching. WebGL would add a texture/atlas pipeline for no gameplay gain |
| D05 | Physics | Custom fixed-timestep simulation at 120 Hz on a cell heightfield; no physics library | Determinism (replays, playability proofs) requires full control; the whole game is one sphere on a heightfield plus a few kinematic hazards |
| D06 | Deterministic math | `src/core/dmath.ts` provides `dsin`, `dcos`, `datan2` as polynomial approximations using only `+ - * /`; `Math.sqrt/floor/ceil/round/abs/min/max/trunc` allowed; `Math.sin/cos/tan/atan/atan2/exp/log/pow/hypot/cbrt/random` and `**` are banned in `src/sim/**` and `src/level/**` by ESLint | IEEE-754 guarantees identical results for `+ - * / sqrt` across engines; transcendental functions are not guaranteed identical |
| D07 | RNG | `mulberry32` (32-bit integer ops via `Math.imul`, `>>>`) seeded per race from the level id hash; render-only effects use a separate unseeded instance | Deterministic sim, free-running visuals |
| D08 | Audio | Web Audio API, everything synthesized at runtime (noise buffers, oscillators, biquad filters); a small step sequencer plays one procedural track per race | No audio assets, no IP risk, pitch-tied rolling noise is natural with a filter |
| D09 | UI framework | Preact 10 + `@preact/signals` for all DOM UI (menus, HUD, builder panels). Game world and builder viewport are canvases | 3 KB, declarative panels for the builder, fast to build; HUD as DOM keeps the canvas renderer simple |
| D10 | Routing | Hash routes handled by `src/app/router.ts` (no library): `#/`, `#/play`, `#/play/custom/:id`, `#/custom`, `#/scores`, `#/settings`, `#/builder`, `#/builder/:draftId` | Works from `file://` and any static host without rewrite rules |
| D11 | State management | Signals for UI state; the game is a finite state machine (`src/game/GameController.ts`) owning a `RaceSim`; a typed event bus (`src/core/events.ts`) connects sim → audio/UI | Minimal, explicit, testable |
| D12 | Level source format | YAML (`yaml` npm package, YAML 1.2 core schema) with ASCII block-scalar layers for heights/slopes/surfaces/walls and lists for entities | Hand-authorable by a coding agent from an ASCII sketch; readable diffs; block scalars make grid layers natural |
| D13 | Level canonical format | JSON `mm-level/1` with flat integer arrays, resolved entity defaults, embedded solution replay (RLE runs), and provenance stamp (`builder`, `version`, `sourceHash`, `contentHash` SHA-256) | Compact, parseable without the YAML dependency in the game bundle, hashable canonically |
| D14 | Terrain representation | Grid of cells; each cell: height in half-units (0–35, `-1` = void), slope type (flat/N/S/E/W gentle, n/s/e/w steep), surface (normal/ice/acid/speed N/E/S/W), wall bitmask per edge | Prompt default; simplest for GUI and agent; keeps physics deterministic and collision trivial. Deviations: none |
| D15 | Height steps act as walls/ledges | A step between adjacent cells is automatically a wall from the low side and a drop from the high side; explicit wall flags add rails on flat connections | Authoring with heights alone produces chutes and ledges for free |
| D16 | Solutions for headless authoring | Source `solution` is one of: `waypoints` (deterministic autopilot steers through cell waypoints), `script` (timed input segments), or `replay` (recorded in GUI test-play). The compiler always produces a per-tick input replay and embeds that | A coding agent cannot play; waypoints are authorable from the map; the embedded artifact is always a true input replay |
| D17 | Schema validation | `zod` schemas for source and compiled formats; `levels/schema/*.schema.json` generated from them by `npm run levels:schema` (via `zod-to-json-schema`) | One source of truth in TS; JSON Schema kept for human/agent reference |
| D18 | Hashing | `crypto.subtle.digest("SHA-256")` (available in Node 20 and all target browsers) over a canonical JSON serialization (sorted keys, no whitespace) | No dependency, same code in CLI and browser |
| D19 | Compiled levels are committed | `levels/compiled/**` is committed; CI recompiles and fails on diff (`git diff --exit-code levels/compiled`) | Game runs from a checkout; reproducibility is proven, not assumed |
| D20 | Enforcement | (a) `LevelLoader.load()` verifies stamp hash and builder version at runtime and throws otherwise; (b) `mmlevel check` validates every compiled file (schema + stamp + replay) in `npm test`; (c) ESLint `no-restricted-imports` forbids `*.json`/`*.yaml` imports outside `src/levels/manifest.ts`; (d) `tests/enforcement/*.test.ts` scan game source for level-shaped literals and non-`levels/compiled` glob imports | Structural, not advisory |
| D21 | Controls | Mouse via Pointer Lock (relative deltas → trackball velocity model), keyboard with 45° screen-to-world rotation (arrows/WASD P1, IJKL P2), gamepad left stick (radial deadzone 0.15), touch virtual stick; all produce a unit-disk world-space input vector per tick | Matches original trackball semantics: "push up on the screen → marble rolls up the screen" |
| D22 | Resolution | Logical 960×540 canvas, letterboxed to the window, backing store scaled by `min(devicePixelRatio, 2)`; `TILE_W=64, TILE_H=32, Z_PX=32` px per world unit at zoom 1.0 | 16:9 fits desktop and landscape phones; shows ~15×17 cells |
| D23 | Persistence | `localStorage` for settings and high scores (keys `marble-melancholy.settings.v1`, `marble-melancholy.highscores.v1`); IndexedDB `marble-melancholy` v1 (stores `levels`, `drafts`) for custom levels and builder drafts via a 120-line wrapper `src/storage/idb.ts` | Small sync data in localStorage; multi-100 KB levels in IDB |
| D24 | Browser targets | Latest 2 versions of Chrome, Firefox, Safari (Safari ≥ 17); desktop first, touch supported; no polyfills | Prompt requirement |
| D25 | Tests | Vitest (unit, level, enforcement; `environment: node`, `fake-indexeddb` for storage tests), Playwright (E2E, visual, perf, cross-browser determinism) | Standard, headless, agent-runnable |
| D26 | Lint/format | ESLint 9 flat config with `typescript-eslint`, `eslint-plugin-react-hooks` (Preact), custom restricted-properties rule for determinism; Prettier 3 (`printWidth: 100`, `semi: true`, `singleQuote: false`) | Conventional |
| D27 | CLI | `tools/levelc/cli.ts` run via `tsx`; `commander` for arg parsing; exposed as `npm run mmlevel -- <cmd>` and as `bin` `mmlevel` | One file-system-aware entry point around the pure `src/level` API |
| D28 | Fonts | System monospace, uppercase, letter-spacing 0.08em, 2 px drop shadow; no web fonts | No assets/accounts; arcade feel via CSS |
| D29 | Player colours | P1 marble cobalt blue `#2f6df6`, P2 marble amber `#f29a2e` | Distinct, colour-blind-safe pair |
| D30 | Scoring defaults | progress 500/race, goal per race (500…3000), 50 pts per remaining second, 2P first-home bonus 500 | Numbers tuned so a clean run of all six ≈ 20 000 pts |
| D31 | Time carry | `startTime(n) = min(99, level.timeLimit + remainingPrev + level.timeBonus)` where `timeBonus` is the finished level's bonus (default 5 s) | Prompt: remaining time plus a bonus carries |
| D32 | Trailing player (2P) | Camera zooms out to 0.6× to fit both; if still unfit, the trailing marble shatters and respawns at the respawn point with the highest index at or behind the leader | Deterministic, simple, keeps both players on screen |
| D33 | Core race names | 1 Practice "First Steps", 2 Beginner "The Long Drop", 3 Intermediate "Clockwork Terrace", 4 Aerial "Skyways", 5 Silly "Upside Downhill", 6 Ultimate "The Last Ledge" | Original names; tier labels echo the progression |
| D34 | Silly race mechanic | Level physics override `slopeGravityScale: -1` (marbles accelerate *up* slopes); airborne gravity unchanged | Implements "slope and gravity expectations inverted" with one scalar |
| D35 | Level sharing | Download/upload of `.level.json` (compiled) and `.level.yaml` (source); copy/paste of JSON via clipboard | Prompt minimum plus zero-cost clipboard |
| D36 | Level size limits | Grid 4–128 per side, ≤ 8192 non-void cells, ≤ 64 entities, time limit 5–99 s | Keeps rendering/BFS/replay sizes bounded |
| D37 | Test hooks | `?e2e=1` query enables `window.__mm` (typed test API: `skipIntro`, `setTimer`, `injectInput`, `perf`, `stateHash`) | Headless E2E without human play |

**Standing rule for the building agent.** When something is not covered by this plan: choose by priority order (1) fidelity to the original's feel, (2) simplicity, (3) polish; write one row in `DECISIONS.md` (`| ID | Area | Decision | Rationale |`); continue. Never stop to ask.

---

## 3. Architecture and stack

### 3.1 Dependencies

Runtime (`dependencies`):

| Package | Version | Use |
|---------|---------|-----|
| `preact` | ^10.22 | DOM UI |
| `@preact/signals` | ^1.3 | UI state |
| `yaml` | ^2.5 | Parse/serialize level source (builder import/export; CLI) |
| `zod` | ^3.23 | Schemas for source and compiled formats |

Dev (`devDependencies`): `typescript ^5.5`, `vite ^5.4`, `@preact/preset-vite ^2.9`, `vitest ^2.0`, `@playwright/test ^1.47`, `tsx ^4.19`, `commander ^12`, `eslint ^9`, `typescript-eslint ^8`, `eslint-plugin-react-hooks ^4.6`, `prettier ^3.3`, `zod-to-json-schema ^3.23`, `fake-indexeddb ^6`, `@types/node ^20`.

No other dependencies. No network access at runtime.

### 3.2 Layering

```
┌──────────────────────── DOM (Preact) ─────────────────────────┐
│ app/router → GameScreens (Title, HUD, Scores…) | BuilderApp   │
└──────────────┬───────────────────────────────┬────────────────┘
               │                               │
┌──────────────▼──────────┐      ┌─────────────▼────────────────┐
│ game/GameController     │      │ builder/editor (EditorState, │
│ FSM: title→race→over    │      │ tools, history, test-play)   │
└──────┬───────┬──────────┘      └──────┬──────────┬────────────┘
       │       │                        │          │
┌──────▼───┐ ┌─▼─────────┐   ┌──────────▼───┐ ┌────▼───────────┐
│ render/  │ │ audio/    │   │ level/       │ │ render/ (reuse)│
│ Renderer │ │ AudioEng. │   │ parse,valid.,│ └────────────────┘
└──────┬───┘ └───────────┘   │ compile,stamp│
       │                     └──────┬───────┘
┌──────▼─────────────────────────────▼──────────────────────────┐
│ sim/  RaceSim · Terrain · Marble · Entities · ReplayRunner    │  ← pure, deterministic, no DOM
└───────────────────────────────┬───────────────────────────────┘
                                │
                     core/ dmath · rng · hash · fixedStep · events
```

Rules:
- `src/sim/**` and `src/level/**` and `src/core/**` import nothing from `src/render`, `src/ui`, `src/audio`, `preact`, or the DOM. They run unchanged in Node (CLI, Vitest) and the browser.
- `tools/levelc` is the only code that writes to `levels/compiled/`.
- `src/levels/manifest.ts` is the only module that imports level JSON (via `import.meta.glob("/levels/compiled/**/*.level.json", { eager: true })`).

### 3.3 Frame loop

`src/core/fixedStep.ts` — `FixedStepper(stepHz = 120, maxStepsPerFrame = 8)`. `requestAnimationFrame` → accumulate `dt` (clamped to 0.25 s) → run `n` sim ticks → render with interpolation alpha. Input devices are polled once per tick (`InputManager.sample(player): InputFrame`). The sim never reads the clock.

### 3.4 Static deployability

`npm run build` emits `dist/` containing `index.html`, hashed assets, and inlined level JSON. Serving `dist/` with `npx serve dist` or `python3 -m http.server -d dist` works. Pointer Lock and IndexedDB need a secure or `localhost` origin in some browsers; `file://` works for everything except pointer lock in Safari, which falls back to absolute-mouse mode (§7.5).

---

## 4. Repository layout

```
marble-melancholy/
├── package.json                  # name, scripts (§4.1), deps, "bin": {"mmlevel": "tools/levelc/bin.mjs"}
├── package-lock.json
├── tsconfig.json                 # app + sim config (DOM + ES2022 libs, strict, bundler resolution)
├── tsconfig.node.json            # tools/ and vitest config (node types)
├── vite.config.ts                # preact preset, base "./", json import, define BUILD_VERSION
├── vitest.config.ts              # include tests/unit, tests/levels, tests/enforcement, tests/storage
├── playwright.config.ts          # projects chromium/firefox/webkit; webServer = vite preview on 4173
├── eslint.config.js              # flat config; determinism rule for src/sim, src/level, src/core
├── .prettierrc                   # printWidth 100
├── .editorconfig
├── .gitignore                    # node_modules, dist, playwright-report, test-results, coverage
├── index.html                    # single page; <div id="app">; <canvas id="world">
├── README.md                     # play, GUI builder, headless builder (agent) instructions, credits
├── PLAN.md                       # this document
├── DECISIONS.md                  # decision log continued by the building agent
├── LICENSE                       # MIT
├── .github/workflows/ci.yml      # lint, typecheck, levels:build + diff, test, build, e2e (3 browsers), perf
│
├── levels/
│   ├── src/
│   │   ├── core/
│   │   │   ├── 01-practice.level.yaml      # Race 1 "First Steps"
│   │   │   ├── 02-beginner.level.yaml      # Race 2 "The Long Drop"
│   │   │   ├── 03-intermediate.level.yaml  # Race 3 "Clockwork Terrace"
│   │   │   ├── 04-aerial.level.yaml        # Race 4 "Skyways"
│   │   │   ├── 05-silly.level.yaml         # Race 5 "Upside Downhill"
│   │   │   └── 06-ultimate.level.yaml      # Race 6 "The Last Ledge"
│   │   └── fixtures/                       # tiny builder-produced levels used by tests and smoke flows
│   │       ├── fx-flat.level.yaml          # 6×6 flat slab, start and goal; the "trivial level" (M3)
│   │       ├── fx-ramp-gap.level.yaml      # worked example in §5.6
│   │       ├── fx-walls.level.yaml         # wall bounce geometry
│   │       ├── fx-ice.level.yaml, fx-acid.level.yaml, fx-speed.level.yaml
│   │       ├── fx-steelie.level.yaml, fx-muncher.level.yaml, fx-hoover.level.yaml,
│   │       │   fx-hammer.level.yaml, fx-catapult.level.yaml, fx-wave.level.yaml,
│   │       │   fx-platform.level.yaml, fx-pipe.level.yaml, fx-funnel.level.yaml,
│   │       │   fx-checkpoint.level.yaml, fx-inverted.level.yaml   # one per entity/mechanic
│   │       └── invalid/                    # sources that must FAIL validation (one per rule E0xx)
│   │           ├── e002-row-width.level.yaml
│   │           ├── e008-unreachable.level.yaml
│   │           └── ...                     # one file per error code in §6.5
│   ├── compiled/
│   │   ├── core/*.level.json               # stamped canonical outputs of levels/src/core
│   │   ├── fixtures/*.level.json           # stamped outputs of levels/src/fixtures (not invalid/)
│   │   └── manifest.json                   # {"format":"mm-manifest/1","course":[ids in slot order],"fixtures":[ids]}
│   └── schema/
│       ├── level-source.schema.json        # generated by `npm run levels:schema`
│       └── level.schema.json               # generated
│
├── tools/
│   └── levelc/
│       ├── bin.mjs                         # #!/usr/bin/env node → tsx cli.ts
│       ├── cli.ts                          # commander program; wires commands
│       ├── commands/
│       │   ├── compile.ts                  # compile one or many sources → compiled
│       │   ├── validate.ts                 # validate sources (no compile)
│       │   ├── testplay.ts                 # run solution against a source/compiled, print result
│       │   ├── trace.ts                    # per-N-tick state dump of a solution run
│       │   ├── path.ts                     # ASCII heights map with marble path overlay
│       │   ├── check.ts                    # verify compiled files (schema, stamp, replay)
│       │   ├── buildAll.ts                 # compile levels/src/** → levels/compiled/**, write manifest
│       │   ├── info.ts                     # summary of a level (grid, entities, timing, stamp)
│       │   └── schema.ts                   # emit JSON schemas
│       ├── fs.ts                           # read/write helpers, glob of level files
│       └── format.ts                       # human + --json diagnostics formatting
│
├── src/
│   ├── main.tsx                            # mount <App/>; create canvas; start router
│   ├── env.d.ts                            # vite client types, import.meta.glob JSON typing
│   ├── version.ts                          # APP_VERSION from package.json (vite define)
│   ├── app/
│   │   ├── App.tsx                         # route switch: GameShell | BuilderApp
│   │   ├── router.ts                       # hash router: parse, navigate, subscribe
│   │   └── testApi.ts                      # window.__mm when ?e2e=1
│   ├── core/
│   │   ├── dmath.ts                        # dsin, dcos, datan2, clamp, lerp, len2, normalize (deterministic)
│   │   ├── rng.ts                          # mulberry32: Rng { next(): number; nextInt(n) ; state }
│   │   ├── hash.ts                         # canonicalJson(), sha256Hex(), fnv1a32()
│   │   ├── fixedStep.ts                    # FixedStepper
│   │   └── events.ts                       # typed EventBus<SimEvents>
│   ├── level/
│   │   ├── index.ts                        # public API (§6.4)
│   │   ├── version.ts                      # BUILDER_NAME="mmlevel", BUILDER_VERSION="1.0.0", SUPPORTED_VERSIONS
│   │   ├── types.ts                        # LevelSource, CompiledLevel, entity param types (§5)
│   │   ├── schema.ts                       # zod schemas: LevelSourceSchema, CompiledLevelSchema
│   │   ├── entities/specs.ts               # ENTITY_SPECS registry: params, defaults, ranges, footprint fn
│   │   ├── parse.ts                        # yaml text → LevelSource (+ layer char decoding)
│   │   ├── serialize.ts                    # LevelSource → yaml text (builder export)
│   │   ├── validate.ts                     # rules E001–E023, W101–W104 (§6.5)
│   │   ├── passability.ts                  # cell graph, BFS from goal → progress, reachability
│   │   ├── compile.ts                      # LevelSource → CompiledLevel (runs solver, stamps)
│   │   ├── stamp.ts                        # computeStamp(), verifyStamp()
│   │   ├── solution/
│   │   │   ├── replay.ts                   # Replay type, encodeRuns/decodeRuns, quantize
│   │   │   ├── autopilot.ts                # waypoint controller (deterministic)
│   │   │   ├── script.ts                   # timed input segments → per-tick inputs
│   │   │   └── solve.ts                    # solveSolution(level, spec) → Replay | failure trace
│   │   └── diagnostics.ts                  # Diagnostic type, codes table, formatting
│   ├── sim/
│   │   ├── constants.ts                    # all physics numbers (§7.2)
│   │   ├── types.ts                        # Vec3, MarbleState, InputFrame, SimEvent
│   │   ├── terrain.ts                      # Terrain: groundAt(), gradientAt(), edgeHeight(), walls
│   │   ├── marble.ts                       # integrate one marble: input, slope, friction, gravity, landing, death
│   │   ├── collision.ts                    # circle vs wall segments, marble vs marble/steelie
│   │   ├── entities/
│   │   │   ├── base.ts                     # SimEntity interface
│   │   │   ├── steelie.ts, muncher.ts, hoover.ts, hammer.ts, catapult.ts,
│   │   │   │   wave.ts, platform.ts, pipe.ts, funnel.ts, checkpoint.ts
│   │   │   └── factory.ts                  # CompiledEntity → SimEntity
│   │   ├── race.ts                         # RaceSim: players, timers, deaths, respawn, goal, scoring, events
│   │   ├── replayRunner.ts                 # runReplay(level, replay, opts) → ReplayResult
│   │   └── stateHash.ts                    # hashState(sim) → hex
│   ├── render/
│   │   ├── iso.ts                          # project(), unproject(), constants TILE_W/H, Z_PX
│   │   ├── camera.ts                       # Camera: follow rules 1P/2P, zoom, bounds
│   │   ├── themes.ts                       # Theme palettes keyed by ThemeId
│   │   ├── terrainStrips.ts                # pre-render diagonal strips to OffscreenCanvas/HTMLCanvas
│   │   ├── draw/
│   │   │   ├── cell.ts                     # top/side faces, slope shading, surface patterns, rails
│   │   │   ├── marble.ts                   # sphere, highlight, roll pattern, shadow
│   │   │   ├── entities.ts                 # one draw fn per entity type
│   │   │   ├── effects.ts                  # shatter shards, acid bubbles, dust, pipe swallow
│   │   │   └── background.ts               # per-theme gradient + drifting shapes
│   │   ├── particles.ts                    # render-only particle system (unseeded RNG)
│   │   └── Renderer.ts                     # frame composition, depth insertion, interpolation
│   ├── input/
│   │   ├── types.ts                        # Device, StickVector
│   │   ├── mapping.ts                      # screenToWorld(), isoRotate(), quantize
│   │   ├── keyboard.ts                     # KeyboardSource (per player bindings, ramp)
│   │   ├── mouse.ts                        # MouseSource (pointer lock, trackball model)
│   │   ├── gamepad.ts                      # GamepadSource
│   │   ├── touch.ts                        # TouchStickSource (virtual stick state)
│   │   └── InputManager.ts                 # assigns devices to players; sample(player) → InputFrame
│   ├── audio/
│   │   ├── AudioEngine.ts                  # context, buses, unlock, event subscriptions
│   │   ├── synth.ts                        # helpers: noiseBuffer(), env(), osc()
│   │   ├── sfx.ts                          # every SFX (§7.12)
│   │   └── music/
│   │       ├── sequencer.ts                # pattern scheduler (lookahead 0.2 s)
│   │       └── tracks.ts                   # six TrackDef (§7.12)
│   ├── game/
│   │   ├── GameController.ts               # FSM (§7.9), owns RaceSim, Renderer, Camera, Audio
│   │   ├── session.ts                      # GameSession: players, scores, carried time, race index
│   │   ├── scoring.ts                      # pure scoring helpers
│   │   ├── attract.ts                      # attract mode: cycles core replays
│   │   └── states.ts                       # state enum + transitions table
│   ├── ui/
│   │   ├── GameShell.tsx                   # mounts canvas overlay screens by game state
│   │   ├── components/
│   │   │   ├── PixelText.tsx, MenuList.tsx (keyboard/gamepad focus), Modal.tsx, Toggle.tsx, Slider.tsx
│   │   │   ├── TitleScreen.tsx, PlayerSelect.tsx, SettingsScreen.tsx, ControlsHelp.tsx
│   │   │   ├── RaceIntro.tsx, Hud.tsx, RaceComplete.tsx, GameOver.tsx, CourseComplete.tsx
│   │   │   ├── HighScoreEntry.tsx, HighScoreTable.tsx, CustomLevels.tsx, PauseMenu.tsx
│   │   │   └── VirtualStick.tsx, TouchButtons.tsx
│   │   └── styles.css                      # CSS variables, pixel aesthetic, letterbox
│   ├── builder/
│   │   ├── BuilderApp.tsx                  # builder route root: Home | Editor
│   │   ├── BuilderHome.tsx                 # drafts list, new, import
│   │   ├── editor/
│   │   │   ├── EditorState.ts              # signals: source, selection, tool, view, diagnostics
│   │   │   ├── history.ts                  # undo/redo stack of LevelSource snapshots (max 200)
│   │   │   ├── commands.ts                 # pure edits: setHeight, setSlope, setSurface, toggleWall, addEntity…
│   │   │   ├── tools/                      # one file per tool (§6.2)
│   │   │   ├── views/TopDownView.tsx       # 2D grid canvas (default edit view)
│   │   │   ├── views/IsoView.tsx           # reuses render/ for preview + test-play
│   │   │   ├── panels/Toolbar.tsx, LayersPanel.tsx, Inspector.tsx, EntityPalette.tsx,
│   │   │   │   ValidationPanel.tsx, LevelSettings.tsx, SolutionPanel.tsx, StatusBar.tsx
│   │   │   ├── testplay/TestPlay.ts        # live RaceSim with InputManager, records replay
│   │   │   └── io.ts                       # export/import (yaml/json), clipboard, download
│   │   └── shortcuts.ts                    # key bindings table
│   ├── storage/
│   │   ├── settings.ts                     # Settings type, defaults, load/save
│   │   ├── highscores.ts                   # HighScoreTable, insert, seed defaults
│   │   ├── idb.ts                          # openDb(), get/put/delete/list per store
│   │   └── levelsStore.ts                  # custom levels + drafts CRUD
│   └── levels/
│       ├── manifest.ts                     # import.meta.glob of compiled JSON; course order from manifest.json
│       └── loader.ts                       # LevelLoader.load(id|json) → verified CompiledLevel
│
└── tests/
    ├── unit/                               # Vitest; pure sim/core/render math
    ├── levels/                             # Vitest; parse/validate/compile/replay for fixtures and core
    ├── enforcement/                        # Vitest; provenance, freshness, no-inline-levels, no-trademarks
    ├── storage/                            # Vitest + fake-indexeddb
    ├── e2e/                                # Playwright specs (§10.5)
    ├── perf/                               # Playwright perf spec + Vitest sim benchmark
    └── helpers/                            # loadFixture(), makeSim(), fakeInput()
```

### 4.1 npm scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "prebuild": "npm run levels:check",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "test": "npm run levels:check && vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:perf": "playwright test tests/perf --project=chromium",
    "levels:build": "tsx tools/levelc/cli.ts build-all",
    "levels:check": "tsx tools/levelc/cli.ts check levels/compiled",
    "levels:schema": "tsx tools/levelc/cli.ts schema --out levels/schema",
    "mmlevel": "tsx tools/levelc/cli.ts"
  }
}
```

---

## 5. Level data model

### 5.1 Coordinate conventions

- World axes: `x` increases toward screen lower-right, `y` toward screen lower-left, `z` up. Cell `(cx, cy)` covers `[cx, cx+1) × [cy, cy+1)`. Cell centre is `(cx + 0.5, cy + 0.5)`.
- Progress through a race goes from small `x + y` (top of screen) to large `x + y` (bottom of screen).
- Heights are stored as integers in **half-units** (`hRaw`), elevation `z = hRaw × 0.5`. Range 0–35. Void = `-1` (source char `.`).
- A marble's `z` is the height of its contact point (bottom). It is grounded when `z == groundZ`.
- Entity positions `at: [x, y]` are integer cell coordinates; the entity sits at the cell centre unless stated.
- Rects `[x0, y0, x1, y1]` are inclusive cell ranges.

### 5.2 Layer character encodings

| Layer | Char | Meaning |
|-------|------|---------|
| `heights` | `.` | void (no cell) |
| | `0`–`9`, `A`–`Z` | `hRaw` 0–35 (A=10 … Z=35) |
| `slopes` | `.` | flat |
| | `N` `S` `E` `W` | gentle slope descending toward that direction; the cell drops 1 half-unit (0.5) across its length; `hRaw` is the height of the **high** edge |
| | `n` `s` `e` `w` | steep slope, drops 2 half-units (1.0) across the cell; `hRaw` is the high edge |
| `surfaces` | `.` | normal |
| | `i` | ice |
| | `a` | acid (lethal) |
| | `^` `v` `<` `>` | speed strip pushing N / S / W / E |
| `walls` | `.` or `0` | none |
| | `1`–`9`, `A`–`F` | hex bitmask: N=1, E=2, S=4, W=8 (e.g. `9` = N+W, `F` = all four) |

Every row must be exactly `grid.width` characters; there must be exactly `grid.height` rows; no spaces or tabs. Layers `slopes`, `surfaces`, `walls` are optional and default to all `.`.

Slope edge heights for a cell with `hRaw = h` (in half-units) and fraction `fx = x - cx`, `fy = y - cy`:

| Slope | `z(x,y)` |
|-------|----------|
| flat | `h/2` |
| `S` | `h/2 − 0.5·fy` |
| `N` | `h/2 − 0.5·(1−fy)` |
| `E` | `h/2 − 0.5·fx` |
| `W` | `h/2 − 0.5·(1−fx)` |
| `s n e w` | same with `1.0` instead of `0.5` |

Continuity rule the agent uses when authoring: a ramp descending south is written as consecutive rows `h, h−1, h−2 …` all tagged `S`; the flat cell after the last ramp row has `hRaw = lastRampH − 1`. For steep slopes decrement by 2.

### 5.3 Source format (`mm-level-source/1`) — TypeScript types

```ts
// src/level/types.ts
export type Cell = [x: number, y: number];
export type Rect = [x0: number, y0: number, x1: number, y1: number];
export type Vec3 = [dx: number, dy: number, dz: number];

export type ThemeId = "practice" | "descent" | "clockwork" | "skyways" | "topsy" | "lastledge";
export type MusicId =
  | "m1-first-steps" | "m2-long-drop" | "m3-clockwork" | "m4-skyways" | "m5-upside" | "m6-last-ledge";

export interface ThemeOverride {
  base: ThemeId;                 // palette to start from
  top?: string; sideLight?: string; sideDark?: string; rail?: string;
  bgTop?: string; bgBottom?: string; accent?: string;   // CSS hex colours "#rrggbb"
}

export interface LevelSource {
  format: "mm-level-source/1";
  id: string;                    // /^[a-z0-9][a-z0-9-]{1,47}$/
  name: string;                  // 1–24 chars, shown in HUD (uppercased)
  author?: string;               // ≤ 32 chars
  course?: { slot: number };     // 1..6 for core races; absent for custom/fixture
  theme: ThemeId | ThemeOverride;
  music: MusicId;
  seed?: number;                 // uint32; default fnv1a32(id)
  grid: { width: number; height: number };   // 4..128 each
  layers: {
    heights: string;             // block scalar
    slopes?: string;
    surfaces?: string;
    walls?: string;
  };
  start: { p1: Cell; p2: Cell };
  goal: { at: Cell; radius?: number };       // radius 0.5..2, default 0.8 (world units from cell centre)
  checkpoints?: CheckpointSource[];          // ordered; index = checkpoint order
  entities?: EntitySource[];                 // ≤ 64
  timing: { timeLimit: number; par: number; timeBonus?: number };  // seconds, ints; bonus default 5
  scoring?: { progress?: number; goal?: number; perSecond?: number; firstHome?: number };
  physics?: { slopeGravityScale?: number; frictionScale?: number; inputScale?: number };
  solution?: SolutionSource;
}

export interface CheckpointSource { at: Cell; radius?: number; respawnAt?: Cell }

export type EntitySource =
  | { type: "steelie"; at: Cell; mode?: "patrol" | "hunt"; path?: Cell[]; speed?: number; aggroRadius?: number }
  | { type: "muncher"; at: Cell; triggerRadius?: number; path?: Cell[]; speed?: number; digestTime?: number }
  | { type: "hoover"; at: Cell; pullRadius?: number; pullStrength?: number; killRadius?: number;
      onTime?: number; offTime?: number; phase?: number }
  | { type: "hammer"; at: Cell; period?: number; phase?: number }
  | { type: "catapult"; at: Cell; launch: Vec3; windup?: number }
  | { type: "wave"; rect: Rect; amplitude?: number; wavelength?: number; speed?: number; dir?: [number, number] }
  | { type: "platform"; at: Cell; size?: [w: number, h: number]; top: number; path: Cell[];
      speed?: number; pause?: number; phase?: number }
  | { type: "pipe"; entry: Cell; exit: Cell; exitVelocity?: Vec3; travelTime?: number }
  | { type: "funnel"; at: Cell; radius?: number; depth?: number; exit: Cell; exitVelocity?: Vec3; travelTime?: number };

export type SolutionSource =
  | { kind: "waypoints"; points: Waypoint[]; maxTicks?: number }
  | { kind: "script"; segments: ScriptSegment[] }
  | { kind: "replay"; runs: number[]; expectedTicks: number };   // recorded in GUI test-play

export interface Waypoint {
  at: Cell;            // target cell (centre)
  speed?: number;      // 0.1..1 fraction of INPUT_MAX_SPEED; default 0.8
  radius?: number;     // reached when within this distance; default 0.6
  hold?: number;       // after reaching: hold zero velocity relative to carrier for N ticks; default 0
}
export interface ScriptSegment { ticks: number; dir: [ax: number, ay: number] }  // world-space, |dir| ≤ 1
```

Entity parameter table (defaults, ranges, footprint used for overlap checks):

| Type | Param | Default | Range | Footprint |
|------|-------|---------|-------|-----------|
| steelie | `mode` | `patrol` | patrol/hunt | cell `at` (home) + every `path` cell |
| | `path` | `[at]` | 1–16 cells, each non-void | |
| | `speed` | 3.5 | 0.5–8 u/s | |
| | `aggroRadius` | 5 | 1–12 | |
| muncher | `triggerRadius` | 1.3 | 0.5–3 | `at` + `path` cells |
| | `path` | `[at]` | 1–16 cells | |
| | `speed` | 1.5 | 0–3 | |
| | `digestTime` | 1.5 | 0.5–4 s | |
| hoover | `pullRadius` | 3.0 | 1–6 | `at` |
| | `pullStrength` | 14 | 2–30 u/s² | |
| | `killRadius` | 0.4 | 0.2–0.8 | |
| | `onTime`/`offTime` | 0 / 0 (always on) | 0–10 s | |
| | `phase` | 0 | 0–10 s | |
| hammer | `period` | 2.4 | 1–6 s | `at` |
| | `phase` | 0 | 0–period | |
| catapult | `launch` | — (required) | `|dx,dy|` 1–14, `dz` 2–12 | `at` |
| | `windup` | 0.3 | 0.1–1 s | |
| wave | `amplitude` | 0.35 | 0.05–1.0 | none (region) |
| | `wavelength` | 3.5 | 1–10 | |
| | `speed` | 2 | 0–5 | |
| | `dir` | `[1,0]` | normalized at compile | |
| platform | `size` | `[2,2]` | 1–4 each | footprint cells at every path position must be void or ≥ 1.0 unit below `top` |
| | `top` | — (required) | hRaw 0–35 | |
| | `path` | — (required) | 2–8 cells (origin positions) | |
| | `speed` | 2 | 0.5–6 u/s | |
| | `pause` | 1 | 0–3 s | |
| | `phase` | 0 | 0–1 (fraction of full cycle) | |
| pipe | `exitVelocity` | `[0,2,0]` | each −12..12 | `entry`, `exit` |
| | `travelTime` | 1.2 | 0.3–4 s | |
| funnel | `radius` | 2.5 | 1–5 | all cells within `radius` of centre |
| | `depth` | 1.5 | 0.5–3 | |
| | `exitVelocity` | `[0,2,0]` | | `exit` |
| | `travelTime` | 1.0 | 0.3–4 s | |
| checkpoint | `radius` | 1.0 | 0.5–3 | none |
| | `respawnAt` | `at` | non-void, non-acid | |

Scoring defaults: `progress 500`, `goal 1000`, `perSecond 50`, `firstHome 500`. Physics overrides: `slopeGravityScale` −1..2 (default 1), `frictionScale` 0.25–3 (default 1), `inputScale` 0.5–1.5 (default 1).

### 5.4 Canonical compiled format (`mm-level/1`)

```ts
export interface CompiledLevel {
  format: "mm-level/1";
  id: string; name: string; author: string;          // author "" if absent
  course: { slot: number } | null;
  theme: ResolvedTheme;                              // all 7 colours resolved
  music: MusicId;
  seed: number;
  grid: { width: number; height: number };
  cells: {
    heights: number[];     // length W*H, row-major (i = y*W + x); -1 void, else hRaw
    slopes: number[];      // 0 flat,1 N,2 E,3 S,4 W,5 n,6 e,7 s,8 w
    surfaces: number[];    // 0 normal,1 ice,2 acid,3 speedN,4 speedE,5 speedS,6 speedW
    walls: number[];       // bitmask N=1 E=2 S=4 W=8
    progress: number[];    // 0..1000 BFS distance from goal normalised (1000 = at start), -1 unreachable
  };
  start: { p1: Cell; p2: Cell };
  goal: { at: Cell; radius: number };
  checkpoints: { at: Cell; radius: number; respawnAt: Cell }[];
  entities: CompiledEntity[];                        // every param resolved; `dir` normalised
  timing: { timeLimit: number; par: number; timeBonus: number };
  scoring: { progress: number; goal: number; perSecond: number; firstHome: number };
  physics: { slopeGravityScale: number; frictionScale: number; inputScale: number };
  bounds: { minSx: number; minSy: number; maxSx: number; maxSy: number };  // iso-projected extent at zoom 1
  solution: {
    runs: number[];        // flat triples [count, qx, qy, ...]; qx,qy ∈ −127..127 (÷127 = world input)
    ticks: number;         // tick index at which the goal was reached
    deaths: number;        // deaths during the solution run
    stateHash: string;     // hex FNV-1a of final sim state (§7.1)
  };
  stamp: {
    builder: "mmlevel";
    version: string;       // BUILDER_VERSION
    sourceHash: string;    // "sha256:<hex>" of LF-normalised source YAML text (GUI: of serialize(source))
    contentHash: string;   // "sha256:<hex>" of canonicalJson(level without `stamp`)
  };
}
export type CompiledEntity = Required-defaults variant of each EntitySource plus `index: number`.
```

`canonicalJson(v)`: recursively sort object keys, serialize with `JSON.stringify` (no whitespace), numbers as-is (all numbers in a compiled level are integers or finite decimals with ≤ 4 fractional digits; the compiler rounds floats to 4 decimals before serialization). Compiled files on disk are written as `JSON.stringify(level, null, 2) + "\n"` for readable diffs; the hash is over the canonical form, so formatting does not matter.

### 5.5 Solution replay semantics

- Tick 0 is the first simulation tick after "GO". Each triple `[count, qx, qy]` applies input `(qx/127, qy/127)` (world-space, already inside the unit disk) for `count` ticks.
- The replay is for player 1 only, starting at `start.p1`, with the race timer at `timing.timeLimit`.
- The run is valid when the goal is reached at tick `ticks` with `ticks < timeLimit × 120`. Deaths are allowed.
- `stateHash` is recomputed on every verification; mismatch is error `E020`-adjacent `E024 replay desync`.

### 5.6 Worked example — `levels/src/fixtures/fx-ramp-gap.level.yaml`

```yaml
format: mm-level-source/1
id: fx-ramp-gap
name: Ramp Gap
author: fixtures
theme: practice
music: m1-first-steps
grid: { width: 8, height: 14 }
layers:
  heights: |
    ........
    .888888.
    .888888.
    .888888.
    .777777.
    .666666.
    .555555.
    .444444.
    .444444.
    ........
    .222222.
    .222222.
    .222222.
    ........
  slopes: |
    ........
    ........
    ........
    .SSSSSS.
    .SSSSSS.
    .SSSSSS.
    .SSSSSS.
    ........
    ........
    ........
    ........
    ........
    ........
    ........
  walls: |
    ........
    .911113.
    .8....2.
    .8....2.
    .8....2.
    .8....2.
    .8....2.
    .8....2.
    .8....2.
    ........
    .8....2.
    .8....2.
    .C44446.
    ........
start: { p1: [3, 2], p2: [4, 2] }
goal: { at: [3, 11], radius: 0.8 }
timing: { timeLimit: 15, par: 6 }
solution:
  kind: waypoints
  points:
    - { at: [3, 4], speed: 1.0 }
    - { at: [3, 8], speed: 1.0, radius: 0.8 }
    - { at: [3, 11], speed: 0.6 }
```

Walls row `y=1` (`.911113.`): `9`=N+W at x=1, `1`=N for x=2..5, `3`=N+E at x=6. Row `y=12` (`.C44446.`): `C`=S+W, `4`=S, `6`=S+E.

Reading of the example: rows 1–3 are a flat 4.0-unit start slab; rows 3–6 are a gentle ramp (`8 S` → 4.0→3.5, `7 S` → 3.5→3.0, `6 S` → 3.0→2.5, `5 S` → 2.5→2.0); rows 7–8 are a 2.0-unit flat ledge ending at an open edge; row 9 is a one-cell void gap; rows 10–12 are a 1.0-unit flat goal slab. Side rails (`8` west, `2` east) line the whole course; the start row and the goal row are closed. A marble that leaves the ledge at ≥ 3.5 u/s clears the gap (it drops `12/v²` units crossing one cell: 0.98 at 3.5 u/s, landing at z ≈ 1.02 ≥ 1.0); slower marbles hit the far slab's side face and fall into the void.

Compiled output (`levels/compiled/fixtures/fx-ramp-gap.level.json`) contains: `cells.heights` = 112 integers (`-1` for `.`); `cells.slopes` with `3` (S) for the 24 ramp cells; `cells.surfaces` all `0`; `cells.walls` with 9/1/3/8/2/12/4/6 as decoded; `cells.progress` BFS values with the goal cell at `0`, start cell at `1000`, void `-1` — the gap is traversed by the "jump edge" rule in §6.5 (E008) because the far slab is ≥ 0.5 lower and the near edge is open; `start`, `goal{radius:0.8}`, empty `checkpoints` and `entities`; `timing {15,6,5}`; default `scoring` and `physics`; `bounds` from the 36 non-void cells; `solution.runs` produced by the autopilot (≈ 300–450 ticks ≈ 3 s), `solution.ticks`, `solution.deaths = 0`, `solution.stateHash`; and the `stamp`. The replay test must reach the goal before tick 1800.

---

## 6. Level builder specification

### 6.1 Principles

- One pipeline: `parse → validate → solve → compile → stamp`. GUI and CLI both call `compileLevel()` from `src/level/compile.ts`. The GUI never writes a compiled level by any other path; the CLI never writes except through `compileLevel()`'s return value.
- A compiled level without a passing solution cannot exist: `compileLevel()` throws `E018/E019` unless `opts.allowUnsolved` is set, and in that case the result has `stamp: null` and is typed `DraftCompiled`, which `LevelLoader` rejects and the CLI refuses to write under `levels/compiled/`. `allowUnsolved` is used only by the GUI for live preview.

### 6.2 GUI editor

Route `#/builder` → **Builder Home**; `#/builder/:draftId` → **Editor**.

**Builder Home** (DOM):

```
┌──────────────────────────────────────────────────────────┐
│ MARBLE MELANCHOLY · LEVEL BUILDER             [← Game]   │
├──────────────────────────────────────────────────────────┤
│ [ + New level ]  [ Import .level.yaml / .level.json ]    │
│                                                          │
│ DRAFTS                                                   │
│  name          grid    modified      solved  [Open][Dup][Del]│
│  My Chute      24×40   2 min ago     ✔                    │
│  Untitled 2    16×16   yesterday     ✘                    │
│                                                          │
│ CUSTOM LEVELS (compiled, playable)                       │
│  name          par   best   [Play][Edit copy][Export][Del]│
└──────────────────────────────────────────────────────────┘
```

"New level" creates a draft with a 16×24 grid, all void, default theme `practice`, music `m1-first-steps`, timing `{timeLimit: 30, par: 20}`, `start.p1 = [7,2]`, `start.p2 = [8,2]`, `goal.at = [7,21]`, and paints a 4-wide flat `hRaw=10` corridor from start to goal so the draft validates immediately.

**Editor layout** (DOM panels around a canvas viewport):

```
┌─ Toolbar ───────────────────────────────────────────────────────────────┐
│ [V Select][H Height][G Set H][S Slope][U Surface][W Wall][X Void]       │
│ [E Entity][1 P1][2 P2][O Goal][C Checkpoint][P Waypoint]  | [Tab View] │
│ [⟲ Undo][⟳ Redo] | [T Test-play][R Record][A Auto-solve][F7 Validate]   │
│ [Ctrl+S Save][Ctrl+E Export ▾][Ctrl+I Import]                [← Home]   │
├────────────┬─────────────────────────────────────────────┬──────────────┤
│ Layers     │                                             │ Inspector    │
│ ☑ heights  │                                             │ (selection   │
│ ☑ slopes   │          VIEWPORT (canvas)                  │  or level    │
│ ☑ surfaces │   top-down grid (default) / isometric       │  settings)   │
│ ☑ walls    │                                             │              │
│ ☑ entities │                                             │ Solution     │
│ ☑ waypoints│                                             │  kind, state │
│ Brush: 1 3 5│                                            │  [Auto-solve]│
│ Height: 10 │                                             │  [Record]    │
│ Slope: S   │                                             │  [Clear]     │
│ Surface: . │                                             │              │
├────────────┴─────────────────────────────────────────────┴──────────────┤
│ Validation: 0 errors, 2 warnings  [W103 par > 80% of time] …  | (12, 7) h=10 S  zoom 100% │
└─────────────────────────────────────────────────────────────────────────┘
```

**Views.** Top-down (default): each cell is a 24 px square (zoomable 8–64 px), filled by height (dark→light ramp from the theme), slope arrow glyph, surface pattern (ice = light hatch, acid = green dots, speed = chevrons), walls as 3 px edge lines, entities as icons with letters (S steelie, M muncher, H hoover, ⌂ hammer, ⇑ catapult, ~ wave region outline, ▭ platform footprint + path line, ◎ pipe entry/exit joined by dashed line, ◉ funnel radius circle, ✚ checkpoint radius, 1/2 starts, ★ goal). Isometric: the game `Renderer` drawing the compiled (draft) level with the same camera controls; used for preview and test-play. `Tab` toggles.

**Tools** (left click applies; right click applies the inverse where defined; drag paints):

| Key | Tool | Left click / drag | Right click | Modifiers |
|-----|------|-------------------|-------------|-----------|
| V | Select | select entity / cell; drag entity to move; drag selection rect | clear selection | Shift adds to selection; Delete removes selected entities |
| H | Height brush | raise by 1 half-unit (creates cell at current "Height" value if void) | lower by 1 (to −1 = void at 0 then right-click again) | `[`/`]` brush size 1/3/5; Shift = flatten to the value under the cursor at press |
| G | Set height | set `hRaw` to the "Height" field | set void | number keys edit the field; `Alt`+click samples |
| S | Slope brush | set slope to the selected direction | set flat | arrow keys pick N/E/S/W; Shift+arrow picks steep |
| U | Surface brush | paint selected surface | paint normal | `.`,`i`,`a` keys select; arrows select speed dir |
| W | Wall | toggle the wall on the cell edge nearest the pointer | remove | drag along edges to paint |
| X | Void | set void (height −1, clears other layers) | — | |
| E | Entity | place the palette entity at the cell; for path entities click successive path cells, Enter to finish | cancel | palette in Inspector |
| 1 / 2 | Start P1 / P2 | set start cell | — | |
| O | Goal | set goal cell | — | radius in Inspector |
| C | Checkpoint | add checkpoint at cell (appended) | — | respawnAt via Inspector |
| P | Waypoint | append solution waypoint at cell | remove last | Inspector edits speed/radius/hold |
| Tab | Toggle view | | | |
| T / F5 | Test-play | starts live play in iso view from P1 start | | Esc stops |
| R | Record solution | test-play with recording; on goal, prompt "Save as solution" | | |
| A | Auto-solve | run waypoint autopilot headlessly; show result and path overlay | | |
| F7 | Validate | run validator, list diagnostics; click a diagnostic to focus the cell | | |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | Undo / Redo | | | |
| Ctrl+S | Save draft to IndexedDB | | | autosave every 30 s and on blur |
| Ctrl+E | Export menu: `.level.json` (compiled, requires solved+valid), `.level.yaml` (source, always), Copy JSON, Copy YAML | | | |
| Ctrl+I | Import file | | | |
| Space+drag / middle drag | Pan | | | WASD also pans |
| `+` / `-` / wheel | Zoom | | | |
| Esc | Cancel tool action / stop test-play | | | |

**Undo/redo.** `history.ts` keeps `past: LevelSource[]`, `future: LevelSource[]` (structuredClone snapshots; max 200; brush drags coalesce into one entry on pointer-up). Every edit goes through `commands.ts` pure functions `(src: LevelSource, …) => LevelSource`.

**Inspector.** With no selection: level settings form (id, name, author, theme + overrides with colour inputs, music, grid resize with anchor top-left and confirmation, timing, scoring, physics overrides). With an entity selected: a form generated from `ENTITY_SPECS[type].params` (number inputs with min/max/step, cell pickers that highlight on hover, path editor list). Live validation errors render inline.

**Test-play.** `TestPlay.ts` compiles the draft with `allowUnsolved: true` (stamp null), constructs `RaceSim` with one player, uses the live `InputManager` (mouse/keyboard/gamepad/touch) and `FixedStepper`, renders in `IsoView` with HUD overlay (timer, deaths, tick). `R` mode records `InputFrame` per tick into `runs` and on `goalReached` offers Save; saving sets `source.solution = { kind: "replay", runs, expectedTicks }`. Death during recording continues (deaths allowed). Timer expiry ends test-play with "TIME OUT" (no save).

**Auto-solve.** Runs `solveSolution(draft, source.solution)` when kind is `waypoints` or `script` (synchronously, worker-free; ≤ 12 000 ticks takes < 200 ms); shows "GOAL at 23.4 s (par 20) — 1 death" or the failure trace (first waypoint not reached, position and tick of failure, death cause) and overlays the path in both views.

**Export of compiled level.** Runs `compileLevel(source)`; on success triggers download `${id}.level.json`; on failure focuses the Validation panel. The GUI also stores the compiled level in IndexedDB `levels` so it appears under Custom Races.

**Import.** Accepts `.level.yaml`, `.level.json`, `.yaml`, `.json`, or pasted text. JSON → `verifyCompiled()`; valid compiled levels go to IndexedDB `levels` (playable) and, if the user picks "Edit copy", a draft is reconstructed (`decompileToSource()` in `src/level/compile.ts` — lossless: layers re-encoded, entities re-emitted, `solution` set to `{kind:"replay", runs, expectedTicks}`). YAML → `parseSource()`; valid sources become drafts; if a solution is present and compiles, also stored to `levels`.

### 6.3 Headless CLI (`mmlevel`)

Invocation: `npm run mmlevel -- <command> [args]` or `npx mmlevel <command>` after `npm install`.

| Command | Arguments / flags | Behaviour | Exit |
|---------|-------------------|-----------|------|
| `compile <src...>` | `--out <dir>` (default `levels/compiled/<core|fixtures|custom>` mirroring `levels/src/`), `--json`, `--allow-unsolved` (writes nothing; prints draft diagnostics), `--quiet` | parse → validate → solve → compile → stamp → write `<id>.level.json` | 0 ok; 1 validation errors; 2 solution failed; 3 I/O or parse error |
| `validate <src...>` | `--json`, `--warnings-as-errors` | parse + validate only | 0 / 1 / 3 |
| `testplay <file>` | source or compiled; `--solution <yaml>` override; `--json` | runs the solution; prints `GOAL tick=… time=…s deaths=… par=… hash=…` or `FAIL reason=… at tick=… pos=(x,y,z) waypoint=i` | 0 reached; 2 failed; 3 I/O |
| `trace <file>` | `--every <n>` (default 30), `--from <tick>`, `--to <tick>`, `--json` | per-N-tick lines `t=0120 pos=(4.50,9.21,8.00) vel=(0.00,5.13,0.00) ground=1 cell=(4,9) surf=normal wp=1 ev=` and event lines for death/respawn/checkpoint/pipe/catapult/goal | as `testplay` |
| `path <file>` | `--layer heights|slopes|surfaces|walls` | prints the ASCII layer with the solution path overlaid: `*` visited cells, `x` death cells, `S` start, `G` goal | 0 / 2 / 3 |
| `check <dir|files...>` | `--json`, `--no-replay` (schema+stamp only) | verifies compiled files: schema, stamp (`version ∈ SUPPORTED`, `contentHash` recomputed), replay reaches goal in time, `stateHash` matches, `manifest.json` consistent with files | 0 ok; 4 stamp mismatch; 1 schema; 2 replay |
| `build-all` | `--src levels/src`, `--out levels/compiled`, `--json` | compiles every `levels/src/**/*.level.yaml` except `**/invalid/**`, writes `manifest.json` (course = sources with `course.slot`, sorted), deletes stale compiled files whose source no longer exists | 0 all ok; else highest error code encountered |
| `info <file>` | `--json` | prints id, name, grid, cell count, entities by type, timing, solution length, stamp | 0 / 3 |
| `schema` | `--out <dir>` | writes `level-source.schema.json`, `level.schema.json` | 0 / 3 |

Global flags: `--json` (machine-readable diagnostics, one JSON object per line), `--no-color`. All output to stdout; errors also summarised on stderr.

Human diagnostic format: `<file>:<row>:<col>: <severity> <CODE>: <message>` where row/col refer to the YAML line of the layer or 1-based cell `(x,y)` when the position is a cell: `levels/src/core/02-beginner.level.yaml: error E008: goal unreachable from start p1 (5,4); farthest reachable cell (13,17) progress 0.42`.

JSON diagnostic: `{"code":"E008","severity":"error","message":"…","file":"…","cell":[13,17],"entityIndex":null,"layer":null,"line":null}`.

### 6.4 Programmatic API (`src/level/index.ts`)

```ts
export function parseSource(yamlText: string): { ok: true; source: LevelSource } | { ok: false; diagnostics: Diagnostic[] };
export function serializeSource(source: LevelSource): string;            // YAML, layers as block scalars
export function validateSource(source: LevelSource): ValidationReport;  // { errors: Diagnostic[]; warnings: Diagnostic[] }
export function solveSolution(level: UnstampedLevel, spec: SolutionSource): SolveResult;
//   SolveResult = { ok: true; replay: Replay; ticks: number; deaths: number; stateHash: string; path: Cell[] }
//               | { ok: false; reason: "timeout"|"waypoint-unreached"|"script-ended"|"replay-ended"; tick: number; pos: Vec3; waypointIndex?: number; deaths: number; path: Cell[] }
export function compileLevel(source: LevelSource, opts?: { allowUnsolved?: boolean; sourceText?: string }): Promise<CompileResult>;
//   CompileResult = { ok: true; level: CompiledLevel } | { ok: true; draft: DraftCompiled } | { ok: false; diagnostics: Diagnostic[] }
export function verifyCompiled(json: unknown, opts?: { replay?: boolean }): Promise<VerifyReport>;
//   VerifyReport = { ok: boolean; level?: CompiledLevel; diagnostics: Diagnostic[] }
export function decompileToSource(level: CompiledLevel): LevelSource;
export function computeStamp(levelWithoutStamp: object, sourceText: string): Promise<Stamp>;
export function verifyStamp(level: CompiledLevel): Promise<{ ok: boolean; reason?: string }>;
export const BUILDER_NAME: "mmlevel"; export const BUILDER_VERSION: string; export const SUPPORTED_VERSIONS: string[];
```

`sourceHash` when compiling from the GUI uses `serializeSource(source)`; when compiling from the CLI uses the file text with CRLF→LF. Both forms are accepted by `verifyStamp` (only `contentHash` is recomputed; `sourceHash` is informational and used by the freshness test to detect stale compiled files: the test recompiles and compares `contentHash`).

### 6.5 Validation rules

Errors (compile blocked):

| Code | Rule |
|------|------|
| E001 | `grid.width`/`grid.height` not integers in 4..128, or non-void cells > 8192 |
| E002 | A layer has wrong row count or a row of wrong width |
| E003 | Invalid character in a layer (reports layer, row, col) |
| E004 | Slope, surface or wall set on a void cell |
| E005 | `start.p1` or `start.p2` void, acid, or inside a hazard footprint |
| E006 | `goal.at` void or acid; `goal.radius` out of range |
| E007 | A start cell equals the goal cell, or `p1 == p2` |
| E008 | Goal unreachable from `p1` or `p2` in the passability graph (below) |
| E009 | Entity cell(s) void where the entity needs ground (steelie, muncher, hoover, hammer, catapult, pipe entry/exit, funnel centre/exit, checkpoint, platform path cells must *not* be ground-conflicting per table) |
| E010 | Two entity footprints overlap (wave regions and checkpoints exempt; funnel area may contain nothing but acid surface) |
| E011 | Entity parameter out of range (reports param name and allowed range) |
| E012 | Unknown entity type or unknown parameter key |
| E013 | Pipe/funnel/catapult landing: pipe or funnel `exit` cell void; catapult predicted landing cell (ballistic, ignoring collisions) void |
| E014 | Checkpoint `respawnAt` void or acid |
| E015 | Timing: `timeLimit` not integer 5..99, `par` not integer 1..timeLimit−1, `timeBonus` not 0..30 |
| E016 | `id` fails regex, `name` not 1..24 chars, `author` > 32 chars |
| E017 | More than 64 entities or more than 16 checkpoints |
| E018 | No `solution` (compile without `--allow-unsolved`) |
| E019 | Solution fails: goal not reached before `timeLimit × 120` ticks (includes solver failure reason) |
| E020 | Compiled: stamp missing, `builder != "mmlevel"`, `version ∉ SUPPORTED_VERSIONS`, or `contentHash` mismatch |
| E021 | Unsupported `format` string |
| E022 | Physics override out of range |
| E023 | `course.slot` not 1..6, or two sources share a slot (build-all) |
| E024 | Compiled: replay `stateHash` mismatch on re-run (desync) |
| E025 | Theme override colour not `#rrggbb`, or unknown `theme`/`music` id |

Warnings (printed; compile proceeds):

| Code | Rule |
|------|------|
| W101 | Non-void cells unreachable from start (count and first cell) |
| W102 | Solution time > `par` |
| W103 | `par` > 0.8 × `timeLimit` |
| W104 | A slope cell's low edge meets a neighbour that is higher (uphill wall at ramp bottom) |
| W105 | Open edge with a drop ≥ 2.5 units adjacent to the solution path (fatal ledge) — informational |
| W106 | Entity never interacts: hoover/muncher whose radius does not touch any reachable cell |

**Passability graph (E008, progress).** Nodes: non-void cells. Directed edge from A to its 4-neighbour B when: no wall flag on the shared edge from either side; B not acid; and either (a) `edgeHeight(B, sharedEdge) ≤ edgeHeight(A, sharedEdge) + 0.001` and `edgeHeight(A) − edgeHeight(B) < 2.5` (level/downhill or a survivable drop), or (b) B is void and the cell C two steps away in the same direction is non-void with `edgeHeight(C) ≤ edgeHeight(A) − 0.5` and `edgeHeight(A) − edgeHeight(C) < 2.5` (a one-cell jumpable gap; edge A→C). Uphill edges with `slope != flat` on B are also passable when the climb across B is ≤ 0.5 (gentle slopes can be climbed with momentum; steep cannot). Teleport edges: pipe entry→exit, funnel cells→exit, catapult cell→predicted landing cell, platform: each path position's footprint cells are nodes connected to adjacent ground cells at matching height (±0.5), and all footprint cells across path positions are mutually connected. `progress[i] = round(1000 × dist(i) / dist(p1))` using BFS from the goal over reversed edges; unreachable `-1`.

### 6.6 Autopilot (`solution/autopilot.ts`)

Deterministic controller executed inside the sim loop at every tick, before `RaceSim.step()`:

```
wp = points[i]; target = (wp.at.x + 0.5, wp.at.y + 0.5)
if marble.dead or marble.inTransit (pipe/funnel/catapult): input = (0,0); continue
d = target − pos.xy; dist = |d|
if dist < wp.radius and holdLeft == 0: holdLeft = wp.hold; if hold == 0: i++ (if i == len → input (0,0) until goal)
if holdLeft > 0: desiredVel = carrierVel (platform velocity or 0); holdLeft--
else: desiredVel = (d/dist) × INPUT_MAX_SPEED × wp.speed × (isLast ? min(1, dist/1.5) : 1)
raw = (desiredVel − vel.xy) × 0.6
input = clampToUnitDisk(raw); q = quantizeInt8(input); input = q/127   // identical to replay decoding
record q into runs (RLE)
```

Failure: tick reaches `maxTicks` (default `timeLimit × 120`) → `timeout`; the marble dies 6 times without advancing `i` → `waypoint-unreached`. The solver returns the visited cell path for `path`/overlay.

Scripts: segments are concatenated; after the last segment the input is `(0,0)` until goal or timeout. Replays (GUI): decoded runs; after the runs end, input `(0,0)` for ≤ 240 more ticks, then `replay-ended`.

---

## 7. Game engine specification

### 7.1 Simulation core

- Fixed step `TICK_HZ = 120`, `DT = 1/120 s`. `RaceSim.step(inputs)` advances exactly one tick. Nothing in `src/sim` reads a clock, `Math.random`, or the DOM.
- Determinism contract: identical `(CompiledLevel, players, startTimeTicks, seed, input sequence)` → identical `hash()` on every tick in every target browser and Node. Enforced by `tests/unit/determinism.test.ts` (two runs in Node) and `tests/e2e/determinism.spec.ts` (each browser's hash equals the compiled `solution.stateHash`).
- RNG: `Rng` (mulberry32). Seed = `level.seed` XOR `players` count. Consumers: steelie `hunt` return-target selection. Every RNG draw happens in a fixed order inside `step()` (entities iterate in `entities[]` order).
- `stateHash()`: FNV-1a 32-bit over an int32 stream: `tick`, `rng.state`, then per player `[aliveFlag, round(x·4096), round(y·4096), round(z·4096), round(vx·4096), round(vy·4096), round(vz·4096), deaths, finishTick, score, timeTicks, activeCheckpoint]`, then each entity's `hashInto(h)` (its phase/position/state as ints). Result: 8 lowercase hex digits.
- `dmath.ts`: `dsin(x)` range-reduces `x` to `[−π, π]` using `Math.floor` and multiplication only, then evaluates the odd Taylor polynomial `x − x³/6 + x⁵/120 − x⁷/5040 + x⁹/362880 − x¹¹/39916800` (max error 5e-7 on `[−π, π]`); `dcos(x) = dsin(x + π/2)`; `datan2(y, x)` uses octant reduction and the polynomial `atan(t) ≈ t·(0.99997726 − 0.33262347t² + 0.19354346t⁴ − 0.11643287t⁶ + 0.05265332t⁸ − 0.01172120t¹⁰)` for `|t| ≤ 1`. These are the only trigonometric functions the sim may call; `tests/unit/dmath.test.ts` asserts each is within 1e-5 of `Math.*` on 10 000 sample points.

Types:

```ts
export interface InputFrame { ax: number; ay: number }      // world-space, |(ax,ay)| ≤ 1, quantized to 1/127
export interface MarbleState {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  grounded: boolean; fallStartZ: number; surface: SurfaceId; carrierVx: number; carrierVy: number;
  status: "alive" | "dying" | "waiting" | "transit" | "windup" | "finished" | "eliminated";
  statusTicks: number; deathCause: DeathCause | null; catapultFlight: boolean; inputLocked: boolean;
  rollPhase: number;
}
export type DeathCause = "fall" | "shatter" | "acid" | "munch" | "hammer" | "hoover" | "left-behind";
export interface PlayerState {
  index: 0 | 1; marble: MarbleState; timeTicks: number; score: number; progressBest: number;
  activeCheckpoint: number; deaths: number; finishTick: number; eliminated: boolean;
}
export type SimEvent =
  | { t: "clack"; player: number; impact: number }
  | { t: "land"; player: number; impact: number }
  | { t: "death"; player: number; cause: DeathCause; x: number; y: number; z: number }
  | { t: "respawn"; player: number }
  | { t: "checkpoint"; player: number; index: number }
  | { t: "goal"; player: number; tick: number; first: boolean }
  | { t: "timeout"; player: number }
  | { t: "pipeEnter" | "pipeExit" | "funnelEnter" | "catapult" | "speedStrip"; player: number }
  | { t: "hammerDown"; entity: number } | { t: "munchLunge"; entity: number } | { t: "steelieRam"; player: number };
```

### 7.2 Marble physics constants (`src/sim/constants.ts`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `MARBLE_RADIUS` | 0.35 cells | collision and draw radius |
| `MARBLE_MASS` / `STEELIE_MASS` | 1 / 3 | collision impulses |
| `GRAVITY` | 24 u/s² | airborne acceleration and slope factor |
| `INPUT_ACCEL` | 18 u/s² | at full stick |
| `INPUT_MAX_SPEED` | 7 u/s | input adds no acceleration along the stick when the velocity component along the stick ≥ this |
| `AIR_INPUT_AUTHORITY` | 0.25 | input multiplier while airborne |
| `MAX_SPEED` | 14 u/s | hard cap on horizontal speed |
| `ROLL_FRICTION` | normal 4.0, ice 0.5, speed 2.0, acid 4.0 u/s² | constant deceleration while grounded |
| `LINEAR_DRAG` | 0.15 /s | `v *= 1 − 0.15·DT` while grounded |
| `SLOPE_ACCEL` | `−GRAVITY · ∇z · slopeGravityScale` | gentle slope ∇z = 0.5 → 12 u/s²; steep → 24 u/s² |
| `SPEED_STRIP_ACCEL` / `SPEED_STRIP_MAX` | 30 u/s² / 12 u/s | along the strip direction; no acceleration beyond max along that direction |
| `WALL_RESTITUTION` | 0.5 | normal velocity scale on wall bounce |
| `MARBLE_RESTITUTION` / `STEELIE_RESTITUTION` | 0.8 / 0.9 | sphere–sphere |
| `WALL_STEP_THRESHOLD` | 0.15 u | neighbour top higher than marble `z` by more → wall |
| `FALL_START_THRESHOLD` | 0.05 u | ground lower than `z` by more → airborne |
| `SHATTER_FALL_HEIGHT` | 2.5 u | landing after a fall of at least this → shatter |
| `BOUNCE_MIN_VZ` / `LAND_RESTITUTION` | 1.5 u/s / 0.3 | landing bounce |
| `KILL_PLANE` | `minLevelZ − 4` | below → death (`fall`) |
| `CLACK_MIN_IMPACT` | 1.5 u/s | emit clack above this |
| `DEATH_ANIM_TICKS` | shatter/fall 84 (0.7 s), acid 72, munch 96, hammer 60, hoover 60, left-behind 84 | status `dying` |
| `RESPAWN_DELAY_TICKS` | 120 (1.0 s) | status `waiting` |
| `RESPAWN_DROP` | 1.0 u | respawn height above ground |
| `GOAL_SETTLE_TICKS` | 180 | finished marble rolls out with friction, input locked |
| `COUNTDOWN_TICKS` | 360 (3 s) | before GO; input locked, timer frozen |
| `FINISH_WINDOW_TICKS` | 600 (5 s) | 2P window after first finish |
| `PROGRESS_SAMPLE` | every tick while grounded | progress high-water mark |

### 7.3 Terrain queries (`src/sim/terrain.ts`)

```ts
interface Ground { z: number; surface: SurfaceId; cx: number; cy: number; carrier: PlatformEntity | null; gradX: number; gradY: number }
class Terrain {
  constructor(level: CompiledLevel, entities: SimEntity[]);
  groundAt(x: number, y: number, tick: number): Ground | null;   // null = void
  edgeHeight(cx: number, cy: number, edge: 0|1|2|3, t: number, tick: number): number | null; // height along an edge, t∈[0,1]
  isWall(cx: number, cy: number, edge: 0|1|2|3): boolean;         // explicit flag on either side
}
```

`groundAt` evaluation order: (1) if `(x,y)` lies within any platform footprint at `tick` and the platform top ≥ base ground (or base is void) → `{z: top, surface: normal, carrier: platform}`; (2) else base cell by slope formula (§5.2); (3) add funnel offset `−depth · (1 − d/radius)` for `d < radius` (gradient radial `depth/radius` toward centre); (4) add wave offset `A · dsin(2π · (dot(dir, (x,y)) − speed · t) / λ)` with `t = tick · DT` (gradient `A · (2π/λ) · dcos(...) · dir`); (5) `gradX/gradY` = slope gradient + funnel + wave.

### 7.4 Per-tick update order (`RaceSim.step`)

1. Advance `tick`; for each alive-and-racing player decrement `timeTicks` (not during countdown, not when `finished`); `timeTicks == 0` → `eliminated`, emit `timeout`.
2. Entities `update(tick)` in index order (kinematic motion: platforms, steelies, munchers, hammers, hoovers cycle).
3. For each player with `status == "alive"`:
   a. Resolve input `(ax, ay)`; if `inputLocked` → `(0,0)`; `authority = grounded ? 1 : AIR_INPUT_AUTHORITY`.
   b. Accelerations: `a = (ax, ay) · INPUT_ACCEL · inputScale · authority` with the along-stick cap; if grounded add `SLOPE_ACCEL` from `gradX/gradY`, speed strip force, and friction (`ROLL_FRICTION[surface] · frictionScale` opposing velocity, zeroing velocity when `|v| < decel·DT`, then drag). Add hoover pull (grounded or not).
   c. `v += a·DT`; clamp `|v_xy| ≤ MAX_SPEED`.
   d. `x += (vx + carrierVx)·DT; y += (vy + carrierVy)·DT`.
   e. Wall collision (§7.5) — up to 2 passes.
   f. Vertical: `g = groundAt(x,y)`. If grounded: if `g == null` or `g.z < z − FALL_START_THRESHOLD` → `grounded=false; fallStartZ = z; vz = 0`; else `z = g.z`. If airborne: `vz −= GRAVITY·DT; z += vz·DT`; if `g != null && z ≤ g.z && vz ≤ 0` → landing: `fall = fallStartZ − g.z`; if `fall ≥ SHATTER_FALL_HEIGHT && !catapultFlight && !respawnDrop` → `die("shatter")`; else `z = g.z`; if `−vz > BOUNCE_MIN_VZ` → `vz = −vz · LAND_RESTITUTION; fallStartZ = z` (stays airborne) else `vz = 0; grounded = true; catapultFlight = false; respawnDrop = false; inputLocked = false (if it was a respawn drop)`; emit `land` with `impact = |vz_before|`. If `z < KILL_PLANE` → `die("fall")`.
   g. Surface: if grounded and `surface == acid` → `die("acid")`; speed strip → emit `speedStrip` once per strip entry.
   h. Progress: if grounded and `progress[cell] ≥ 0` → `progressBest = max(progressBest, 1000 − progress[cell])`; `score += Δ · scoring.progress / 1000` (integer rounding on the cumulative value).
   i. Carrier: `carrierVx/Vy = g?.carrier?.velocity ?? 0`.
4. Entity interactions `interact(player)` in index order (steelie impulse, muncher trigger/swallow, hoover kill, hammer kill/wall, catapult windup, pipe/funnel entry, checkpoint, goal).
5. Marble–marble collision (2P): if `dist < 2R` → separate by inverse mass, impulse along normal with `MARBLE_RESTITUTION` if approaching, emit `clack`.
6. Status timers: `dying` → after `DEATH_ANIM_TICKS[cause]` → `waiting`; `waiting` → after `RESPAWN_DELAY_TICKS` → respawn (§7.8). `transit` (pipe/funnel) → after `travelTime` ticks → placed at exit with `exitVelocity`, `fallStartZ = z`, `grounded = dz ≤ 0`. `windup` → after `windup` ticks → `v = launch`, `grounded=false`, `catapultFlight = true`, emit `catapult`. `finished` → after `GOAL_SETTLE_TICKS` → frozen.
7. 2P finish window and left-behind rule (§7.9).
8. `rollPhase += |v_xy|·DT / MARBLE_RADIUS` (render only, but kept in sim for interpolation; excluded from the hash).

### 7.5 Collision (`src/sim/collision.ts`)

**Wall segments.** For a marble at cell `(cx, cy)` consider all cell edges within the 3×3 block around it. An edge between cell `A` (marble side — the cell whose interior contains the marble's centre or is nearer) and `B` is a wall when any of: (`isWall(A, edge)` or `isWall(B, oppositeEdge)`) and `z < edgeHeight(A, edge, t*) + RAIL_HEIGHT` where `RAIL_HEIGHT = 0.3` (explicit rails are 0.3 units tall, so airborne marbles clear them); `B` non-void and `edgeHeight(B, oppositeEdge, t*) > z + WALL_STEP_THRESHOLD` where `t*` is the parameter of the closest point on the edge (height steps are full-height walls below their top); `B` is a platform footprint edge and `platform.top > z + WALL_STEP_THRESHOLD`; `B` is a hammer footprint and the hammer is down and `z < groundZ + 2.0`. Void `B` is never a wall. Each wall is a segment with endpoints at the cell corners; circle–segment test: `closest = clamp projection; d = |c − closest|; if d < R → push c out along n = (c − closest)/d by (R − d); if dot(v, n) < 0 → v −= (1 + WALL_RESTITUTION)·dot(v,n)·n; emit clack with impact = |dot(v_before, n)| if ≥ CLACK_MIN_IMPACT`. Two passes per tick to settle corners.

**Marble vs sphere entity (steelie).** Masses `m1=1, m2=3`. Relative normal velocity `vn`; if approaching: `j = −(1 + e)·vn / (1/m1 + 1/m2)`; marble `v += j/m1 · n`; steelie `v −= j/m2 · n` (hunt mode only; patrol steelies are kinematic and ignore the impulse). Separate overlap by inverse-mass ratio. Emit `steelieRam`.

### 7.6 Input mapping (`src/input/`)

Screen stick `(sx, sy)` (right +, down +, inside the unit disk) → world input:

```
wx = (sx + sy) / √2
wy = (sy − sx) / √2
```

(Screen up `(0,−1)` → world `(−0.707, −0.707)`, which projects straight up; screen right `(1,0)` → world `(0.707, −0.707)`, which projects straight right.) The result is quantized to int8/127 before it enters the sim so live play and replays use the same values.

| Device | Source | Rules |
|--------|--------|-------|
| Keyboard | P1: Arrow keys; P2: `I J K L` (setting: P2 on `W A S D` instead, swapping P1 to arrows only). Numpad 1–9 give the eight screen directions for P1. | Pressed keys form a screen direction (normalized when diagonal). Magnitude ramps `+DT/0.12` while any key is held (cap 1) and decays `−DT/0.08` when none, so taps give small nudges. Setting `keyboardMapping: "screen" (default) | "world"` — in `world` mode arrows map directly to `±x/±y` without rotation. |
| Mouse | Pointer Lock on canvas click (P1 only). Sum `movementX/Y` between ticks → `(dx, dy)` px. | Trackball model: `raw = (dx, dy) · 0.12 · sensitivity` (sensitivity setting 0.5–2.0, default 1.0); `stick = 0.55·stick + 0.45·raw`; clamp to unit disk; zero below 0.02. Esc releases the lock (pauses). **Fallback (no pointer lock available or denied):** absolute mode — `stick = (cursor − canvasCentre) / 160 px` clamped; shown as a faint ring HUD. |
| Gamepad | Pad 0 → P1, pad 1 → P2; left stick axes 0/1; in 1P any pad drives P1. | Radial deadzone 0.15 rescaled to 0..1 linear; clamp to disk. Buttons: 0 confirm, 1 back, 9 pause, 8 select (toggle HUD help). Polled each tick via `navigator.getGamepads()`. |
| Touch | P1 only. Floating virtual stick: touch-start anywhere in the left 60 % of the canvas sets the origin; radius 60 CSS px, dead zone 8 px. | `stick = offset / 60` clamped. Right 40 %: tap = pause. Visible stick drawn as DOM overlay (`VirtualStick.tsx`). |

`InputManager.sample(player): InputFrame` merges all devices assigned to the player by taking the vector with the largest magnitude. In 2P, the mouse and touch are P1-only; keyboard and pads are assigned as above and are swappable in Settings.

### 7.7 Isometric projection and camera (`src/render/iso.ts`, `camera.ts`)

```
TILE_W = 64; TILE_H = 32; Z_PX = 32
project(x, y, z)   = { sx: (x − y) · 32, sy: (x + y) · 16 − z · 32 }
unproject(sx, sy, z=0) = { x: (sx/32 + (sy + z·32)/16) / 2, y: ((sy + z·32)/16 − sx/32) / 2 }
toScreen(p, cam)   = { X: (p.sx − cam.cx) · cam.zoom + 480, Y: (p.sy − cam.cy) · cam.zoom + 270 }
```

A half-unit height step is 16 px. Marble draw radius `0.35 · 36 = 12.6 px` at zoom 1. The compiled `bounds` are the min/max of `project()` over all non-void cell corners (top faces) and over side faces extended 2.5 units down.

Camera (render-side, updated per frame with real `dt`, never read by the sim):

- **1P.** `target = project(marbleRenderPos) + clamp(project(vx, vy, 0) · 0.25, 120 px)`; `cam += (target − cam) · (1 − e^(−dt/0.15))`; zoom 1.0. Clamp so the viewport stays inside `bounds` expanded by 96 px; when the level is smaller than the viewport on an axis, centre it on that axis. While a marble is `dying`/`waiting` the camera holds the death position; on `respawn` the time constant is 0.3 s until within 40 px of the target.
- **2P.** Framing set = alive/finished marbles (dead ones ignored). `reqW = |p1.sx − p2.sx| + 320`, `reqH = |p1.sy − p2.sy| + 240`; `zoomTarget = clamp(min(960/reqW, 540/reqH), 0.6, 1.0)`; `target` = midpoint; same smoothing for position and zoom. If `min(960/reqW, 540/reqH) < 0.6` for 30 consecutive frames the game calls `sim.leaveBehind(trailingPlayer)` (§7.9) — this is the one render→sim call, and it is made through the same input/command queue as player input so it is recorded in the tick stream (it never happens in 1P replays).

### 7.8 Death and respawn

`die(cause)`: `status = dying`, `statusTicks = DEATH_ANIM_TICKS[cause]`, `deaths++`, emit `death`, velocity zeroed, marble hidden for `acid`/`munch`/`hoover` after the animation. After `waiting` (120 ticks): respawn at `respawnAt` of `checkpoints[activeCheckpoint]` (or `start.pN` when `activeCheckpoint == −1`), `z = ground + RESPAWN_DROP`, `v = 0`, `grounded = false`, `fallStartZ = z`, `respawnDrop = true`, `inputLocked = true` until landing. Total penalty ≈ 1.7 s + 0.3 s drop. The timer keeps running throughout. Steelies and munchers within 1.0 cell of the respawn point are pushed 1.0 cell away along their path direction at respawn (prevents spawn-camping).

### 7.9 Race flow, scoring, two players

Game FSM (`src/game/states.ts`):

```
boot → title ⇄ attract
title → playerSelect → raceIntro → countdown → racing → raceComplete → (raceIntro | courseComplete)
racing → gameOver (all players eliminated)
courseComplete | gameOver → highScoreEntry (per qualifying player, P1 first) → highScoreTable → title
racing ⇄ paused ; title → settings | scores | custom | builder(route change)
custom → raceIntro(custom level) → … → raceComplete → custom
```

| Phase | Duration | Behaviour |
|-------|----------|-----------|
| raceIntro | 2.0 s | DOM card: race number, name, `TIME NN`, hazard icons introduced; sim constructed; camera snapped to start |
| countdown | 360 ticks | "3 · 2 · 1 · GO" beeps; input locked; timers frozen |
| racing | until end | per-player timer; `ceil(timeTicks/120)` displayed; flashes red and ticks each second when ≤ 10 s |
| goal | per player | `finished`; `score += scoring.goal + ceil(timeTicks/120) · scoring.perSecond (+ scoring.firstHome for the first finisher in 2P)`; fanfare; marble rolls out with input locked |
| raceComplete | 3.0 s | card: time left, bonuses, scores. 1P enters it 1.5 s after goal; 2P when both finished/eliminated or the finish window closed |
| next race | — | `startTimeTicks[p] = min(99·120, next.timeLimit·120 + timeTicksRemaining[p] + finished[p] ? timeBonus·120 : 0)` |
| timeout | — | `eliminated`; marble fades over 0.5 s; "TIME OUT" label; 1P → gameOver after 2 s; 2P: the other continues, the eliminated player sits out all later races |
| courseComplete | 4.0 s | after Race 6: "COURSE COMPLETE", total score(s) |
| gameOver | 2.5 s | "GAME OVER", scores |
| highScoreEntry | until confirmed | if score > 10th entry of the table (1P and 2P share one table; each player is a separate row); 3 initials |
| highScoreTable | 8 s or key | table; returns to title |
| paused | — | sim and timers frozen; menu: Resume, Restart race (custom mode only), Settings, Quit |

Scoring summary per player: progress (high-water, `scoring.progress` total per race), goal, per-second time bonus, 2P first-home bonus. No penalty for deaths. Scores are integers; display with thousands separators.

Two-player specifics:
- Both marbles share one sim, one camera (§7.7). Marble–marble collisions are on.
- Finish window: when the first player finishes, a 600-tick window starts (HUD shows `FINISH IN 5`). A second finish inside the window scores goal + time bonus without `firstHome`. When the window closes, the unfinished player keeps `timeTicksRemaining` (no `timeBonus`) and carries it to the next race.
- Left-behind rule: `leaveBehind(p)` kills `p` with cause `left-behind` and sets `activeCheckpoint[p]` to the largest checkpoint index `i` such that `progress[checkpoints[i].at] ≥ progress[leaderCell]` (i.e. not ahead of the leader), or `−1`. Respawn proceeds normally.
- In 2P, if one player is `eliminated` by timeout, the race continues 1P-style for the other.

Custom level mode: one race; `raceComplete` shows `TIME vs PAR` and stores `bestTicks` per level id in IndexedDB; returns to the Custom Races list; no high-score table entry.

### 7.10 Entities and hazards

All entities implement:

```ts
interface SimEntity {
  readonly index: number; readonly type: EntityType;
  update(sim: RaceSim): void;                 // kinematics, phase
  interact(sim: RaceSim, p: PlayerState): void;
  groundPatch?(x: number, y: number, tick: number): Ground | null;   // platforms
  wallSegments?(x: number, y: number, z: number): Segment[];          // platforms, hammer when down
  hashInto(h: Fnv): void;
  snapshot(): EntitySnapshot;                 // for the renderer
}
```

| Entity | Behaviour and numbers |
|--------|----------------------|
| **Steelie** | Sphere radius 0.35, mass 3, drawn black. `patrol`: moves along `path` (ping-pong) at `speed`, `z = ground`; kinematic (unaffected by impacts). `hunt`: if an alive marble is within `aggroRadius` → accelerate toward it at 12 u/s² up to `speed`; otherwise accelerate toward the current return target (home or a random `path` cell chosen with the sim RNG when the previous target is reached) at 12 u/s²; impacts reduce its velocity by the impulse. Both modes: before moving, if the next position's ground is void, lower by > 1.0 or higher by > 0.15 → velocity set to 0 (never falls, never climbs walls). Collision with marbles per §7.5 (`STEELIE_RESTITUTION`). |
| **Marble Muncher** | Body at `at` (or along `path` at `speed` while idle, ping-pong). States: `idle` → marble within `triggerRadius` → `lunge` (head moves toward the marble at 6 u/s for ≤ 36 ticks, max reach 1.5) → if marble centre within 0.45 of the head → `swallow` (marble `die("munch")`, muncher `digest` for `digestTime`) → `idle`; a lunge that catches nothing → `retract` 48 ticks → `idle`. While `digest`/`retract` it does not trigger. |
| **Hoover** | Ground entity at `at`; nozzle at cell centre, 0.3 above ground. Active when `onTime == 0` (always) or `((t + phase) mod (onTime + offTime)) < onTime`. While active, every marble (grounded or airborne) within `pullRadius` gets acceleration `pullStrength · (1 − d/pullRadius)` toward the nozzle; a marble within `killRadius` → `die("hoover")`. |
| **Hammer** | Cycle of `period` s with `phase` offset: `up` for `period − 0.8`, `drop` 0.15, `down` 0.40, `lift` 0.25. Head footprint = the 1×1 cell at `at`, head rest height 2.0 above ground when up. At the `drop → down` transition any marble whose centre is inside the footprint → `die("hammer")`, emit `hammerDown`. While `down` the footprint's four edges are wall segments. |
| **Catapult** | Pad = cell `at`. A grounded marble whose centre comes within 0.4 of the pad centre and is not `finished` → `status = windup` for `windup` s (held at the pad centre), then `v = launch` (world u/s), `grounded = false`, `catapultFlight = true` (shatter check suppressed until the next landing). Emit `catapult`. One marble per windup; the other player passes freely while a windup is in progress. |
| **Wave floor** | Region `rect`. Height offset `A · dsin(2π · (dot(dir, (x,y)) − speed·t) / λ)` added to the base ground (§7.3); its gradient adds to slope acceleration. Purely terrain-modifying; no kill. |
| **Moving platform** | Slab `size` cells, top `top/2` units, thickness 0.5. Follows `path` (origin cell positions) at `speed`, pausing `pause` s at each node, ping-pong; `phase` offsets the cycle start. `groundPatch` returns its top for points in the footprint; its velocity is the marble's carrier velocity; side faces are wall segments for marbles below the top. |
| **Pipe** | `entry` cell: a grounded marble within 0.3 of the centre → `status = transit`, hidden, `statusTicks = travelTime·120`; emit `pipeEnter`. On exit: placed at `exit` centre, `z = ground + 0.1`, `v = exitVelocity`, `fallStartZ = z`; emit `pipeExit`. |
| **Funnel** | Cone terrain modification (§7.3) within `radius`; the centre hole (within 0.3 of centre) behaves like a pipe entry to `exit` with `travelTime`; emit `funnelEnter`. |
| **Speed strip** | Surface. Grounded marble: `a += SPEED_STRIP_ACCEL · dir` unless `dot(v, dir) ≥ SPEED_STRIP_MAX`; friction uses the `speed` value. |
| **Acid** | Surface. Grounded marble centre over an acid cell → `die("acid")`. |
| **Ice** | Surface. Friction 0.5. |
| **Checkpoint** | Marble centre within `radius` and `index > activeCheckpoint[p]` → activate; emit `checkpoint`. |
| **Goal** | Marble centre within `goal.radius` of the goal cell centre and `status == alive` → finish. |

### 7.11 Rendering (`src/render/`)

**Frame composition** (`Renderer.draw(snapshot, alpha, camera)`):

1. Clear; background gradient `bgTop → bgBottom`; theme-specific drifting shapes (practice: soft circles; skyways: clouds; lastledge: embers) using the render RNG; pipe tubes (dashed translucent quadratic curves between entry and exit, drawn behind terrain).
2. Terrain diagonal strips `k = cx + cy` in ascending order from the cached `StripCache`. Between strip `k` and `k+1`, draw dynamic objects with anchor `k_obj = floor(x) + floor(y)` sorted by `(z asc, y asc)`: wave cells (always dynamic, drawn with live heights), platform slabs, decals (speed chevrons, acid bubbles, start/goal/checkpoint markers), shadows (anchored to the ground cell under the object), marbles, steelies, munchers, hoovers, hammers, catapults, funnel rings, pipe mouths.
3. Particles (shards, bubbles, dust) in the same strip insertion using their anchor cell.
4. Screen-space: no HUD on canvas (HUD is DOM); debug overlay when `?debug=1` (cell grid, k values, strip boxes, frame times).

**Strip cache.** `terrainStrips.ts` renders every diagonal `k` once per zoom bucket (zoom rounded to 0.1) into an `OffscreenCanvas` (fallback `HTMLCanvasElement`) sized to the strip's projected bounding box including side faces. Cells inside wave regions are excluded from the cache. Memory cap 64 MB; evict least-recently-used buckets. Fallback if any browser mis-renders offscreen canvases: draw cells directly in the same loop (same code path, `cache: false`).

**Cell drawing** (`draw/cell.ts`). Top face: quad through the projected 4 corners (heights by slope formula); fill `theme.top` scaled by `shade = 0.72 + 0.38 · max(0, dot(n, L))` with `L = normalize(−1, −1, 2)` and `n` from the corner heights. South face (`+y`) in `theme.sideLight` and east face (`+x`) in `theme.sideDark`, each drawn from the top edge down to the neighbour's top when the neighbour is lower, or 2.5 units down with a linear fade to transparent when the neighbour is void. Explicit walls: rails 0.3 units tall and 0.12 thick along the edge in `theme.rail` with a 1 px lighter top line, drawn after the top face (north/west rails) or after the side faces (south/east rails). Surfaces: ice — top colour lightened 25 % plus three thin diagonal highlight strokes; acid — fixed `#3fae4a` top with darker random blobs (seeded by cell index); speed strip — top darkened 10 % plus three chevrons (animated offset in the decal pass).

**Marble** (`draw/marble.ts`). Shadow: ellipse at ground height under the marble, radii `(12.6, 6.3) · zoom · (1 − min(0.6, heightAbove/3))`, alpha 0.35. Body: circle radius `12.6 · zoom`, radial gradient from a highlight at `(−0.35R, −0.35R)` (white, alpha 0.9) through the player colour to a dark rim; two perpendicular darker "swirl" arcs rotated by `rollPhase` to read as rolling; glass alpha 0.92. Steelies: `#202024` with a sharper specular. P1 `#2f6df6`, P2 `#f29a2e`.

**Entity art** (`draw/entities.ts`): Muncher — five stacked green (`#4caf50`→`#2e7d32`) ellipses that compress/stretch with state, two white eye dots, rings fan toward the target while lunging. Hoover — grey cylinder (two ellipses + rect) 0.8 wide with a cone nozzle, converging dashed suction lines while active. Hammer — iso box head 1×1×0.6 on a vertical shaft; shadow grows as it drops. Catapult — darker pad decal with two curved arms that compress during windup. Platform — iso slab in `sideDark` with a lighter top. Pipe — entry: dark disc with a lighter ring; exit: raised ring. Funnel — six concentric rings darkening toward a black centre hole. Checkpoint — thin pole with a small triangular flag: grey, then the activating player's colour. Goal — a 1.6-unit ring of alternating light/dark segments rotating at 0.5 rev/s plus a short post with a flag. Start — faint circle decal.

**Effects** (`draw/effects.ts`, `particles.ts`): shatter — 12 triangular shards in the marble colour, radial velocities 2–5 u/s, gravity, fade over 0.7 s; acid — the marble scales to 0 with a green tint while 8 bubbles rise; munch — marble lerps into the mouth over 0.3 s, muncher pulses; hammer — marble squashes to a disc 0.3 s then fades; hoover — spiral toward the nozzle while shrinking 0.5 s; respawn — marble drops in with a brief ring flash; goal — radial sparkle burst.

**Interpolation.** The renderer receives the previous and current `RenderSnapshot` and blends positions by `alpha`; snapshots are plain arrays (no sim objects leak into the renderer).

### 7.12 Audio (`src/audio/`)

`AudioEngine`: one `AudioContext` created and `resume()`d on the first user gesture (title "press any key" also unlocks); buses `master → music`, `master → sfx` with gains from Settings (default music 0.6, sfx 0.8). Subscribes to `SimEvent`s and to per-frame state (`rollSpeed[p]`, `hooverProximity[p]`, `funnelProximity[p]`).

SFX (`sfx.ts`), all synthesized at call time from `synth.ts` helpers (`noise(duration, color)`, `tone(freq, type, env)`, `env(a,d,s,r)`):

| Id | Synthesis |
|----|-----------|
| `roll` (continuous, per player) | 2 s looping noise buffer (pink-ish: white noise through a one-pole lowpass at 1.2 kHz, pre-rendered once) → `BiquadFilter` lowpass `cutoff = 200 + speed·180 Hz`, `Q 0.7` → gain `min(1, speed/7) · 0.5` when grounded else 0; both parameters via `setTargetAtTime(·, now, 0.05)` |
| `clack` | sine 1800 Hz → 900 Hz over 60 ms, exp decay 70 ms + 20 ms white-noise burst; gain `min(1, impact/8)` |
| `land` | `clack` at half gain plus a 60 Hz thump 80 ms |
| `shatter` | 6 sine partials 2.5–7 kHz (fixed detune table), exp decay 400 ms; white-noise burst 120 ms; descending chirp 1200→300 Hz over 300 ms |
| `acid` | bandpass noise 800 Hz, Q 2, 600 ms with 8 Hz amplitude wobble |
| `munch` | sawtooth 180→80 Hz over 250 ms, then "gulp" sine 120→60 Hz 150 ms |
| `hammer` | 50 Hz sine thump 120 ms + lowpass noise 90 ms |
| `hoover` (continuous) | sawtooth 70 Hz + noise through lowpass 600 Hz; gain = proximity `(1 − d/pullRadius)` × 0.4 |
| `catapult` | triangle 200→900 Hz over 180 ms ("twang") + noise swish 200 ms |
| `pipe` | lowpass noise sweep 300→2000→300 Hz over `travelTime` |
| `funnel` (continuous) | sine 400–800 Hz pitch rising with 1/d, gain 0.25 |
| `speedStrip` | square 300→1200 Hz 120 ms |
| `checkpoint` | two sines 880, 1320 Hz 120 ms each |
| `goal` | arpeggio C5-E5-G5-C6 (square, 90 ms each) then a C major chord 600 ms |
| `countdown` / `go` | 440 Hz square 100 ms ×3 / 880 Hz 400 ms |
| `timeWarning` | 1000 Hz sine 40 ms each second when ≤ 10 s |
| `timeOut` | sawtooth 440→110 Hz over 700 ms |
| `menuMove` / `menuSelect` / `menuBack` | 600 Hz 30 ms / 900 Hz 60 ms + 1200 Hz 60 ms / 300 Hz 80 ms |
| `highScore` | ascending 8-note scale, triangle |
| `leftBehind` | `shatter` at half gain + 300 Hz drop |

Music (`music/sequencer.ts`, `music/tracks.ts`). `TrackDef { id, bpm, root (midi), scale (semitone set), bars: number, progression: degree[] (one chord per bar), bass: step pattern string (16 steps, "x.x." etc.), kick/snare/hat patterns, leadStyle: "arp" | "melody" | "pad", waveforms: { bass, lead, pad }, detune: cents, swing: 0..0.3 }`. The sequencer schedules 16th-note events 0.2 s ahead using `AudioContext.currentTime`, generating the lead line with a render RNG seeded by the track id so each race's tune is stable. Drums are noise bursts (kick: 150→40 Hz sine 120 ms; snare: noise 100 ms bandpass 1.8 kHz; hat: noise 30 ms highpass 7 kHz).

| Track | bpm | root/scale | Character |
|-------|-----|-----------|-----------|
| `m1-first-steps` | 92 | C4 major pentatonic | triangle lead, soft pad, kick+hat only |
| `m2-long-drop` | 112 | D4 dorian | square lead, walking bass, full kit |
| `m3-clockwork` | 124 | A3 harmonic minor | 16th-note arpeggios, ticking hats, swing 0 |
| `m4-skyways` | 118 | F4 lydian | pad chords, sparse melody, airy highpass |
| `m5-upside` | 140 | G4 whole-tone | detune 18 cents, swing 0.25, wobbling bass |
| `m6-last-ledge` | 150 | E3 phrygian | driving saw bass, fast arps, dense drums |

Title/attract plays `m1-first-steps` at 0.4 gain; menus play no music.

---

## 8. Core level set

### 8.0 Authoring conventions for all six races

- Sources live in `levels/src/core/NN-name.level.yaml` with `course: { slot: N }`. They are compiled only by `npm run levels:build` (or `mmlevel compile`). The authoring loop for the agent is: write YAML → `mmlevel validate` → `mmlevel testplay` → read `mmlevel trace`/`mmlevel path` on failure → adjust waypoints (speed, radius, hold) or geometry → repeat until `GOAL` with `W102` absent (solution time ≤ par) or accepted.
- Section tables below are authoritative; all coordinates are cells `(x, y)`, rects inclusive, heights are `hRaw` with the letter used in the `heights` layer in parentheses. "S ramp 34→27" means consecutive rows tagged `S` with `hRaw` 34, 33, …, 27 (one per row); the flat cell after it has `hRaw` one less than the last ramp row. "E ramp" decrements per column eastward. "N ramp" (used in Race 5) increments per row southward and is tagged `N`.
- Walls: "W x3 rows 6–13" means bit `W` (8) on every cell `(3, y)` for `y` in 6..13. Corner cells OR their bits. Where a section says "N row 15 except x4–7", the exception marks the opening where the previous section connects.
- Cells not listed in any section are void.
- Every race: `start.p2` is the cell east of `start.p1`. `timeBonus: 5`. `scoring.progress: 500`, `scoring.perSecond: 50`, `scoring.firstHome: 500`; `scoring.goal` as listed.
- Height letters: A=10 B=11 C=12 D=13 E=14 F=15 G=16 H=17 I=18 J=19 K=20 L=21 M=22 N=23 O=24 P=25 Q=26 R=27 S=28 T=29 U=30 V=31 W=32 X=33 Y=34 Z=35.

### 8.1 Race 1 — Practice: "First Steps"

| Field | Value |
|-------|-------|
| id / name | `practice` / `First Steps` |
| theme / music | `practice` / `m1-first-steps` |
| grid | 22 × 30 |
| timeLimit / par | 25 / 14 s (intended clean run ≈ 11–13 s) |
| scoring.goal | 500 |
| introduces | ramps, rails, open edges (a fall is the only hazard), one speed strip, one checkpoint |
| start | p1 `(4,3)`, p2 `(5,3)` |
| goal | `(18,27)` radius 0.8 |
| checkpoints | `[{ at: [18,16], radius: 1.0, respawnAt: [17,16] }]` |

Sections:

| § | Rect | Heights / slope | Surface | Walls |
|---|------|-----------------|---------|-------|
| A start | x2–7, y2–5 | 26 (Q) flat | — | N row 2; W x2; E x7; S on (2,5) and (7,5) |
| B ramp | x3–6, y6–13 | S ramp 26→19 (Q P O N M L K J) | — | W x3; E x6 |
| C landing | x3–10, y14–17 | 18 (I) flat | — | W x3; N row 14 for x7–10; S row 17 for x3–10. East edge of x10 open at rows 14 and 17 (teaching edge) |
| D chute | x11–16, y15–16 | E ramp 18→13 (I H G F E D) | — | N row 15; S row 16 |
| E strip | x17–19, y14–18 | 12 (C) flat | `v` on x18 rows 14–18 | N row 14; E x19 rows 14–18; W x17 rows 14, 17, 18 |
| F ramp | x17–19, y19–24 | S ramp 12→7 (C B A 9 8 7) | — | W x17; E x19 |
| G goal | x15–20, y25–28 | 6 flat | — | W x15; E x20; S row 28; N row 25 for x15–16 and x20 |

Complete layers (this race is written out in full as the model for the others):

```
heights:                 slopes:                  walls:                   surfaces:
......................   ......................   ......................   ......................
......................   ......................   ......................   ......................
..QQQQQQ..............   ......................   ..911113..............   ......................
..QQQQQQ..............   ......................   ..8....2..............   ......................
..QQQQQQ..............   ......................   ..8....2..............   ......................
..QQQQQQ..............   ......................   ..C....6..............   ......................
...QQQQ...............   ...SSSS...............   ...8..2...............   ......................
...PPPP...............   ...SSSS...............   ...8..2...............   ......................
...OOOO...............   ...SSSS...............   ...8..2...............   ......................
...NNNN...............   ...SSSS...............   ...8..2...............   ......................
...MMMM...............   ...SSSS...............   ...8..2...............   ......................
...LLLL...............   ...SSSS...............   ...8..2...............   ......................
...KKKK...............   ...SSSS...............   ...8..2...............   ......................
...JJJJ...............   ...SSSS...............   ...8..2...............   ......................
...IIIIIIII......CCC..   ......................   ...8...1111......913..   ..................v...
...IIIIIIIIIHGFEDCCC..   ...........EEEEEE.....   ...8.......111111..2..   ..................v...
...IIIIIIIIIHGFEDCCC..   ...........EEEEEE.....   ...8.......444444..2..   ..................v...
...IIIIIIII......CCC..   ......................   ...C4444444......8.2..   ..................v...
.................CCC..   ......................   .................8.2..   ..................v...
.................CCC..   .................SSS..   .................8.2..   ......................
.................BBB..   .................SSS..   .................8.2..   ......................
.................AAA..   .................SSS..   .................8.2..   ......................
.................999..   .................SSS..   .................8.2..   ......................
.................888..   .................SSS..   .................8.2..   ......................
.................777..   .................SSS..   .................8.2..   ......................
...............666666.   ......................   ...............91...3.   ......................
...............666666.   ......................   ...............8....2.   ......................
...............666666.   ......................   ...............8....2.   ......................
...............666666.   ......................   ...............C44446.   ......................
......................   ......................   ......................   ......................
```

Each column above is one YAML block scalar (22 chars × 30 rows). Entities: none. Difficulty notes: the first ramp accelerates the marble to ≈ 10 u/s; the landing's south rail stops it with a clack; the open east edges at (10,14) and (10,17) are the only ways to die. Solution guidance:

```yaml
solution:
  kind: waypoints
  points:
    - { at: [4, 4] }
    - { at: [4, 12], speed: 0.6 }     # brake on the ramp
    - { at: [6, 15], speed: 0.7 }
    - { at: [14, 15], speed: 1.0 }
    - { at: [18, 16], speed: 0.8 }    # checkpoint, strip pushes south
    - { at: [18, 22], speed: 1.0 }
    - { at: [18, 27], speed: 0.5 }
```

### 8.2 Race 2 — Beginner: "The Long Drop"

| Field | Value |
|-------|-------|
| id / name | `beginner` / `The Long Drop` |
| theme / music | `descent` / `m2-long-drop` |
| grid | 30 × 44 |
| timeLimit / par | 45 / 30 s |
| scoring.goal | 1000 |
| introduces | Steelies (patrol and hunt), acid puddles, a pipe, a 0.5-unit ledge drop, an unrailed beam |
| start | p1 `(5,4)`, p2 `(6,4)` |
| goal | `(10,40)` radius 0.8 |
| checkpoints | `[{at:[26,16]}, {at:[12,25]}]` (radius 1.0, respawnAt = at) |

Schematic (not to scale; arrows = direction of travel):

```
 [A start]─S→[B ramp, acid]─S→[C terrace, steelie]─E→[D ledge]─E→[E chute]─E→[F pipe room]
                                                                                   │ pipe
 [K goal, steelie]←S─[J ramp, acid]←S─[I terrace, acid]←W─(H beam)←W─[G terrace, hunter]◄┘
```

| § | Rect | Heights / slope | Surface | Walls |
|---|------|-----------------|---------|-------|
| A start | x2–9, y2–6 | 34 (Y) flat | — | N row 2; W x2; E x9; S on (2,6),(9,6) |
| B ramp | x3–8, y7–14 | S ramp 34→27 (Y X W V U T S R) | acid `a` at (5,9),(5,10),(7,12),(7,13) | W x3; E x8 |
| C terrace | x3–14, y15–19 | 26 (Q) flat | — | W x3; N row 15 for x9–14; S row 19; E x14 at rows 15 and 19 **open** (void), rows 16–18 open to D |
| D ledge | x15–18, y16–18 | 25 (P) flat (0.5 drop from C) | — | N row 16; S row 18 |
| E chute | x19–24, y16–18 | E ramp 25→20 (P O N M L K) | — | N row 16; S row 18 |
| F pipe room | x25–28, y15–19 | 19 (J) flat | — | N row 15; E x28; S row 19; W x25 rows 15 and 19 |
| G terrace | x20–28, y23–27 | 16 (G) flat | — | N row 23; E x28; S row 27; W x20 rows 23, 24, 27 |
| H beam | x14–19, y25–26 | 16 (G) flat | — | none (void at rows 24 and 27) |
| I terrace | x6–13, y24–28 | 16 (G) flat | acid at (9,26),(9,27),(8,27) | W x6; N row 24; S row 28 for x6 and x11–13; E x13 rows 24, 27, 28 |
| J ramp | x7–10, y29–36 | S ramp 16→9 (G F E D C B A 9) | acid at (9,32) | W x7; E x10 |
| K goal | x5–14, y37–42 | 8 flat | — | S row 42; W x5; E x14; N row 37 for x5–6 and x11–14 |

Entities:

```yaml
entities:
  - { type: steelie, at: [4, 17], mode: patrol, path: [[4, 17], [13, 17]], speed: 3.5 }
  - { type: pipe, entry: [27, 17], exit: [26, 24], exitVelocity: [0, 3, 0], travelTime: 1.2 }
  - { type: steelie, at: [22, 25], mode: hunt, aggroRadius: 5, speed: 4 }
  - { type: steelie, at: [6, 39], mode: patrol, path: [[6, 39], [13, 39]], speed: 3 }
```

Difficulty notes: the acid on the ramp forces a lane change mid-descent; F is a dead end whose only exit is the pipe; the hunter in G chases toward the beam, where a ram means a fall. Solution guidance — waypoints `(5,5)`, `(4,9) speed 0.7` (left lane), `(4,13)`, `(6,17)`, `(13,17) speed 0.9` (time the patrol: if the trace shows a ram, insert `{at:[8,16], hold: 60}`), `(16,17)`, `(22,17) speed 1.0`, `(26,17)`, `(27,17) speed 0.4` (pipe), `(24,25) speed 1.0`, `(17,25) speed 0.7` (beam — keep speed ≤ 0.7 so the P-controller stays centred), `(12,25)`, `(8,25)`, `(8,30) speed 0.6`, `(8,35)`, `(10,40) speed 0.5`.

### 8.3 Race 3 — Intermediate: "Clockwork Terrace"

| Field | Value |
|-------|-------|
| id / name | `intermediate` / `Clockwork Terrace` |
| theme / music | `clockwork` / `m3-clockwork` |
| grid | 34 × 52 |
| timeLimit / par | 55 / 40 s |
| scoring.goal | 1500 |
| introduces | wave floors, Marble Munchers, moving platforms (two ferries), a funnel |
| start | p1 `(5,3)`, p2 `(6,3)` |
| goal | `(13,50)` radius 0.9 |
| checkpoints | `[{at:[27,17]}, {at:[14,37]}]` |

```
 [A]─S─[B ramp]─S─[C wave terrace, muncher]─E─[D chute]─E─(E ferry)─E─[F terrace, muncher]
                                                                              │ S
 [K goal, hunter]─N─(J ferry)─N─[I lower hall, wave, 2 munchers]◄─funnel─[H funnel room]◄─[G ramp, steelie]
```

| § | Rect | Heights / slope | Surface | Walls |
|---|------|-----------------|---------|-------|
| A start | x3–8, y2–5 | 34 (Y) flat | — | N row 2; W x3; E x8; S on (3,5),(8,5) |
| B ramp | x4–7, y6–11 | S ramp 34→29 (Y X W V U T) | — | W x4; E x7 |
| C wave terrace | x2–13, y12–19 | 28 (S) flat | — | W x2; N row 12 except x4–7; S row 19; E x13 except rows 17–18 |
| D chute | x14–19, y17–18 | E ramp 28→23 (S R Q P O N) | — | N row 17; S row 18 |
| E ferry gap | x20–24, y16–19 | void | — | — |
| F terrace | x25–31, y15–20 | 22 (M) flat | — | N row 15; E x31; W x25 except rows 17–18; S row 20 except x27–30 |
| G ramp | x27–30, y21–27 | S ramp 22→16 (M L K J I H G) | — | W x27; E x30 |
| H funnel room | x22–33, y28–35 | 15 (F) flat | acid at (24,33),(31,29) | N row 28 except x27–30; E x33; S row 35; W x22 |
| I lower hall | x8–20, y36–42 | 12 (C) flat | — | W x8; E x20; N row 36; S row 42 except x12–14 |
| J ferry gap | x8–20, y43–48 | void | — | — |
| K goal | x6–20, y49–51 | 12 (C) flat | — | S row 51; W x6; E x20; N row 49 except x12–14 |

```yaml
entities:
  - { type: wave, rect: [2, 12, 13, 19], amplitude: 0.35, wavelength: 4, speed: 1.5, dir: [1, 0] }
  - { type: muncher, at: [7, 15], triggerRadius: 1.3 }
  - { type: platform, at: [20, 17], size: [2, 2], top: 22, path: [[20, 17], [23, 17]], speed: 2, pause: 1.0 }
  - { type: muncher, at: [29, 16], path: [[29, 16], [29, 19]], speed: 1.5 }
  - { type: steelie, at: [28, 21], mode: patrol, path: [[28, 21], [28, 27]], speed: 3 }
  - { type: funnel, at: [27, 31], radius: 3, depth: 1.5, exit: [14, 37], exitVelocity: [0, 2, 0] }
  - { type: wave, rect: [8, 38, 20, 42], amplitude: 0.3, wavelength: 3, speed: 2, dir: [0, 1] }
  - { type: muncher, at: [12, 40] }
  - { type: muncher, at: [17, 40] }
  - { type: platform, at: [12, 43], size: [3, 2], top: 12, path: [[12, 43], [12, 47]], speed: 2, pause: 1.0 }
  - { type: steelie, at: [9, 50], mode: hunt, aggroRadius: 4 }
```

Difficulty notes: the first ferry is reached at speed from the chute — the waypoint on the platform must brake (`speed 0.4`) and `hold` for the ride (ride ≈ 1.5 s + pause; start with `hold: 300` and adjust from the trace). The funnel room has no other exit; the muncher pair in I guards the second ferry pickup. Solution guidance — `(5,4)`, `(5,10) speed 0.6`, `(5,14)`, `(10,17) speed 0.8` (skirt the muncher), `(13,17)`, `(18,17) speed 1.0`, `{at:[20,17], speed:0.4, hold:300}`, `(25,17) speed 0.8`, `(27,17)`, `(28,19) speed 0.6`, `(28,26) speed 0.6`, `(27,31) speed 0.5` (funnel), `(14,38) speed 0.8`, `(13,41) speed 0.6`, `{at:[13,43], speed:0.4, hold:360}`, `(13,50) speed 0.5`.

### 8.4 Race 4 — Aerial: "Skyways"

| Field | Value |
|-------|-------|
| id / name | `aerial` / `Skyways` |
| theme / music | `skyways` / `m4-skyways` |
| grid | 30 × 52 |
| timeLimit / par | 55 / 42 s |
| scoring.goal | 2000 |
| introduces | jumpable gaps, Hoovers, catapults, unrailed ramps and beams; almost no rails |
| start | p1 `(5,3)`, p2 `(6,3)` |
| goal | `(8,47)` radius 0.9 |
| checkpoints | `[{at:[5,17]}, {at:[12,28]}, {at:[24,46]}]` |

```
 [A]─S─[B strip runway]─S─ gap ─S─[D landing]  (hoover pedestal to the east)
                                     │ S
                              [E narrow ramp]
                                     │ S
 [F catapult]──launch E──►[G terrace, hoover]─E─(H ferry)─E─[I pillar, steelie]
                                                                   │ S
 [N goal, hunter]◄─W─[M beam]◄─W─[L terrace, hoover]◄──launch S──[K catapult]◄─S─[J narrow ramp]
```

| § | Rect | Heights / slope | Surface | Walls |
|---|------|-----------------|---------|-------|
| A start | x3–8, y2–5 | 35 (Z) flat | — | N row 2; W x3; E x8; S on (3,5),(8,5) |
| B runway | x4–7, y6–12 | 35 (Z) flat | `v` on x5–6 rows 7–12 | W x4; E x7 |
| gap | rows 13–14 | void | — | — |
| D landing | x3–8, y15–18 | 33 (X) flat | — | W x3 only |
| hoover pedestal | x11–13, y15–17 | 33 (X) flat | — | none |
| E ramp | x5–6, y19–26 | S ramp 33→26 (X W V U T S R Q) | — | none |
| F catapult deck | x3–8, y27–29 | 25 (P) flat | — | W x3; S row 29; N row 27 except x5–6 |
| G terrace | x10–16, y26–30 | 23 (N) flat | — | S row 30; E x16 rows 29–30 (rows 27–28 open to the ferry) |
| H ferry gap | x17–22, y26–30 | void | — | — |
| I pillar | x23–26, y26–30 | 23 (N) flat | — | N row 26; E x26; S row 30 except x24–25 |
| J ramp | x24–25, y31–38 | S ramp 23→16 (N M L K J I H G) | — | none |
| K catapult deck | x22–27, y39–41 | 15 (F) flat | — | N row 39 except x24–25; W x22; E x27; S row 41 |
| L terrace | x21–28, y44–48 | 13 (D) flat | — | S row 48; E x28; N row 44; W x21 except rows 46–47 |
| M beam | x12–20, y46–47 | 13 (D) flat | — | none |
| N goal | x6–11, y44–50 | 13 (D) flat | — | W x6; N row 44; S row 50; E x11 except rows 46–47 |

```yaml
entities:
  - { type: hoover, at: [12, 16], pullRadius: 4.5, pullStrength: 14 }
  - { type: catapult, at: [5, 28], launch: [8, 0, 6] }        # lands on G near x≈10.6
  - { type: hoover, at: [16, 26], pullRadius: 3 }
  - { type: platform, at: [17, 27], size: [2, 2], top: 23, path: [[17, 27], [21, 27]], speed: 2.5, pause: 0.8 }
  - { type: steelie, at: [23, 29], mode: patrol, path: [[23, 29], [26, 29]], speed: 3.5 }
  - { type: catapult, at: [24, 40], launch: [0, 8, 7] }       # lands on L near y≈46.1
  - { type: hoover, at: [28, 44], pullRadius: 3.5 }
  - { type: steelie, at: [9, 49], mode: hunt, aggroRadius: 4, speed: 4.5 }
```

Difficulty notes: the runway strip guarantees the two-cell gap at ≥ 10 u/s (drop 0.48 u over the gap vs. a 1.0 u ledge); without the strip the marble must still exceed 7 u/s. The narrow ramps have no rails — the controller gain keeps a centred marble on a 2-wide ramp only if `speed ≤ 0.7`. Both catapults disable the shatter check for their flight. Solution guidance — `(5,4)`, `(5,11) speed 1.0`, `(5,16) speed 0.6`, `(5,22) speed 0.6`, `(5,28) speed 0.4` (catapult), after landing `(12,28) speed 0.6`, `{at:[17,28], speed:0.4, hold:260}`, `(24,28) speed 0.6`, `(24,34) speed 0.6`, `(24,40) speed 0.4` (catapult), `(24,46) speed 0.6`, `(16,46) speed 0.6`, `(8,47) speed 0.5`.

### 8.5 Race 5 — Silly: "Upside Downhill"

| Field | Value |
|-------|-------|
| id / name | `silly` / `Upside Downhill` |
| theme / music | `topsy` / `m5-upside` |
| grid | 32 × 50 |
| timeLimit / par | 50 / 38 s |
| scoring.goal | 2500 |
| physics | `{ slopeGravityScale: -1 }` — marbles accelerate **up** slopes; falls behave normally |
| introduces | inverted slopes (the course climbs), ice, hammers |
| start | p1 `(5,3)`, p2 `(6,3)` |
| goal | `(19,47)` radius 0.9 |
| checkpoints | `[{at:[3,15]}, {at:[20,24]}]` |

```
 [A low start]─S─[B ramp UP, ice]─S─[C hammer hall]──pipe──►[E ice terrace, hunter, acid]
                                                                     │ S (ramp F pushes you BACK)
                               [I goal, hammers]◄─S─[H ramp UP, no rails]◄─S─[G hammer hall]
```

| § | Rect | Heights / slope | Surface | Walls |
|---|------|-----------------|---------|-------|
| A start | x3–8, y2–5 | 6 flat | — | N row 2; W x3; E x8; S on (3,5),(8,5) |
| B ramp up | x4–7, y6–13 | N ramp 7→14 (7 8 9 A B C D E, tagged `N`) | ice on rows 10–13 | W x4; E x7 |
| C hammer hall | x2–13, y14–20 | 14 (E) flat | — | W x2; N row 14 except x4–7; E x13; S row 20 (pipe is the exit) |
| E ice terrace | x16–27, y22–28 | 14 (E) flat | ice everywhere; acid at (19,27),(25,23) | N row 22; E x27; W x16; S row 28 except x22–25 |
| F counter-ramp | x22–25, y29–31 | S ramp 14→12 (E D C) — inverted gravity pushes north | — | W x22; E x25 |
| G hammer hall | x18–29, y32–36 | 11 (B) flat | — | W x18; E x29; N row 32 except x22–25; S row 36 except x19–20 |
| H ramp up | x19–20, y37–44 | N ramp 12→19 (C D E F G H I J, tagged `N`) | — | none |
| I goal | x14–25, y45–48 | 19 (J) flat | — | S row 48; E x25; W x14; N row 45 except x19–20 |

```yaml
entities:
  - { type: hammer, at: [5, 16], period: 2.4, phase: 0 }
  - { type: hammer, at: [8, 16], period: 2.4, phase: 0.8 }
  - { type: hammer, at: [11, 16], period: 2.4, phase: 1.6 }
  - { type: hammer, at: [6, 19], period: 2.4, phase: 0.4 }
  - { type: hammer, at: [9, 19], period: 2.4, phase: 1.2 }
  - { type: pipe, entry: [12, 19], exit: [20, 24], exitVelocity: [1, 1, 0], travelTime: 1.2 }
  - { type: steelie, at: [22, 25], mode: hunt, aggroRadius: 6, speed: 4 }
  - { type: hammer, at: [21, 34], period: 2.0, phase: 0 }
  - { type: hammer, at: [24, 34], period: 2.0, phase: 0.67 }
  - { type: hammer, at: [27, 34], period: 2.0, phase: 1.33 }
  - { type: hammer, at: [16, 46], period: 2.4, phase: 0 }
  - { type: hammer, at: [23, 46], period: 2.4, phase: 1.2 }
```

Difficulty notes: ramp B flings the marble south at 12 u/s² into the hammer hall; the counter-ramp F must be fought through at a net 6 u/s² (full stick south); ramp H is two cells wide, unrailed, and accelerating — the autopilot needs `speed 0.5` there. Pipe entry (12,19) sits in the hall's south-east corner behind the hammer row. Solution guidance — `(5,4)`, `(5,12) speed 0.5`, `(3,15)`, `(3,18) speed 0.6`, `(12,19) speed 0.5` (wait for hammers: use `{at:[7,18], hold: 40}` if the trace shows a `hammer` death), `(20,24)`, `(23,27) speed 0.6`, `(23,31) speed 1.0`, `(19,35) speed 0.6`, `(19,40) speed 0.5`, `(19,47) speed 0.4`.

### 8.6 Race 6 — Ultimate: "The Last Ledge"

| Field | Value |
|-------|-------|
| id / name | `ultimate` / `The Last Ledge` |
| theme / music | `lastledge` / `m6-last-ledge` |
| grid | 36 × 64 |
| timeLimit / par | 60 / 48 s |
| scoring.goal | 3000 |
| introduces | nothing new; combines every hazard with hunting Steelies in numbers |
| start | p1 `(5,3)`, p2 `(6,3)` |
| goal | `(24,62)` radius 0.9 |
| checkpoints | `[{at:[4,18]}, {at:[5,28]}, {at:[23,28]}, {at:[10,41]}, {at:[28,50]}]` |

```
 [A]─S─[B twin-lane ramp, acid spine, steelie]─S─[C wave terrace, 2 munchers, hoover]─S─[D strip]─ gap ─[F hammers]
                                                                                                          │ E
 [L lower hall, 3 munchers, steelie, wave]◄─funnel─[K funnel room, hoover]◄─launch S─[I pillar, hunter]◄─(H ferry)◄─[G ice chute]
        │ pipe
        ▼
 [N ice terrace, 3 hammers, hoover]─S─[O unrailed ramp + strip]─S─[P goal, 2 hunters]
```

| § | Rect | Heights / slope | Surface | Walls |
|---|------|-----------------|---------|-------|
| A start | x3–8, y2–4 | 35 (Z) flat | — | N row 2; W x3; E x8 |
| B twin ramp | x3–8, y5–12 | S ramp 35→28 (Z Y X W V U T S) | acid on x6 rows 5–12 | W x3; E x8 |
| C wave terrace | x2–15, y13–19 | 27 (R) flat | — | W x2; N row 13 except x3–8; E x15; S row 19 except x4–6 |
| D strip | x4–6, y20–24 | 27 (R) flat | `v` on x5 rows 20–24 | W x4; E x6 |
| gap | rows 25–26 | void | — | — |
| F hammer deck | x3–8, y27–30 | 25 (P) flat | — | W x3; S row 30; N row 27 except x4–6; E x8 except rows 28–29 |
| G ice chute | x9–15, y28–29 | E ramp 25→19 (P O N M L K J) | ice | N row 28; S row 29 |
| H ferry gap | x16–21, y26–31 | void | — | — |
| I pillar | x22–27, y26–31 | 18 (I) flat | acid at (23,30),(26,27) | N row 26; E x27; W x22 except rows 28–29; S row 31 |
| K funnel room | x22–29, y35–39 | 16 (G) flat | — | N row 35; E x29; S row 39; W x22 |
| L lower hall | x6–18, y40–46 | 12 (C) flat | — | W x6; N row 40; E x18; S row 46 |
| N ice terrace | x24–33, y49–53 | 10 (A) flat | ice | N row 49; E x33; W x24; S row 53 except x24–25 |
| O final ramp | x24–25, y54–59 | S ramp 10→5 (A 9 8 7 6 5) | `v` on rows 57–59 | none |
| P goal | x20–29, y60–63 | 4 flat | — | S row 63; E x29; W x20; N row 60 except x24–25 |

```yaml
entities:
  - { type: steelie, at: [8, 5], mode: patrol, path: [[8, 5], [8, 12]], speed: 3 }
  - { type: wave, rect: [2, 13, 15, 19], amplitude: 0.4, wavelength: 3.5, speed: 2, dir: [1, 1] }
  - { type: muncher, at: [6, 16] }
  - { type: muncher, at: [11, 15] }
  - { type: hoover, at: [14, 13], pullRadius: 3 }
  - { type: hammer, at: [4, 29], period: 2.2, phase: 0 }
  - { type: hammer, at: [7, 29], period: 2.2, phase: 1.1 }
  - { type: platform, at: [16, 28], size: [2, 2], top: 18, path: [[16, 28], [20, 28]], speed: 3, pause: 0.6 }
  - { type: steelie, at: [25, 28], mode: hunt, aggroRadius: 6, speed: 5 }
  - { type: catapult, at: [25, 30], launch: [0, 8, 7] }      # lands in K near y≈36.1
  - { type: funnel, at: [25, 37], radius: 2.5, depth: 1.5, exit: [10, 41], exitVelocity: [0, 2, 0], travelTime: 1.0 }
  - { type: hoover, at: [29, 35], pullRadius: 3 }
  - { type: muncher, at: [9, 43] }
  - { type: muncher, at: [14, 43] }
  - { type: muncher, at: [12, 45] }
  - { type: steelie, at: [7, 42], mode: patrol, path: [[7, 42], [17, 42]], speed: 4 }
  - { type: wave, rect: [6, 44, 18, 46], amplitude: 0.3, wavelength: 3, speed: 2.5, dir: [1, 0] }
  - { type: pipe, entry: [17, 46], exit: [28, 50], exitVelocity: [0, 3, 0], travelTime: 1.5 }
  - { type: hammer, at: [26, 51], period: 2.0, phase: 0 }
  - { type: hammer, at: [29, 51], period: 2.0, phase: 0.5 }
  - { type: hammer, at: [32, 51], period: 2.0, phase: 1.0 }
  - { type: hoover, at: [33, 49], pullRadius: 3 }
  - { type: steelie, at: [21, 61], mode: hunt, aggroRadius: 5, speed: 5 }
  - { type: steelie, at: [28, 61], mode: hunt, aggroRadius: 5, speed: 5 }
```

Difficulty notes: the left lane of B (x3–5) is safe from the patrolling steelie; the wave in C runs diagonally and shoves marbles toward the hoover; the gap after D needs the strip; G is ice so the marble arrives at the ferry fast (`speed 0.4` waypoint on the platform plus `hold`); the pillar hunter is fast (5 u/s) — approach via the acid-free diagonal; K's only exit is the funnel; L's steelie patrols row 42 between the munchers; the pipe exit drops onto ice between hammers; the final strip-assisted ramp dumps the marble into two hunters guarding the goal. Solution guidance — `(4,4)`, `(4,11) speed 0.5`, `(4,18)`, `(5,23) speed 1.0`, `(5,28) speed 0.4`, `(12,28) speed 0.6`, `{at:[16,28], speed:0.4, hold:200}`, `(23,28) speed 0.6`, `(25,30) speed 0.4` (catapult), `(25,37) speed 0.5` (funnel), `(10,42) speed 0.6`, `(17,46) speed 0.6` (expect to tune around the patrol with `hold`), `(28,51) speed 0.5`, `(24,52) speed 0.5`, `(24,58) speed 1.0`, `(24,62) speed 0.3`.

<!-- CONTINUE -->
