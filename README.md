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
| Touch   | Drag anywhere to steer; tap ❚❚ or quickly tap the right side to pause             |

Reach the goal flag before the timer hits zero. Time left over carries into the next race, plus a
bonus for finishing. Falling off an edge shatters the marble and costs you the seconds it takes to
respawn. Two players race at once on a shared screen.

Besides the six-race campaign there are single races:

- **Extra Courses** (`#/extras`): eight shipped courses from easy to hard, three of them short
  enough for a phone. Each keeps your best time. Direct link: `#/play/extra/<id>`.
- **Generate Course** (`#/generate`): pick Easy, Medium, Hard, Expert, Insane or Nightmare and get
  a new, solvable course from a seed. Play it, regenerate, save it to Custom Races or copy a share
  link. A link such as `#/play/generated/insane/1234/v3` always builds the same course. Hard and
  above are solved by a search over the simulation (a few seconds, with a progress readout), and
  the screen shows difficulty metrics: fragility, steering changes per second, diagonal input,
  minimum path width, rail-less and over-void shares, and airborne count.
- **Custom Races**: levels you made in the builder, imported, or saved from the generator.

### Phones and full screen

The view widens or grows taller to fill the screen. Wider screens show more of the course, up to
a 2.4:1 width-to-height ratio, and narrower ones up to 3:4. Two-player races frame and leave
players behind in the same way on every screen.

- **Android and desktop:** press the corner button on the title screen, or **FULLSCREEN** in the
  pause menu. On Android, the game also locks to landscape while it is full screen.
- **iPhone:** Safari has no full-screen mode for web pages, so add the game to the home screen.
  In Safari, tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.
  Open the game from the new icon. It then runs full screen, with no browser bars.
- **Android install:** in Chrome, open the **⋮** menu and tap **Add to Home screen** (or
  **Install app**). The installed game opens full screen in landscape.

## Level builder (GUI)

Open **Level Builder** from the title screen, or go to `#/builder`. Press **+ New level** to get a
corridor with a start and a goal, or pick a shipped level under **Examples** and press **Open as
new draft** to edit a copy of it. Then:

- Sculpt with the tool keys: `H` height brush, `G` set height, `S` slope, `U` surface, `W` walls,
  `X` void, `E` entities, `1`/`2` start, `O` goal, `C` checkpoint, `P` waypoint, `V` select.
- `Tab` switches between the top-down editor and the isometric preview. `T` or `F5` test-plays,
  `R` records a test-play (and offers to save it as the solution).
- `A` auto-solves along the waypoints, `F7` validates, `Ctrl+Z`/`Ctrl+Y` undo/redo, `Ctrl+S`
  saves the draft (drafts also autosave), `Ctrl+E` exports.
- **Export → Download .level.json** compiles and stamps the level and adds it to **Custom Races**.

## Level builder (headless, for agents and CI)

`mmlevel` (run with `npm run mmlevel -- <command>`) does everything the GUI does from the shell:

| Command                              | What it does                                                            |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `validate <src...>`                  | Parse and validate sources; prints `file:(x,y): error E0NN: …`          |
| `testplay <file>`                    | Run the level's solution; prints `GOAL at 3.70 s` or why it failed      |
| `trace <file> [--every 30]`          | Tick-by-tick marble position, speed, status and current waypoint        |
| `path <file>`                        | ASCII map of the path the solution took, with death cells               |
| `compile <src...> [--out dir]`       | Validate, solve and stamp; writes `.level.json`                         |
| `build-all`                          | Compile everything in `levels/src` into `levels/compiled` + manifest    |
| `check <compiled...> [--no-replay]`  | Verify schema, stamp and embedded replay of compiled levels             |
| `info <file>`                        | Summary of a source or compiled level                                   |
| `schema [--out dir]`                 | Write JSON Schemas for both formats                                     |
| `generate --seed N [--difficulty d]` | Generate a solvable course (easy … nightmare) from a seed, with metrics |

`generate` prints the YAML source to stdout; `--out file.level.yaml` writes it instead,
`--compiled file.level.json` also writes the stamped level, and `--theme` picks a theme. The
builder home has the same action as **Generate**, which opens the course as a new draft.

Every command accepts `--json` for one JSON object per line. Exit codes: 0 ok, 1 level errors,
2 the solution did not reach the goal, 3 I/O or usage errors.

The authoring loop: write YAML → `validate` → `testplay` → on failure read `trace` and `path` →
adjust waypoints (`speed`, `radius`, `hold`) or geometry → repeat → `npm run levels:build`.
Compiled outputs in `levels/compiled/` are committed; the test suite fails if they are stale.

## Development

| Script                    | Purpose                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `npm test`                | Check compiled levels, then run Vitest (unit, levels, enforcement, storage, sim perf)    |
| `npm run test:e2e`        | Playwright on chromium, firefox and webkit                                               |
| `npm run test:e2e:mobile` | Touch tests: Pixel 7 and iPhone 14 in both orientations; iPhone 15, Galaxy S24 landscape |
| `npm run test:perf`       | Playwright frame-time budget on chromium                                                 |
| `npm run lint`            | ESLint and Prettier check                                                                |
| `npm run typecheck`       | `tsc` for the app and for tools/tests                                                    |
| `npm run levels:build`    | Recompile all level sources                                                              |
| `npm run icons`           | Redraw the home-screen icons in `public/icons/` (drawn in code, no image assets)         |

`?e2e=1` exposes `window.__mm`, a small test API used by Playwright. Design decisions are in
[`PLAN.md`](PLAN.md) (D01–D37) and [`DECISIONS.md`](DECISIONS.md).

## Deploying the beta

The public beta is served at <https://marble.llmgag.world/> from the GKE cluster `cluster-1` in
the GCP project `development-262721`, the same cluster as llmgag. HTTPS is required: level loading
checks SHA-256 stamps with `crypto.subtle`, which browsers only provide on HTTPS or localhost.

```sh
npm run deploy           # build, push the image, apply the manifests, wait for the rollout
npm run deploy:status    # rollout, route, Gateway, certificate, DNS and HTTPS state
```

`npm run deploy` needs Docker with `buildx`, `kubectl` and a gcloud login. Docker must be able to
push to `us-central1-docker.pkg.dev` (`gcloud auth configure-docker us-central1-docker.pkg.dev`).
The script builds `dist/`, builds a `linux/amd64` nginx image (`Dockerfile`,
`deploy/nginx.conf`) and pushes it as
`us-central1-docker.pkg.dev/development-262721/marble-melancholy/web:<git sha>`. Then it applies
`deploy/k8s/marble.yaml` with that tag and waits for the rollout. It always uses the kubectl
context `gke_development-262721_us-central1-a_cluster-1`. Override it with `KUBE_CONTEXT`, and set
`GCLOUD` if `gcloud` is not on your PATH. Commit before deploying: a build from a tree with
uncommitted changes is tagged `<sha>-dirty-<time>`.

`index.html` and `manifest.webmanifest` are served with `no-cache`, the icons in `icons/` for a
day, and the hashed files in `assets/` for a year, so players get a new build the next time they
load the page.

If `deploy:status` shows `gateway Programmed=False`, the shared Gateway is rejecting one of its
routes. While it does, GKE pushes no route changes to the load balancer for any host on it, and
`marble.llmgag.world` stays out of the URL map.

**How it is wired.** The namespace `marble-melancholy` holds one nginx pod, a Service, a GKE
HealthCheckPolicy (`/healthz`) and an HTTPRoute for `marble.llmgag.world`. The HTTPRoute attaches
to the shared Gateway `default/external-https` (34.117.49.14), which also serves the llmgag
hosts. TLS comes from the Certificate Manager certificate `marble-llmgag-world`, through its entry
in the Gateway's cert map `dslama-net-map`. DNS for `llmgag.world` is at Squarespace Domains, which
holds two records for the beta:

| Host                     | Type  | Value                                                                       |
| ------------------------ | ----- | --------------------------------------------------------------------------- |
| `marble`                 | A     | `34.117.49.14`                                                              |
| `_acme-challenge.marble` | CNAME | `d1e102d8-8405-4373-85b4-cad316810fb0.8.authorize.certificatemanager.goog.` |

The title screen shows the build in the corner, for example `BETA 1.0.0 · 86b7038`. Testers can
quote it in feedback. `+dirty` after the commit means the build had uncommitted changes.

**Feedback link.** Set `VITE_FEEDBACK_URL` at build time to show a FEEDBACK item in the title and
pause menus and a small link on the result screens. Each one opens the URL in a new tab. When the
variable is not set, the link is hidden. To set it for every deploy, commit a `.env.production`
file and redeploy:

```sh
echo 'VITE_FEEDBACK_URL=https://forms.gle/your-form' > .env.production
npm run deploy
```

For a single deploy, run `VITE_FEEDBACK_URL=https://… npm run deploy`. The URL is compiled into
the JavaScript, so changing it always needs a redeploy.

## Credits

Marble Melancholy is an original, non-commercial homage to _Marble Madness_ (Atari Games, 1984).
It contains no code, art, sound or level data from that game; all courses, graphics and music are
original and generated in code. _Marble Madness_ and Atari are trademarks of their respective
owners.

Released under the [MIT License](LICENSE).
