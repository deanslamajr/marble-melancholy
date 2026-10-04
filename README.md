# Marble Melancholy

A short, sad race downhill. Steer a glass marble with real momentum across six floating isometric
courses before the timer runs out, or build your own courses in the level builder.

- TypeScript + Vite 5 + Preact; Canvas 2D rendering; synthesized Web Audio sound and music.
- A deterministic 120 Hz physics sim: the same inputs give the same result on every browser.
- Levels are YAML sources compiled by `mmlevel` into stamped JSON with an embedded solution replay.
  The game only loads stamped levels, and every shipped level is proven solvable.

## Play

Requires Node 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
```

For a production build: `npm run build`, then `npm run preview` (http://localhost:4173). The
`dist/` folder is static and works from any web server.

| Control | Action                                                                            |
| ------- | --------------------------------------------------------------------------------- |
| Mouse   | Click the race to capture the pointer, then roll it like a trackball. Esc pauses. |
| P1 keys | Arrow keys or numpad 1–9 (also W A S D while P2 uses I J K L)                     |
| P2 keys | W A S D or I J K L (Settings)                                                     |
| Gamepad | Left stick to steer, A confirm, B back, Start pause                               |
| Touch   | Drag on the left half to steer, tap the right half to pause                       |

Reach the goal flag before the timer hits zero. Time left over carries into the next race, plus a
bonus for finishing. Falling off an edge shatters the marble and costs you the seconds it takes to
respawn. Two players race at once on a shared screen.

## Level builder (GUI)

Open **Level Builder** from the title screen, or go to `#/builder`. Press **+ New level** to get a
corridor with a start and a goal, then:

- Sculpt with the tool keys: `H` height brush, `G` set height, `S` slope, `U` surface, `W` walls,
  `X` void, `E` entities, `1`/`2` start, `O` goal, `C` checkpoint, `P` waypoint, `V` select.
- `Tab` switches between the top-down editor and the isometric preview. `T` or `F5` test-plays,
  `R` records a test-play (and offers to save it as the solution).
- `A` auto-solves along the waypoints, `F7` validates, `Ctrl+Z`/`Ctrl+Y` undo/redo, `Ctrl+S`
  saves the draft (drafts also autosave), `Ctrl+E` exports.
- **Export → Download .level.json** compiles and stamps the level and adds it to **Custom Races**.

## Level builder (headless, for agents and CI)

`mmlevel` (run with `npm run mmlevel -- <command>`) does everything the GUI does from the shell:

| Command                             | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `validate <src...>`                 | Parse and validate sources; prints `file:(x,y): error E0NN: …`       |
| `testplay <file>`                   | Run the level's solution; prints `GOAL at 3.70 s` or why it failed   |
| `trace <file> [--every 30]`         | Tick-by-tick marble position, speed, status and current waypoint     |
| `path <file>`                       | ASCII map of the path the solution took, with death cells            |
| `compile <src...> [--out dir]`      | Validate, solve and stamp; writes `.level.json`                      |
| `build-all`                         | Compile everything in `levels/src` into `levels/compiled` + manifest |
| `check <compiled...> [--no-replay]` | Verify schema, stamp and embedded replay of compiled levels          |
| `info <file>`                       | Summary of a source or compiled level                                |
| `schema [--out dir]`                | Write JSON Schemas for both formats                                  |

Every command accepts `--json` for one JSON object per line. Exit codes: 0 ok, 1 level errors,
2 the solution did not reach the goal, 3 I/O or usage errors.

The authoring loop: write YAML → `validate` → `testplay` → on failure read `trace` and `path` →
adjust waypoints (`speed`, `radius`, `hold`) or geometry → repeat → `npm run levels:build`.
Compiled outputs in `levels/compiled/` are committed; the test suite fails if they are stale.

## Development

| Script                 | Purpose                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `npm test`             | Check compiled levels, then run Vitest (unit, levels, enforcement, storage, sim perf) |
| `npm run test:e2e`     | Playwright on chromium, firefox and webkit                                            |
| `npm run test:perf`    | Playwright frame-time budget on chromium                                              |
| `npm run lint`         | ESLint and Prettier check                                                             |
| `npm run typecheck`    | `tsc` for the app and for tools/tests                                                 |
| `npm run levels:build` | Recompile all level sources                                                           |

`?e2e=1` exposes `window.__mm`, a small test API used by Playwright. Design decisions are in
[`PLAN.md`](PLAN.md) (D01–D37) and [`DECISIONS.md`](DECISIONS.md).

## Credits

Marble Melancholy is an original, non-commercial homage to _Marble Madness_ (Atari Games, 1984).
It contains no code, art, sound or level data from that game; all courses, graphics and music are
original and generated in code. _Marble Madness_ and Atari are trademarks of their respective
owners.

Released under the [MIT License](LICENSE).
