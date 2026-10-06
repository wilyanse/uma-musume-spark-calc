# T13 — Web screens S01–S07

- **Status:** Review round 1 fixes done (pending independent parent re-review)
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
- `apps/web` imports `packages/engine/scripts/golden-context.ts` by relative path (browser-safe, not in the package exports) for the fixture context only; no engine edit. Since review round 1 the import lives in `src/fixture-only/golden-context.ts`, which production builds replace with a null stub (N3).

## Cross-task edits
- `pnpm-lock.yaml` — exact pins above only. No API/schema/engine/master/fixture/golden files changed.

## Verification
Node `v25.9.0`, pnpm `11.22.0`. Full logs: `docs/changelog/assets/T13/{workspace-lint,workspace-typecheck,workspace-test,web-build,web-e2e}.log`, summary `gates.json` (all exit 0).

> Historical: the block below, the screenshots/axe JSON in `docs/changelog/assets/T13/` and `browser-ranking.json` are the evidence published for the original candidate (62b168f) and are kept unchanged. Since review round 1, `pnpm --filter web e2e` writes to the ignored `apps/web/test-results/e2e-assets/` and never touches them; to export deliberately, set `T13_E2E_ASSETS_DIR=<dir>`. Round-1 evidence is in `docs/changelog/assets/T13/review-r1/` (see "Review round 1").
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

## Review round 1

Review: `docs/reviews/T13-review-1.md` (CHANGES_REQUESTED on 62b168f). Fix commits on the same branch and worktree (no reset/clean/rebase/merge): 5b93592 (tests first, then B1/S1–S4/N1/N2), 3f8e761 (S5/N3/N4 + browser regressions), 4be5a94 (lint), then the changelog/evidence commit. Model: Opus 5.5 medium (primary), written directly in this worktree; no sub-agents. Scope: `apps/web/**` and `docs/changelog/**` only; no API, schema, engine, master-data, fixture, golden or lock-file change (`git diff 62b168f --stat -- apps/api packages pnpm-lock.yaml` is empty).

Tests were written first; the first run of the two new files failed 15 of 17 (`Tests 15 failed | 2 passed (17)`, e.g. B1: `- "Independent Learner" + "epithet:independent-learner"`), then all passed after the fixes.

### Responses

- **[B1] fixed.** New `resolutionFor(path, veteran)` / `searchVocab` in `src/lib/paths.ts` decide what a resolution sends, per leaf, mirroring the API's `correctionTarget` (apps/api/src/checks.ts) and the 01 §3 types: `/epithet` searches the epithet vocabulary but sends `e.text`; `characterId`/`outfitId` (top level and `/parents/<i>/…`), `/skills/<i>/skillId`, `/sparks/<i>/sparkId`, `/scenarioId`, `/deck/<i>/cardId` send IDs; `/rank`, `/parents/<i>/guestTrainer`, `/career/dateAcquired` are free text; stats/rating/career numbers/`lb`/`level`/`stars` are bounded numbers; aptitudes are grades; `borrowed`/`isGuest` are booleans; `/trainMode`, `…/owner`, `…/type`, `…/slot`, whole arrays/elements and unknown paths are `none` (candidates only). The old "Use the number" option is replaced by a typed value input (`ManualValue`). Tests: `test/review-fix1.test.tsx` (exact POST args `[id, "Independent Learner"]`; ID leaves; immutable leaves), `e2e/review-fix1.spec.ts` (keyboard flow, exact request body `{ value: "Independent Learner" }`).
  Real local API (see below): epithet-sourced veteran A went from `{"epithet":"Trickster","trainMode":"manual","modeSource":"epithet"}` to `{"epithet":"Independent Learner","trainMode":"independent","modeSource":"epithet"}`; overridden veteran B went from `{…"trainMode":"manual","modeSource":"override"}` to `{"epithet":"Independent Learner","trainMode":"manual","modeSource":"override"}` (override kept, as the API's resolve route does).
- **[S1] fixed.** The resolve mutation and its failure message moved to `ReviewScreen` (`resolveFailureText`); the banner (`role="alert"`, with a "Dismiss message" button) survives the queue refetch that unmounts the item panel. 404 is treated as stale too. A later successful resolve clears it. Tests: 409 (item vanishes → "Review item is already resolved. The queue was refreshed.") and 404 (next item stays usable by keyboard, success clears the alert) in Vitest; 409 by keyboard in Playwright (both themes); real local API: out-of-band resolve 200, then `1` in the UI → API 409, alert `["Review item is already resolved. The queue was refreshed. Dismiss message"]`, A's item gone from the queue (screenshot `review-r1/probe-409-alert.png`).
- **[S2] fixed.** `src/api/http.ts`: a `redirected` response, or an HTML body with 2xx/401/403, throws `AuthRedirectError` → the copy.md `error.auth` text; HTML 5xx stays an `HttpError` (generic text) with `problem: null`; a non-parsable JSON body throws `MalformedResponseError` (its own text — new UI copy, copy.md has no key for it). Bodies are never put into error messages. `credentials: 'include'` unchanged and asserted. Tests: `test/http-auth.test.ts` (6 cases incl. no-leak checks); Playwright MOCK HTML on `/api/v1/**`; real local API: `/api/v1/roster` rerouted to the real SPA fallback (`200 text/html; charset=utf-8`) → auth text shown, generic text count 0.
- **[S3] fixed.** Mode radios are `disabled` while the PATCH is pending (and `setMode` ignores calls while pending); `onSettled` invalidates both `['veteran', id]` and `['roster']`. Tests: Vitest (deferred PATCH; second click sends nothing; both keys invalidated), Playwright keyboard (ArrowLeft → both radios disabled until the gated PATCH completes, one PATCH), real local API with a 1.5 s delayed PATCH: `{"independent":true,"manual":true}` disabled, then label "Train mode (overridden)", server `{"trainMode":"manual","modeSource":"override"}`, exactly one PATCH.
- **[S4] fixed.** Spark vocabulary is offered only for `/sparks/<i>/sparkId`, filtered to the slot's recorded type (e.g. a white slot never lists the blue "Speed"); `/sparks/<i>/stars` is a number input 1–3 with no vocabulary; `type`/`owner` are never correctable here. Tests: `searchVocab` type filter for white and blue slots; the S03 screen for a white slot and for stars ("Enter a whole number from 1 to 3." on 7).
- **[S5] fixed.** `e2e/*.spec.ts` write to `apps/web/test-results/e2e-assets` (gitignored) unless `T13_E2E_ASSETS_DIR` is set. Verified: SHA-1 of every file under `docs/changelog/assets/T13/` taken before two full e2e runs is identical afterwards (`diff` empty). The historical evidence is labelled as such above and was not regenerated.
- **[N1] fixed (no engine edit).** Health shows `min confidence ≥ ${MIN_CONFIDENCE}` from the worker's `configure` result (the engine's exported `MIN_CONFIDENCE`; falls back to "high-confidence rows only"). The insufficient-data copy repeats the engine's own requirement clause parsed from `InsufficientDataError.message` (`need ≥ 5 train rows (5-fold CV) and ≥ 1 holdout row`), with a generic fallback. The coverage band stays the published 50 §9 / 70 F08 band (`COVERAGE_BAND`, 0.72–0.88) and is now labelled "F08 acceptance band". Tests: `engine-api.test.ts` (real engine: `minConfidence === MIN_CONFIDENCE`; requirement is a substring of the real message), `planner-health.test.tsx`.
- **[N2] fixed.** Neither 01 §3 (`level: number`, min 1) nor master data has a card level cap, so the bound comes from the approved S04 design (`<input min=1 max=50 value=50>`, LB4 selected) and is documented as a UI bound (`FRIEND_LEVEL_MAX`, `FRIEND_DEFAULT`). The Friend level input is `type=number min=1 max=50`, out-of-range text shows "Enter a level from 1 to 50." and is never stored; the slot shows "Defaults LB4 · Lv50 — edit to match the friend's card." Owned and non-owned cards can both be the borrowed Friend (`borrowed: true`, slot 6). Test in `review-fix1.test.tsx`.
- **[N3] fixed.** Fixture wiring (`fixtureSource` + golden-truth loader) moved to `src/fixture-only/services.ts` and T08's `loadGoldenContext` import to `src/fixture-only/golden-context.ts`. A Vite `resolveId` plugin (main and worker builds) swaps each for its `*.disabled.ts` null stub unless `VITE_FIXTURES=1` or Vitest is running; the worker refuses `golden-fixture` with `NotConfiguredError` when the stub is in. `pnpm --filter web check:dist` (`scripts/check-dist.mjs`) scans the build for the markers `(fixture mode)`, `/fixtures/golden-truth.json`, `syntheticInheritance` and any `fixtures/*` file: production `dist` → none (exit 0); a fixture build (scratch outDir) → all present (`--expect-fixtures` exit 0), and the production check against it fails (exit 1, negative control).
- **[N4] fixed.** The fixture notice is an `<aside aria-label="Fixture mode notice">` (landmark; fixes `region`), and the S06 pair-detail headings are `h2` (after the page `h1`; fixes `heading-order`, same CSS). Every axe run in the e2e now reports 0 violations of any impact (S01/S03/S06 light+dark, populated S03 light+dark): `review-r1/rerun-*-axe.json`, `review-r1/fix1-*-axe.json`.

### Verification (round 1, exact output)
```
$ pnpm -r lint        → exit 0          $ pnpm -r typecheck → exit 0
$ pnpm -r test        → exit 0
packages/schema test:       Tests  149 passed (149)
packages/master-data test:  Tests  82 passed (82)
apps/api test:              Tests  111 passed (111)
packages/engine test:       Tests  240 passed (240)
apps/web test:              Tests  113 passed (113)   (10 files; was 94 in 8)
$ pnpm --filter web build
dist/assets/engine.worker-oeCLiUZV.js  161.69 kB
dist/assets/index-BTZ17_Gg.css          27.38 kB │ gzip:   5.86 kB
dist/assets/index-diIhRFOl.js          464.47 kB │ gzip: 141.28 kB
  gzip -9: JS 139,621 B + CSS 5,805 B = 145,426 B ≤ 250,000 B (worker excluded)
$ pnpm --filter web check:dist
  "fixtureFiles": [], markers all [] → check-dist: OK — no fixture code or data in the production build
$ pnpm --filter web e2e      (real Chromium; assets → apps/web/test-results/e2e-assets)
AXE fix1-S03-light: none                AXE fix1-S03-dark: none
  ✓ MOCK HTTP S03 keyboard: epithet text body (B1), 409 stale alert after refresh (S1), axe light/dark
  ✓ MOCK HTTP S2: an HTML login redirect on an API call shows the auth message, not "Something went wrong"
  ✓ MOCK HTTP S3: mode radios are disabled while the PATCH is pending (keyboard)
AXE S01-light: serious/critical=0; all=0
REAL BROWSER 260 ranking: 2111 ms (fit+click+render wall 2474 ms)
AXE S06-light: serious/critical=0; all=0
REAL BROWSER 260 ranking: 2164 ms (fit+click+render wall 2442 ms)
AXE S03-empty-light / S01-roster-dark / S03-review-dark: serious/critical=0; all=0
REAL BROWSER 260 ranking: 2144 ms ... 2001 ms ... 2053 ms
AXE S06-planner-dark: serious/critical=0; all=0
  ✓ fixture smoke, real Comlink ranking/cancel/recreate, both-theme axe and all seven exports (26.6s)
AXE S03-populated-light / -dark: serious/critical=0; all=0
  7 passed (36.2s)
  top pair (rerun-browser-ranking.json) = 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2 (planted best pair)
```
Logs: `docs/changelog/assets/T13/review-r1/{workspace-lint,workspace-typecheck,workspace-test,web-build,web-e2e,check-dist-production,check-dist-fixture-build}.log`.

**Local real API (not live Cloudflare/Access).** Production `apps/web/dist` served by `wrangler dev --local --ip 127.0.0.1 --port 8799 --persist-to <scratch> --var AUTH_DISABLED:1 --var MASTER_VERSION:global-20260930` (real API routes, local D1/R2 after `wrangler d1 migrations apply DB --local`, 3 migrations), never deployed, no credentials. Seeded through the real `POST /veterans` with 20 golden roster rows (SYNTHETIC): `{"attempted":20,"accepted":18,"rejected":2}` (2 rejected by the API's parent-spark rule). Runnable sources kept in the repo: `review-r1/seed.mts`, `review-r1/probe.mjs` (`T13_PROBE_BASE`, `T13_PROBE_OUT`; outputs default to the cwd). Output (`review-r1/probe.log`, `probe-result.json`, server log `wrangler.log`):
```
before.A {"epithet":"Trickster","trainMode":"manual","modeSource":"epithet"}
before.B {"epithet":"Trickster","trainMode":"manual","modeSource":"override"}
after.A {"epithet":"Independent Learner","trainMode":"independent","modeSource":"epithet"}
after.B {"epithet":"Independent Learner","trainMode":"manual","modeSource":"override"}
resolvePosts [".../resolve 200 {\"value\":\"Independent Learner\"}", ".../resolve 200 {\"value\":\"Independent Learner\"}"]
outOfBandResolve 200
alertAfter409 ["Review item is already resolved. The queue was refreshed. Dismiss message"]
openItemsForA []
disabledWhilePending {"independent":true,"manual":true,"seenAfterMs":13}
afterPatch {"modeLabel":"Train mode (overridden)","server":{"trainMode":"manual","modeSource":"override"}}
patchReqs ["PATCH /api/v1/veterans/01M48GN5X19EVXKQ1M4056Q2KM 200 {\"trainMode\":\"manual\"}"]
spaFallback {"status":200,"contentType":"text/html; charset=utf-8"}
authTextShownForHtml true
genericShown 0
pageErrors []
wrangler.log: POST …/resolve 200 OK ×3, POST …/01M48GN5X112E6ES50H2WT43P2/resolve 409 Conflict, PATCH … 200 OK ×2
```
(`queueGutButtonsAll_isVeteranB 1` in the log is veteran B's still-open `/stats/gut` item, not A's.) The wrangler server was stopped afterwards (no listener on :8799).

What is mock vs real: Vitest screen tests use a MOCK `DataSource`; `http-auth.test.ts` uses an in-test fetch double; the `review-fix1.spec.ts` and the S03/S04 populated e2e flows use Playwright MOCK HTTP; the planner ranking e2e uses the real engine in a real Worker on SYNTHETIC golden fixtures; the probe above uses the real API code locally. Nothing here was checked against live Cloudflare or Access.

Unchanged: calibration stays disabled (T15) and dismiss stays unavailable (Q-70); the other screens' acceptance behaviour is unchanged. Pre-existing tests were kept; edits to them only add assertions (`engine-api.test.ts`: `minConfidence`, `requirement`; `planner-health.test.tsx`: F08 label, new MIN_CONFIDENCE case, `requirement` on the insufficient-data mock and its expected text). The S06 detail headings changed from `h4` to `h2` with the same `.detailgrid` rule (visually identical in the rerun screenshots).

