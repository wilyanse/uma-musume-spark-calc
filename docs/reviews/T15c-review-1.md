**Verdict: CHANGES_REQUESTED.** There are 2 small blocking findings. Both are UI statements that contradict the state the app actually holds. I found nothing wrong in authorization, provenance, the transaction ordering or the no-upload invariant.

Reviewed candidate ec92f27 against base 28d1edc, read-only. The tree is clean, and my scratch probes in `apps/web/test-results/review-probe` (gitignored) have been deleted.

## Blocking

**B1. The footer says an override model is in use when the override was refused** (`apps/web/src/components/Layout.tsx:51-54`).
- `ModelFooter` decides it is "local" from the stored record's `contextKind` only. It ignores the master-version check (`checkOverrideFor`) and whether the worker rejected the override (`overrideRejected`).
- Probe: I stored an override for `OLD-MASTER` in API mode and loaded the app.
  - Health showed the problem banner: "The stored rules override was not applied: it was applied with master OLD-MASTER … The published rules (rules-1) are in force instead."
  - The worker was configured with `[null]`, so no override.
  - The footer still read "Model: browser-local (override)", and its server-snapshot query was disabled.
- That breaks 62's requirements that labels be explicit and that failure states not misrepresent which model is current.
- Fix: derive the footer from `useEngineContext().data?.override` (worker-confirmed), or apply the same `checkOverrideFor`. Add a test for the refused-override case.

**B2. A double-click on Reset reports "Nothing was reset" after the reset succeeded** (`apps/web/src/screens/Health.tsx:303-316`).
- `confirmReset` has no synchronous guard, unlike `confirmApply`'s `jobRef`.
- Probe: two clicks in the same tick on the dialog's Reset button.
  - Storage ended as `{"status":"none","revision":2,…}`, so the reset worked.
  - The visible note read: "The rules override changed in another tab since you confirmed. Nothing was reset; review the current state and try again."
- 62 requires same-tick double actions to be guarded synchronously.
- Fix: a ref guard set before the `await` and cleared in `finally`, or set reset state to idle synchronously before calling `resetOverride`. Add a same-tick double-click test like the existing Apply one.

## Should-fix

**S1. Random IDs are not injected** (`rulesApply.ts:110`, `Health.tsx:200`).
- Override and report IDs use `ulid(…, Math.random)` directly. 62 says "Inject time/RNG and use deterministic test ids".
- The e2e init script reseeds `crypto.getRandomValues`, which nothing in the ID path uses. The e2e comment corrected in ec92f27 admits this, but commit 6d2f9dd's title still says "deterministic test ULIDs". The override test also compares against the generated ID rather than a fixed one.
- Fix: add `random` (or an ID factory) to `AppServices`.

## Nits

- **N1.** `rulesOverride.ts:141`: overwriting an invalid record writes revision 1, which breaks the "monotonic revision" wording. Probe: a corrupt record at revision 50, once cleared, became revision 1. Compare-and-swap uses the exact stored string, so no safety impact.
- **N2.** `rulesApply.ts:223` hard-codes `` `uma:${kind}:model-fit` `` instead of using `fitRecordKey(kind)`.
- **N3.** `Health.tsx:~404`: after reapplying on top of an override, "replaces {sourceReport.current} of {base}" shows the previous override's values as if they were the base values.
- **N4.** `ApplyProposal.storedRevision` is carried through but never checked; the bound string is the real authority.

## Checklist

1. **Scope and read-only areas: ok.** `git diff --quiet 28d1edc ec92f27 -- packages apps/api apps/web/fixtures apps/web/public docs/specs pnpm-lock.yaml package.json apps/web/package.json` → exit 0. Scoped `git diff --check` excluding assets → exit 0.
2. **Identity: ok.** The digest covers scheme, kind, a digest of the full master bundle, the effective rules and the synthetic turns (`engine.api.ts:357`). It is real SHA-256: my probe matched `node:crypto` on the ~580k-char master and on non-ASCII input, at about 7 ms each for canonicalising and hashing. Roster identity is the row count plus SHA-256 of the content. Old v1 fit records force a refit.
3. **Envelopes and worker refusal: ok.** The local model envelope is validated against the full `ModelSnapshot` schema. `localModelMismatch` checks the override, base, context, master, roster ETag and roster content. In my probe, ranking with missing provenance gave `ProvenanceMismatchError`; a non-ULID override and an infinite override value were both refused.
4. **No API reads or writes under an override: ok.** I traced every `storeSnapshot`/`latestSnapshot` call. The override branch of `ensureModel` never touches the source, and the base path refuses `overridden` or a wrong fingerprint before POSTing. The e2e checks the mock store across Health refit, Planner auto-fit and reload. B1 is the one display gap.
5. **Eligibility and confirmation: ok.** Apply requires `stats.status === 'suggested'` (so boundary results are excluded), an actual producer suggestion with `change`, a current report and a matching fingerprint. Confirmation is bound to report ID, provenance key and the stored string. Values are absolute, so recalibrating after apply gives ×1.00 and Apply is disabled.
6. **Transaction: ok.**
   - The candidate fit runs in a separate `EngineClient`, and authority is rechecked after each `await` and again inside the lock.
   - Commit is synchronous: model, then override compare-and-swap, with rollback on failure. A cancel while waiting for the lock is refused inside the lock.
   - Reset removes things in order and restores on failure. Owned jobs are cancelled, and Planner now cancels only its own job.
7. **Cross-tab: ok.** Writes take an exclusive Web Lock per mode and recheck the stored string inside it; without Web Locks, writes to real localStorage are refused. The real-browser run shows the commit queued behind tab 2's lock.
8. **Carried T15b findings: ok.** S1 boundary label, S2 uninformative qualifier, N1 atomic configure (`engine.api.ts:371-428`) and N3 owned-job cancel are all fixed.

## Commands run on ec92f27 (real output, trimmed)

```
$ npx vitest run test/t15c-provenance.logic.test.ts test/t15c-worker.test.ts test/t15c-apply.test.tsx test/t15c-lock.test.ts
 Test Files  4 passed (4)      Tests  52 passed (52)
$ npx vitest run (web suite, run alongside my probe file)
 Test Files  20 passed (20)    Tests  219 passed (219)     # 216 + 3 probe tests
$ pnpm exec playwright test e2e/apply.spec.ts
REAL BROWSER calibration (fixture ×1.3 roster): 1350 ms; Selected multiplier ×1.32 (holdout-MAE argmin; stats status suggested).
REAL BROWSER apply (candidate fit + commit): 553 ms; context sha256:979cfd2ef13b… → sha256:d728b925e6e1…
REAL BROWSER recalibration on the applied context: Selected multiplier ×1.00 ...
AXE ... serious/critical=0 (all screens listed)
  2 passed (36.7s)
$ pnpm lint / pnpm typecheck (apps/web) → clean
$ pnpm build → dist/assets/index-Ch7hADif.js 614.22 kB │ gzip: 184.61 kB ; worker 192.83 kB
$ pnpm check:dist → check-dist: OK — no fixture code or data in the production build
```

The override fingerprint differs from the changelog's `2f3f91bc…`. That is expected, because the override ID is random and is part of the effective rules version (this is S1).

## Known gaps (not code blockers)

- The `QuotaExceededError` path is fault-injected, not a real storage-quota event.
- A real browser without Web Locks was never exercised.
- H4 real-roster, native-agent, live-API and cross-device checks are absent.
- All browser evidence is the synthetic fixture or mock HTTP.
- The changelog describes this accurately, and 6 of its 6 evidence claims I checked against reruns held.

A fix round needs to cover B1 and B2, each with a test. S1 is recommended alongside.

session_id: 20261010_020817_5789c8
