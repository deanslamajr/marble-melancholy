# Agent rules for Marble Melancholy

Read `README.md` first, then the last rows of `DECISIONS.md`. `DECISIONS.md` logs every choice that `PLAN.md` (the original spec, D01–D37) does not cover. `PLAN.md` is about 1,500 lines, so grep it for a topic instead of reading it whole.

## Invariants

Tests and lint enforce these. Do not weaken a test to get past one.

1. The engine loads only stamped levels. After any change under `levels/src` or the compiler, run `npm run levels:build` and commit `levels/compiled`. A second run must produce no diff.
2. `src/sim`, `src/level` and `src/core` stay deterministic: no `Math.sin`/`cos`/`pow`/`random` and similar, no `**`, no clocks. Use `src/core/dmath.ts`. The sim runs at a fixed 120 Hz.
3. Only `src/levels/manifest.ts` imports level data. The YAML parser, the builder and the generator pipeline stay out of the main bundle.
4. The names of the original game and its publisher appear only in `README.md`.
5. Level limits (D36): grid 4–128 per side, at most 8192 non-void cells, at most 64 entities, time limit 5–99 s.
6. The beta must stay on HTTPS, because stamping and checking levels use `crypto.subtle`.
7. Two-player framing measures against the fixed 960×540 box and counts sim ticks (R17, R18).
8. A generator change that gives any seed a different course bumps `GENERATOR_VERSION` (L24) and updates `tests/e2e/generator.spec.ts`.

## What needs the user's approval

- Free inside the scope of a request: code, tests, `DECISIONS.md` rows, and read-only cluster commands (`npm run deploy:status`, `kubectl get`, `gcloud ... describe` or `list`).
- Always ask first: every deploy, every push, new cost, new dependencies and version bumps.
- Always ask before you change shared cluster resources: the Gateway `default/external-https`, the cert map, or anything in another namespace.
- Always ask before you change anything in the sibling `llmgag` repo.
- If a marble rollout fails, run `kubectl rollout undo deployment/marble -n marble-melancholy` at once and then tell the user.
- Give each `kubectl` command the GKE context explicitly. Another cluster context exists on this machine.

## Deploying

The beta shares its GKE Gateway with the user's llmgag sites. If any route on that Gateway is invalid, GKE stops updating every route on it.

1. Commit everything. The deploy tags the image with the commit.
2. Before you deploy, run `npm run deploy:status` and record the status codes of the llmgag hosts.
3. Run `npm run deploy` only with the user's approval.
4. After the deploy, run `npm run deploy:status` again. Compare the Gateway state and the llmgag status codes with step 2.

To moderate shared courses, run `npm run admin -- list`, then `npm run admin -- hide <code>` (or `unhide`). It runs inside the API pod. Hide a course only when the user asks.

## Working habits

- Commit to `main` in small steps. Run only the relevant tests while you iterate. `npm test` takes about a minute.
- Log every design choice or deviation as a row in `DECISIONS.md`.
- Do not use ports 5173–5177, which belong to the user. Do not stop a server that you did not start.
- Playwright reuses any server on port 4173. Before an E2E run, make sure that nothing listens there: `lsof -nP -iTCP:4173 -sTCP:LISTEN`.
- Close every browser tab and stop every server that you start. The game plays music.
- Keep the `HANDOFF*.md` files out of git. They hold private notes.
