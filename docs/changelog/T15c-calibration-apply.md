# T15c — Explicit browser-local calibration apply/refit

- **Status:** Done for the 62 scope (synthetic fixture and production-placeholder contexts in a real browser). Partial for milestone acceptance: H4 real-roster, native-agent, live-API and cross-device checks are absent (see Open questions).
- **Branch:** task/T15c-calibration-apply
- **Agent / model:** direct implementation, no delegation, subworkers or model CLIs. Claude Opus 5.5 medium (commits 33199ef, 3adc7ec, 5e0ec0f) → Opus HTTP 429 → coordinator-approved fallback Sol 6.1 medium (Web Locks, full schema validation, reset rollback, stale-job guards, extra e2e steps; uncommitted while Sol ran) → Sol stopped without a final report after its last browser gates exited 0 → Opus 5.5 medium resumed, inspected the Sol work, committed it unchanged as 13309bc/6d2f9dd, ran the final gates and wrote this changelog.
- **Date:** 2026-10-08

## Summary
S07 "Apply suggested multipliers" is enabled only for a current report whose `stats.status` is `suggested` with an actual producer blueStatGain proposal that changes the rules. A confirmation dialog shows the old and new absolute tables, the unverified source and the browser-only storage. "Fit and apply" fits a candidate model in a separate, isolated engine worker. Only when that fit succeeds and the confirmed report/override revision is still current does a synchronous commit store the local model envelope, then compare-and-swap the override record, both under an exclusive cross-tab Web Lock. Health, Planner and the footer then use the new effective-context SHA-256 identity. A model fitted under an override lives only in this browser: it is never POSTed to or read from `/model-snapshots`, and the worker refuses to rank with a snapshot fitted under another context. Reset (revision-bound, labelled "fixture base" vs "published rules") clears this mode's override, local model and fit provenance, or leaves everything as it was if a step fails. The T15b carried findings S1/S2/N1/N3 are fixed.

## Files
Created:
- `apps/web/src/lib/digest.ts` — synchronous canonical JSON (sorted keys, non-finite refused) and SHA-256 (FIPS 180-4), `digestOf` → `sha256:<hex>`. An identity, not a secret.
- `apps/web/src/lib/rulesOverride.ts` — versioned envelopes `uma-browser-rules-override` v1 and `uma-browser-local-model` v1, mode keys `uma:<api|fixture>:rules-override[-model]`, validation with visible reasons, `ModelSnapshot` schema validation (Sol), exact-string CAS write with read-back, `checkOverrideFor`, `localModelMismatch`.
- `apps/web/src/app/rulesSession.ts` — exact stored override string via `useSyncExternalStore`; same-tab notify, other-tab `storage` event, `UNREADABLE` sentinel.
- `apps/web/src/app/rulesApply.ts` — `applyEligibility`, `applyProposal` (isolated candidate worker, authority rechecks after every await, synchronous commit with rollback), `resetOverride`.
- `apps/web/src/app/rulesLock.ts` (Sol) — `withRulesLock`: exclusive `navigator.locks` `uma:<mode>:rules-transaction`; refuses a durable browser write when Web Locks are missing.
- `apps/web/test/t15c-provenance.logic.test.ts`, `t15c-worker.test.ts`, `t15c-apply.test.tsx`, `t15c-lock.test.ts` (Sol).
- `apps/web/e2e/apply.spec.ts` — real-browser workflow (two tests).
- `docs/changelog/assets/T15c/` — evidence; `README.md` there indexes which model/run produced each folder.

Modified:
- `apps/web/src/workers/engine.api.ts` — atomic `configure` (ctx and info replaced together, T15b N1); optional `WorkerOverride` applied with `withBlueStatGainTable` (absolute table, `verified:false`, equals `withBlueStatGainMultiplier` on the same values, tested); `ContextInfo` gains `fingerprint`, `baseFingerprint`, `baseRulesVersion`, override; `fit` returns `contextFingerprint`; `rank` takes `SnapshotProvenance` and throws `ProvenanceMismatchError` for another context.
- `apps/web/src/workers/client.ts` — `rank(snapshot, input, roster, target, opts, provenance, cb)`.
- `apps/web/src/app/engine.ts` — `useEngineContext` keyed on master identity + exact override string (`gcTime: 0`); `ensureModel` uses server snapshots only for the base context with FitRecord v2, local envelopes under an override, Web Lock around local saves (Sol).
- `apps/web/src/app/services.ts`, `createServices.ts` — candidate engine factory.
- `apps/web/src/lib/model.ts` — FitRecord v2 (effective fingerprint, roster ETag + SHA-256 content identity); v1/unknown records force a refit.
- `apps/web/src/lib/calibration.ts` — SHA-256 roster identity; provenance includes the context fingerprint, so same `rules.version` with different values is stale.
- `apps/web/src/screens/Health.tsx` — override status/problem/clear/reset, effective rules table with sources, apply dialog/running/cancel/result, browser-local model origin, owned-job cancel, refit liveness bound to provenance (Sol), T15b S1/S2 labels.
- `apps/web/src/screens/Planner.tsx` — override notice, provenance on results (`data-snapshot/context/local`), stale results under another context, owned-job cancel (T15b N3), cancel on signature change (Sol).
- `apps/web/src/components/CalibrationReport.tsx` — `ApplyControl` (enabled/disabled reason) replaces the T15b "not yet available" button.
- `apps/web/src/components/Layout.tsx` — footer shows "browser-local (override)" and never reads the server snapshot under a matching override.
- `apps/web/src/fixture-only/services.ts` — fixture-only `__umaFixtureStoredSnapshots` list of ids received by the in-tab MOCK store (evidence; excluded from production by check-dist).
- Tests updated for the new contracts: `harness.tsx`, `calibration.logic`, `model-deck.logic`, `engine-api`, `engine-client`, `planner-health`, `health-calibration`; `e2e/calibration.spec.ts` (Apply now enabled for a current suggestion).
- `docs/OPEN_QUESTIONS.md` — Q-160 added.

## Decisions
- **Browser-local contract (62 §Decision, Q-141/Q-155 for this workflow only):** override = absolute proposed table + source report (id, multiplier, context fingerprint, current table, roster ETag/identity) + base (kind, master, rules version, fingerprint) + `verified:false`, per mode, monotonically increasing `revision`, tombstone (`active: null`) on reset. Local model envelope = snapshot + effective fingerprint + base fingerprint + master + roster ETag + roster content identity + override id.
- **Identity:** `digestOf({scheme, kind, master: digestOf(bundle), rules, syntheticTurns})`. The override's rules carry version `<base>+local-<override ULID>` and a source naming the report, so each application has its own identity even for equal values. This is stricter than value-only identity (a reapply refits rather than reusing), never looser.
- **No compounding:** the proposal is applied as the producer's absolute table relative to the context that generated it. Recalibrating on the applied context selects ×1.00 and Apply is disabled ("the proposal equals the rules in force (×1)").
- **Fit before commit:** the candidate runs in a second `EngineClient`/worker; the active worker and its predictions are untouched until commit. Cancel terminates only the candidate.
- **Commit ordering:** model envelope first, then override CAS; a failed override write restores the previous model and override strings. A failed model write commits nothing.
- **Cross-tab:** exact-string CAS alone races in localStorage, so (Sol) every durable write runs inside one exclusive Web Lock per mode and rechecks the stored string inside it. Without Web Locks a browser refuses the write with a visible message (memory stores in tests run directly).
- **Reset (Sol fix):** removes local model + fit provenance first, then writes the tombstone; any failure restores all three and keeps the previous rules active. Reset forces fresh base provenance (next base use refits).
- **Production:** an override bound to the fixture context, or any mismatch, is shown as a problem and never configures the worker; the published placeholder gives no proposal, so no Apply.
- **Selection authority:** `stats.status === 'suggested'`, non-boundary, actual suggestion with `change`; raw identification is never authority. No auto-apply, no manual rule editor.

## Deviations from spec
- 62 §Explicit confirmation: "Same-tick double actions are guarded synchronously" — guarded by `jobRef` plus disabled controls; additionally serialized by the Web Lock. No deviation.
- 62 §Provenance asks to validate the snapshot envelope "via authoritative ModelSnapshot schema": first Opus implementation only shape-checked; fixed by Sol (RED `sol-schema-red.log`) before the candidate.
- None otherwise.

## Cross-task edits
- T13 files: `Planner.tsx`, `Layout.tsx`, `harness.tsx`, `planner-health.test.tsx`, `model-deck.logic.test.ts`, `lib/model.ts` — provenance/owned-cancel integration 62 requires.
- T15b files: `CalibrationReport.tsx`, `calibration.ts`, `health-calibration.test.tsx`, `calibration.logic.test.ts`, `e2e/calibration.spec.ts` — Apply enabled, SHA-256 identity, S1/S2 labels.
- `fixture-only/services.ts` — evidence list only.
- No engine, schema, API, master, golden, fixture, dependency or spec changes: `git diff --quiet 28d1edc HEAD -- packages apps/api apps/web/fixtures apps/web/public docs/specs pnpm-lock.yaml package.json apps/web/package.json` → exit 0. `apps/web/fixtures/roster.json` sha256 `6a02f360…7911` equals 28d1edc.

## Verification
Node v25.9.0, pnpm 11.22.0, macOS, Chromium via Playwright. All browser results: REAL Worker/Comlink, SYNTHETIC golden fixture context or MOCK HTTP production; no live API, native agent or deployment.

RED/GREEN (logs in `assets/T15c/tdd/`):
```
# Opus — before implementation (worker source restored to HEAD, digest/rulesOverride absent)   red-1.log
 FAIL test/t15c-provenance.logic.test.ts  Error: Failed to resolve import "../src/lib/digest.ts"
 FAIL ... same rules.version but different synthetic values or turns gives a different identity
 FAIL ... recalibrating on the applied context does not compound   expected 0.32000000000000006 to be <= 0.05
 FAIL ... rank refuses a snapshot provenance for another identity  expected 'Error' to be 'ProvenanceMismatchError'
 Test Files  2 failed (2)
      Tests  9 failed | 1 passed (10)
# Opus — GREEN                                                                                  green-1.log
 Test Files  2 passed (2)
      Tests  33 passed (33)
# Opus — UI/session RED (src at HEAD)                                                            red-2.log
 Error: Failed to resolve import "../src/lib/rulesOverride.ts" from "test/t15c-apply.test.tsx"
# Sol — cross-tab lock                                                                           sol-lock-red.log
 Error: Failed to resolve import "../src/app/rulesLock.ts"
# Sol — full ModelSnapshot schema                                                                sol-schema-red.log
 FAIL ... validates the FULL authoritative ModelSnapshot schema before local reuse
 AssertionError: expected { status: 'ok', ... } to match object { status: 'invalid' }
      Tests  1 failed | 23 passed (24)
# Sol — GREEN (lock + provenance + apply)                                                        sol-green.log
 Test Files  3 passed (3)
      Tests  41 passed (41)
# Sol — reset cleanup failure                                                                    sol-reset-red.log
 FAIL ... failed reset storage cleanup retains the previous rules and local model
 AssertionError: expected 'Reset done. The SYNTHETIC golden fixt…' to match /Reset could not clear/
      Tests  1 failed | 14 passed (15)
```

Final candidate gates — Opus resumed, tree at 6d2f9dd (`assets/T15c/final-opus/`, every log ends `EXIT=0`):
```
$ pnpm -r lint        → all 5 projects Done
$ pnpm -r typecheck   → all 5 projects Done
$ pnpm -r test
packages/schema       Test Files  4 passed (4)    Tests  149 passed (149)
packages/master-data  Test Files  3 passed (3)    Tests   82 passed (82)
apps/api              Test Files 13 passed (13)   Tests  111 passed (111)
packages/engine       Test Files 21 passed (21)   Tests  329 passed (329)
apps/web              Test Files 19 passed (19)   Tests  216 passed (216)
$ pnpm --filter web build && pnpm check:dist
dist/assets/engine.worker-DB_1m-VD.js  192.83 kB
dist/assets/index-Dbu--M6G.css          27.62 kB │ gzip:   5.93 kB
dist/assets/index-Ch7hADif.js          614.22 kB │ gzip: 184.61 kB
check-dist: OK — no fixture code or data in the production build
(node zlib default: main 182,788 B gzip ≤ 250 kB; worker 59,676 B, excluded from the budget)
$ pnpm exec playwright test
  18 passed (1.6m)
```
After that run only an e2e code comment, this changelog, `OPEN_QUESTIONS.md` Q-160 and the evidence README changed (no executable code); web lint/typecheck were re-run on the final commit (below).

Real-browser T15c workflow from that run (`final-opus/t15c-browser-run.json`, `e2e.log`):
```
REAL BROWSER calibration (fixture ×1.3 roster): 1345 ms; Selected multiplier ×1.32 (holdout-MAE argmin; stats status suggested).
dialog old 10/20/30 → proposed 13.2/26.4/39.6
REAL Web Locks: isolated candidate fit queued; neither model nor override persisted until other tab released exclusive lock
REAL BROWSER apply (candidate fit + commit): 528 ms; context sha256:979cfd2ef13b… → sha256:2f3f91bc518f…; local snapshot 01M4CCYJ00VDJE9PJV1089D525
Health refit under override → 01M4CCYJ00CM38EYRN5QGNN6FK (local); MOCK store still only the base snapshot [01M4CCYJ00PTYQA903M2PF3F7M]
REAL BROWSER ranking under override: snapshot 01M4CCYJ00CM38EYRN5QGNN6FK, context sha256:2f3f…, local=true
REAL BROWSER recalibration on the applied context: Selected multiplier ×1.00 (no compounding; Apply disabled)
reload → same context and local model reused; local model removed + reload → Planner auto-fit 01M4CCYJ00FFVJQRY2RDWW5P40 (local), nothing stored
reset from tab 2 → tab 1 rankings "ranked under a different rules context"; base rank context sha256:979cfd2e… local=false (fresh base fit)
AXE serious/critical=0 (all=0): S07-apply-dialog-light, S07-applied-light/dark, S06-override-light/dark, S07-reset-dialog-light, S07-production-light/dark
production (MOCK HTTP): fixture-bound stored override refused; nonidentifiable → no Apply; non-GET requests: none
```
Also covered in that test: dialog Cancel, cancel during the candidate (worker script held 4 s), injected `QuotaExceededError` on the override write (labelled fault injection) with rollback and truthful message, no `/api/` request in fixture mode, no page errors. Screenshots desktop 1440×900 / mobile 390×844, light and dark, `scrollWidth ≤ 390`.

Earlier runs kept as history (see `assets/T15c/README.md`): Opus first run top-level assets (18 passed); Sol `sol-continuation`, `sol-final`, `sol-verified`, `sol-candidate` (18 passed each); Sol `sol-acceptance/e2e-failed.log` 1 failed / 17 passed — a test-order bug (stale-report assertion after a reload that clears session reports), fixed in the spec by recalibrating before reset.

## Open questions / follow-ups
- Q-160: browser-local overrides — scope, identity and cross-tab serialization (added).
- Follow-up: a shared persisted rules contract (snapshot rules fingerprint / override sync) needs an ADR; overrides do not sync across browsers or devices.
- Follow-up: browsers without Web Locks cannot apply/reset/save a local refit (refused visibly); not exercised in a real browser lacking the API.
- Follow-up: `QuotaExceededError` was injected, not a real quota event; a real storage-quota test is absent.
- Follow-up: H4 real-roster calibration, native Windows agent and live Cloudflare/API checks are not part of this evidence. Applying a proposal verifies no game fact.
- Follow-up: main bundle carries a Vite >500 kB raw warning (pre-existing; gzip within budget).
- Engine-side dead-warning/type cleanups (T15b review) remain out of scope.
