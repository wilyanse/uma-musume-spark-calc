# T13 — Web screens S01–S07

- **Status:** Done (pending independent parent-dispatched review)
- **Branch:** task/T13-web-screens (base 08d4876; current main dd16e68 NOT merged, per instructions)
- **Agent / model provenance:** Opus 5.5 medium (primary) → interrupted by HTTP 429 mid-implementation → GPT-6.1 Sol medium (approved fallback) resumed in the same worktree → Sol hit its usage limit → Opus 5.5 medium (primary, restored) finished. No worktree reset/clean/recreate at any switch; every partial file was inspected and kept. Milestone commit 287c7ab was made by the resumed Opus run after Sol's work.
- **Date:** 2026-10-06

## Summary
All seven approved screens (S01 Roster, S02 Veteran, S03 Review, S04 Cards, S05 Targets, S06 Planner, S07 Model health) are implemented in React 19 on the approved H5 design tokens/CSS, with light/dark/system theme and a 390px mobile layout. Data comes from the real `/api/v1` routes via a typed `DataSource` (ETag/304 roster cache, optimistic mode PATCH with rollback, 409/404 review refresh), or—only with `VITE_FIXTURES=1`—from the committed SYNTHETIC golden fixtures with in-tab mock CRUD and a permanent synthetic banner. The real `@uma/engine` runs in a Comlink Web Worker (fit/rank, terminate+recreate cancellation, generation-tagged stale-result suppression). Training-v2 is fitted/reused per roster ETag/master/context; legacy v1 is shown read-only and never relabelled. Calibration (T15) and review dismiss (Q70) are disabled with an explanation.

## Files
Created (apps/web): `scripts/tokens.mjs` (tokens.css from docs/design/tokens.json, `--check` in test), `playwright.config.ts`, `.gitignore`, `e2e/screens.spec.ts`; `src/api/{errors,http,fixture,types}.ts`; `src/app/{services,createServices,queries,engine,engineErrors}.ts`; `src/components/{atoms,Layout}.tsx`; `src/lib/{keys,format,storage,ulid,roster,targets,paths,deck,model}.ts`; `src/master/load.ts`; `src/screens/{Roster,Veteran,Review,Cards,Targets,Planner,Health}.tsx`; `src/styles/{tokens,app}.css`; `test/{fixtures,setup,harness}.ts(x)` and 8 test files. Evidence in `docs/changelog/assets/T13/`.

Modified: `apps/web/{package.json,tsconfig.json,vite.config.ts}`, `src/{main,router}.tsx`, `src/workers/{client,engine.api,engine.worker}.ts`, root `pnpm-lock.yaml`.

Deleted: `src/api/client.ts`, `src/routes/{Layout,Placeholder}.tsx`, `test/skeleton.test.tsx` (T02 skeleton, superseded).

Exact dependency pins added: `@uma/engine`/`@uma/master-data` `workspace:*`; dev `@testing-library/react 16.3.3`, `@testing-library/dom 10.4.2`, `@testing-library/user-event 14.6.7`, `@playwright/test 1.62.1`, `@axe-core/playwright 4.13.0`, `@types/node 22.20.4`.

## Decisions
- Actual API shapes override stale design bindings: owned cards = array with per-row `syncedAt` (Q71; count shown as stored rows), targets carry no timestamps (Q72, omitted), latest snapshot may 404 (→ "no model"), no dismiss endpoint (Q70).
- Main bundle imports schema types only; zod master validation + engine live in the worker chunk. Master bytes SHA-256 checked against `latest.json`, cached in Cache API `uma-master`, stale versions pruned.
- Fixture mode: `/fixtures/*.json` served/emitted only when `VITE_FIXTURES=1`; production `dist` contains no fixture JSON (checked, `bundle-size.json`). Golden engine context (T08 `loadGoldenContext`, SYNTHETIC blueStatGain + inheritance turns) is only reachable in fixture mode and is labelled on S06/S07; production uses published rules verbatim, unverified flags intact.
- Fit-or-reuse: refit when no v2, master/context/roster-ETag changed, or this browser doesn't know the snapshot's provenance (Q141). Malformed snapshots are reported as malformed (not as legacy/master mismatch); insufficient data is the engine's `InsufficientDataError`, no UI threshold.
- Q142: own-unique/unknown skills validated against the selected trainee in S06; "rank without them (this run only)" never edits the stored target; the target editor does not ban uniques.
- Q74/Q76: S07 shows snapshot aggregates plus transient FitReport holdout coverage/bias and skill-cell diagnostics from a fit in this tab; no scatter points are drawn; per-skill n is not inferred.
- Cancellation: `EngineClient` terminates the worker on cancel/supersede/reconfigure and replays configure on a fresh worker; screens additionally bump a run id so a late fit/store after cancel/unmount is dropped. Rank duration uses a monotonic clock (`performance.now`), separate from the injected model date.
- Deck drafts and planner settings are local, mode-namespaced (Q77); golden/copied decks may have 0 or 1 borrowed slot anywhere; the S04 builder keeps slot 6 Friend.

## Deviations from spec
- Design bindings' training-v1 wording replaced by training-v2 (ADR-0002, per task card).
- S07 predicted-vs-actual scatter replaced by an honest "unavailable" note + aggregates (Q74).
- S03 `D` (dismiss) and S07 "Run calibration" are disabled with explanations (Q70, T15 not implemented).
- `apps/web` imports `packages/engine/scripts/golden-context.ts` by relative path (browser-safe, not in the package exports) for the fixture context only; no engine edit.

## Cross-task edits
- `pnpm-lock.yaml` — exact pins above only. No API/schema/engine/master/fixture/golden files changed.

## Verification
Node `v25.9.0`, pnpm `11.22.0`. Full logs: `docs/changelog/assets/T13/{workspace-lint,workspace-typecheck,workspace-test,web-build,web-e2e}.log`, summary `gates.json` (all exit 0).
```
$ pnpm test          (workspace)
packages/schema       Tests 149 passed (149)
packages/master-data  Tests  82 passed (82)
apps/api              Tests 111 passed (111)
packages/engine       Tests 240 passed (240)
apps/web              Tests  94 passed (94)   (8 files)
$ pnpm lint / pnpm typecheck      → all 5 projects Done, exit 0
$ pnpm --filter web build
dist/assets/engine.worker-CvyqFKaj.js  162.20 kB
dist/assets/index-xZoPOzG9.css          27.38 kB │ gzip:   5.86 kB
dist/assets/index-B-5YzKpV.js          461.20 kB │ gzip: 140.45 kB
  → main JS+CSS gzip 144,535 B ≤ 250,000 B budget (worker excluded); fixture JSON in dist: none
$ pnpm --filter web e2e
AXE S01-light: serious/critical=0; all=1
REAL BROWSER 260 ranking: 2137 ms (fit+click+render wall 2474 ms)
AXE S06-light: serious/critical=0; all=2
REAL BROWSER 260 ranking: 2348 ms (fit+click+render wall 2453 ms)
AXE S03-empty-light: serious/critical=0; all=1
AXE S01-roster-dark: serious/critical=0; all=1
AXE S03-review-dark: serious/critical=0; all=1
REAL BROWSER 260 ranking: 2120 ms (fit+click+render wall 2471 ms)
AXE S06-planner-dark: serious/critical=0; all=2
REAL BROWSER 260 ranking: 2074 ms ...   2075 ms ...
  ✓ fixture smoke, real Comlink ranking/cancel/recreate, both-theme axe and all seven exports (27.1s)
AXE S03-populated-light: serious/critical=0; all=0
  ✓ S03 MOCK HTTP keyboard 1/2/3 J/K/D and populated axe light
AXE S03-populated-dark: serious/critical=0; all=0
  ✓ S03 MOCK HTTP keyboard 1/2/3 J/K/D and populated axe dark
  3 passed (32.5s)
```
- Real browser (Playwright Chromium, real Worker/Comlink, SYNTHETIC golden fixtures, 260 veterans): 32,667 legal pairs, fast pass + MC top-100, 2.07–2.35 s; top pair = planted best pair `01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2` (`browser-ranking.json`), trap pair not in top 10; zero `/api/` requests in fixture mode; no page errors.
- The S03 populated keyboard flow and S04 populated cards run against **Playwright MOCK HTTP** (route interception, labelled in-page "TEST MOCK HTTP"); this is not a live API or Cloudflare Access check.
- Screenshots (1440×900 light+dark for S01–S07, 390×844 light for S01–S07, plus MOCK S03/S04) in `docs/changelog/assets/T13/`; axe JSON per run alongside. Compared by eye against `docs/design/screens/*` (approved H5): layout, nav, tokens and components match; content differs where real engine/fixture data or the deviations above apply. An automated side-by-side sheet was not generated (no image library available; not installed to avoid global changes).
- Fixture dev server smoke also done interactively (`VITE_FIXTURES=1 vite --port 5199`) across all routes earlier in the task.

## Open questions / follow-ups
- No new OPEN_QUESTIONS entries were needed (Q160–179 reserved, unused); existing Q70/Q71/Q72/Q74/Q76/Q77/Q141/Q142 decisions applied as above.
- Follow-up: per-veteran holdout points need an engine FitReport extension (Q74) before S07 can draw a scatter.
- Follow-up: T15 calibration, review dismiss endpoint (Q70).
- Follow-up: the golden-context relative import should become a proper engine export if fixture mode is kept long-term.
- Follow-up: production run against the real deployed API/Access was not performed here.
