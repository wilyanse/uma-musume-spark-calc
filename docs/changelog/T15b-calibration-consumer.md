# T15b — Browser calibration diagnostics

- **Status:** Done for the 61 scope (synthetic and published contexts in a real browser). Partial for milestone acceptance: H4 real-roster, native and live checks are absent, and explicit apply/refit is T15c.
- **Branch:** task/T15b-calibration-consumer
- **Agent / model:** Claude Opus 5.5, medium reasoning (direct implementation; no delegation, subworkers or fallback)
- **Date:** 2026-10-08

## Summary
S07 "Run calibration" now runs the real `calibrateRules` in the engine worker through Comlink. It works without a model snapshot. The engine-local `CalibrationReport` is shown field by field, read-only, for this tab session until the user dismisses it. Calibration and refit share one active-job authority, guarded synchronously against same-tick clicks. Each run records its provenance (context kind, master and rules versions, roster ETag and a content identity). A late reply for changed inputs is refused, and a finished report whose inputs changed is labelled stale, never current. Cancel, crash and typed errors show accessible text and a Retry that calls the real worker again. The display covers the r4 S1 selection gate, full vs conditional aptitude likelihood with its denominators, null shown as "unavailable", conditional bootstrap, synthetic vs production placeholder rules, unsupported rules, and unapplied proposals. Apply is disabled and names T15c.

## Files
Created:
- `apps/web/src/lib/calibration.ts`: pure helpers. `fmtNum` (null or non-finite → "unavailable", never 0 or `toFixed(null)`); `selectionView` (the selection authority is `stats.status` plus its reasons, with a raw-identified conflict flag); `rosterIdentity` (FNV-1a over the roster JSON; content identity, not a security hash); `provenanceOf`, `staleReasons`, `provenanceKey`.
- `apps/web/src/app/calibration.ts`: in-memory session slot keyed by the app's `EngineClient` (a `WeakMap` with `useSyncExternalStore`). It survives route changes and is never written to storage, the API or a query cache.
- `apps/web/src/components/CalibrationReport.tsx`: S07 report view built from the actual `CalibrationReport` fields.
- `apps/web/test/calibration-worker.test.ts`: REAL `calibrateRules` through `createEngineApi` (in-process; structured-clone semantics).
- `apps/web/test/calibration-client.test.ts`: `EngineClient.calibrate` with a labelled FAKE worker. Covers cancellation, supersession with fit in both directions, crash, reconfigure, late replies and serializable arguments.
- `apps/web/test/calibration.logic.test.ts`: helper branches.
- `apps/web/test/health-calibration.test.tsx`: S07 states. Base reports are REAL engine output from `beforeAll`; the `FAKE:` cases are labelled edits of that output that reach specific render branches.
- `apps/web/e2e/calibration.spec.ts`: real browser Worker/Comlink workflow and evidence.
- `docs/changelog/assets/T15b/`: 18 PNGs, 5 axe JSONs and 3 report text/summary files from the real browser run.

Modified:
- `apps/web/src/workers/engine.api.ts`: `calibrate(roster, { nowIso, id? })` calls `calibrateRules` on the configured context. It returns `{ report, context }`, where `context` is the run provenance captured in the worker at call time (`kind`, `synthetic`, versions, unverified/placeholder rules, overrides). A bad clock gives `ModelInputError` `bad-now`; a non-ULID id gives `bad-id`. The worker keeps `ContextInfo` together with `ctx`.
- `apps/web/src/workers/client.ts`: `EngineClient.calibrate` uses the existing `run()` generation/terminate mechanism. No callback is passed.
- `apps/web/src/screens/Health.tsx`: Run calibration, running/cancel/retry/refused/error states, shared `jobRef` authority with Refit, owned-job unmount cancel, stale authority and the report panel. The rules-table scroll region became a focusable labelled region (axe `scrollable-region-focusable`).
- `apps/web/src/styles/app.css`: a few `.calib` layout rules (wrapping, list and heading spacing). No tokens changed.
- `apps/web/test/harness.tsx`: `fakeEngine` accepts a scripted `calibrate`. This is the minimal test-double interface update.
- `apps/web/test/fixtures.ts`: `calibrationRoster()` reads the committed `packages/engine/test/golden/roster.calibration-x1.3.json` (read-only).
- `apps/web/test/planner-health.test.tsx`: the T13 assertion "Run calibration is disabled" now expects it to be enabled once roster and context are ready (61).

## Decisions
- **Report contract (61 over the prototype):** shown fields are the actual `CalibrationReport` ones. The prototype's "multiplier / log-likelihood / Brier" summary is replaced by named sections: population/split, stats, aptitude, skills, suggestions, not-calibrated rules and engine warnings.
- **Selection authority:** "Selected multiplier" only when `stats.status` is `suggested` or `boundary` with a selection. Otherwise the panel says "No multiplier selected: stats status X" and lists the engine's reasons. `stats.identification.status` appears only under "Identification diagnostic (numeric)", with the text "Identified means numerically non-collinear, not well-determined or precise". When it reads `identified` while selection is blocked, a separate note says the stats status is the authority (r4 S1 mitigation in the consumer; the producer still lacks a `selectionGate` field).
- **"complete" label:** always followed by "means every check could run (checks available); it is not verified mechanics, not real-roster acceptance and not a milestone sign-off".
- **Clock and id:** the UI passes `services.now().toISOString()` and a ULID from that time (`lib/ulid.ts`), as plain data. The engine uses the id for the candidate refit snapshots and validates it as a ULID. A non-ULID id made every candidate refit fail silently, turning the report `partial` with skills `insufficient-data`; this was found in this task's RED run. The worker now rejects it up front (`bad-id`), test first.
- **Split:** the worker passes no split, so the engine's seeded default (`t15-holdout`) is used. The stored golden split lives in truth.json and is deliberately not passed from the browser. The T15 changelog reports this seeded ×1.3 variant as 1.32 (train-CV 1.32, bootstrap 1.29/1.32/1.36), and the worker and browser reproduce it.
- **Fixture ×1.3 in the browser:** fixture mode serves only the base roster. The e2e serves the committed, unchanged engine golden file `roster.calibration-x1.3.json` as `/fixtures/roster.json` (bytes passed through `page.route`). The golden context comes from the app's existing `golden-truth.json` → `syntheticInheritance` loader. The planted multiplier, `latent` and `calibration` are never inputs; a worker test poisons them and shows the report is identical.
- **Stale vs refused:** a finished report whose provenance differs from the current inputs stays visible, labelled "Stale report: <reasons> …" (`data-stale="true"`). It is never relabelled current. A run whose inputs change while it runs is terminated, its reply discarded, and the reason shown. A reconfigure (master or context change) cancels the worker inside `EngineClient.configure`, and the UI reports "the engine was reconfigured or another engine job started". A reply whose kind/master/rules differ from the run provenance is refused.
- **Exclusivity:** a synchronous `jobRef` covers calibrate and refit. Same-tick double clicks start one job, and Refit is refused while calibration runs and vice versa. The buttons are also disabled. Unmount cancels only the job this screen owns: another screen's worker job survives a Health mount/unmount.
- **No progress:** the running state is indeterminate text ("Calibrating… The engine reports no progress, so no estimate is shown") plus "Cancel calibration". There is no percentage and no progressbar.
- **Session-only:** the report lives in memory keyed by the engine client. Dismiss clears it. Nothing goes to local/session storage, the fit record, a snapshot, the API or the model/roster query caches. Refit is unchanged and does not clear the report.
- **Apply:** shown only when a suggestion exists, always `disabled`, and `aria-describedby` the text "Rule override/apply-and-refit integration not yet available (separate task T15c)…". With no suggestion (production) the button is absent. No apply/override/persistence endpoint was invented.
- **Errors:** typed engine errors map to "Calibration failed: …". `ModelInputError` shows its code; others go through `engineErrorText`. Empty, insufficient, partial and nonidentifiable reports are rendered as reports, not errors.

## Deviations from spec
- None in behaviour. Evidence note: the app scrolls inside `main.content`, so the `-full.png` captures temporarily grow the viewport height to the content height. The plain `.png` files are true 1440×900 / 390×844 viewports.

## Cross-task edits
- `apps/web/test/harness.tsx` (T13): `fakeEngine` gained an optional scripted `calibrate` (test double only).
- `apps/web/test/planner-health.test.tsx` (T13): one assertion flipped from disabled to enabled Run calibration, as 61 requires.
- `apps/web/src/screens/Health.tsx` rules table (T13 code, S07 owned here): `tabIndex={0} role="region" aria-label` on the scroll wrapper. axe had never been run on S07 before; T13 ran S07 axe on neither theme. With the full report present, axe reported `scrollable-region-focusable` (serious) on this wrapper, plus `heading-order`/`landmark-unique` (moderate), all now fixed.
- No engine, schema, API, master, golden or fixture changes. `git diff --quiet 93d2897 HEAD -- packages apps/api apps/web/fixtures apps/web/public docs/specs` exits 0, and the fixture hashes are unchanged (below).

## Verification
Node v25.9.0, pnpm 11.22.0, macOS. Scratch logs: `~/.hermes/cache/scratch/t15b/`.

RED (before implementation):
```
$ pnpm exec vitest run test/calibration-worker.test.ts test/calibration-client.test.ts      # red1.log
 Test Files  2 failed (2)
      Tests  14 failed (14)
$ pnpm exec vitest run test/calibration.logic.test.ts   (helper module absent)             # red2.log
Error: Failed to resolve import "../src/lib/calibration.ts" from "test/calibration.logic.test.ts". Does the file exist?
      Tests  no tests
$ pnpm exec vitest run test/health-calibration.test.tsx                                    # red3.log
      Tests  17 failed | 1 passed (18)
```
GREEN steps:
```
$ pnpm exec vitest run test/calibration-worker.test.ts test/calibration-client.test.ts     # green1.log
      Tests  14 passed (14)
$ pnpm exec vitest run test/calibration-worker.test.ts --reporter=verbose
[T15b worker] x1.3 seeded: complete/suggested m=1.32 trainCv=1.32 boot=1.29/1.32/1.36 split=156/40
[T15b worker] production: partial/nonidentifiable apt=uninformative/zero-probability-observed impossible=87 reasons=4
$ pnpm exec vitest run test/health-calibration.test.tsx   (first UI pass)                  # green3a.log
      Tests  5 failed | 13 passed (18)
  -> found: non-ULID test ids made candidate refits fail (report partial / skills insufficient-data);
     added the failing worker test "rejects a report id that is not a ULID" first:
AssertionError: expected 'ok' to be 'ModelInputError:bad-id'
$ ... after the bad-id guard and wording fixes                                            # green3b.log, web-all-1.log
      Tests  1 failed | 25 passed (26)  ->  Tests  163 passed (163)
```
Workspace gates (final tree):
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test                                        # gates.log, exit 0
packages/schema test:       Tests  149 passed (149)
packages/master-data test:  Tests  82 passed (82)
apps/api test:              Tests  111 passed (111)
packages/engine test:       Tests  329 passed (329)   (21 files)
apps/web test:              Tests  164 passed (164)   (15 files)
```
Scoped web build and fixture exclusion (no recursive build):
```
$ pnpm --filter web build
dist/index.html                          0.39 kB │ gzip:   0.26 kB
dist/assets/engine.worker-mAKOxnxe.js  187.83 kB          (gzip -c | wc -c: 57600 bytes)
dist/assets/index-Dbu--M6G.css          27.62 kB │ gzip:   5.93 kB
dist/assets/index-C7Eqiyq1.js          480.82 kB │ gzip: 146.20 kB
$ pnpm --filter web check:dist
check-dist: OK — no fixture code or data in the production build
```
The main bundle is 146.20 kB gzip, within the 250 kB limit (T13: 141.43 kB; +4.8 kB). Engine strings stay out of the main bundle: "holdout-row resampling" and "design-confounded" each occur 0 times in index-*.js and once in engine.worker-*.js. Main-thread `@uma/engine` imports are type-only; the only value imports are in `workers/engine.api.ts`.

Browser (real Vite worker + Comlink + `calibrateRules`; Chromium via Playwright 1.62.1):
```
$ T15B_E2E_ASSETS_DIR=../../docs/changelog/assets/T15b pnpm exec playwright test e2e/calibration.spec.ts
REAL BROWSER calibration (fixture ×1.3 roster): 1918 ms; selection: Selected multiplier ×1.32 (holdout-MAE argmin; stats status suggested).
AXE S07-calibration-fixture-light: serious/critical=0; all=0
AXE S07-calibration-fixture-dark: serious/critical=0; all=0
AXE S07-calibration-stale-light: serious/critical=0; all=0
  ✓  1 … fixture: real worker calibrates the unchanged ×1.3 roster; cancel/retry/navigation/stale; axe + screenshots (5.8s)
REAL BROWSER calibration (production placeholder, API-mode MOCK HTTP): 133 ms; selection: No multiplier selected: stats status nonidentifiable. no train row's E[inh] depends on blueStatGain CV fold(s) 0, 1, 2, 3, 4 do …
AXE S07-calibration-production-light: serious/critical=0; all=0
AXE S07-calibration-production-dark: serious/critical=0; all=0
  ✓  2 … production (API mode, MOCK HTTP): published placeholder rules give nonidentifiable diagnostics; axe both themes (2.6s)
  2 passed (10.9s)
$ pnpm e2e        (all specs, existing T13 suites included)                                   # e2e-full.log
  16 passed (59.5s)
```
The fixture e2e exercises, in order:
1. Run, then Cancel calibration ("Calibration cancelled."), then Retry.
2. Navigation to Targets while running. The owned job is cancelled; returning shows "hasn't been run", and nothing paints late.
3. A real run in [1.2, 1.4] with status complete, a SYNTHETIC banner, the "checks available, not verified" text, Apply disabled with the T15c text, and still "No model yet" (no model stored).
4. Axe in both themes, then desktop/mobile light/dark screenshots with no horizontal overflow at 390 px.
5. A train-mode override through the MOCK fixture PATCH on Veteran detail. Back on Health the same report id shows "Stale report: roster changed" with `data-stale=true`; axe runs on the stale view.
6. Refit still works and leaves the report id unchanged. Dismiss clears only the report.
7. No calib keys in storage, no `/api/` requests and no page errors.

The production e2e checks that no non-GET request is made. Persisted report text is in `docs/changelog/assets/T15b/fixture-x1.3-report.txt` and `production-placeholder-report.txt`.

Read-only inputs:
```
$ git diff --quiet 93d2897 HEAD -- packages apps/api apps/web/fixtures apps/web/public docs/specs && echo unchanged
readonly paths unchanged
$ shasum -a256 packages/engine/test/golden/roster.calibration-x1.3.json apps/web/fixtures/*.json
8982ab4a…5434  roster.calibration-x1.3.json   6a02f360…7911  roster.json
1ccf0d5a…0eb2  golden-truth.json              3e3f8644…0bcf  cm-targets.json     (= T15 r4 hashes)
$ git diff --check 93d2897 HEAD   -> clean
```
Not done or absent: native (Windows), live API/Cloudflare Access, a deployed site, and H4 real-roster acceptance. No game facts were recorded. The ×1.32 is recovery of a planted SYNTHETIC effect, not a real `blueStatGain`.

## Open questions / follow-ups
- No new OPEN_QUESTIONS entries. Existing ones cover the gaps: Q-141 (snapshot rules provenance), Q-155 (no apply/persist contract), Q-159 (identification semantics).
- **T15c:** explicit rule override, apply and refit. This needs a reviewed persisted override contract and a snapshot rules-context fingerprint (Q-141/Q-155). Apply stays disabled until then.
- **T15 r4 S1 (producer side):** add an explicit `selectionGate` / `criterionStatus` to `BlueIdentification`. The consumer already treats `stats.status` as the authority and flags the conflict.
- **T15 r4 S2 and N1:** dead mixed-stat warnings, `Suggestion.confoundedStats` always `[]`, the unreachable `structural-design` basis, the ignored `structural` option, and the suggestion `identification` literal enforced only at runtime. All are engine-side; the consumer neither relies on nor displays them.
- **Engine robustness nit:** a caller-supplied non-ULID `id` makes every candidate refit fail inside `calibrateRules` (the report degrades to partial instead of throwing). The worker validates the id now; the engine itself could validate it in a later engine task.
- **Evidence nit:** S07 had no axe run before this task. T15b covers Health with a report in both themes and the stale view; T13's own S07 screenshots are unchanged.
- **H4 / Q-3 / Q-5:** real-roster calibration, native shell and live API remain pending; nothing here verifies mechanics.
- The UI report id uses `Math.random` for the ULID's random part (display/id only; the time is injected). Engine results do not depend on it.
