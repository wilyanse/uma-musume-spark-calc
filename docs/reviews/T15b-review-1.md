Verdict: PASS. Nothing blocks merge. There are two should-fixes, both about labels on the report, and a few nits. I made no edits, commits, pushes or merges; you save this report and merge.

Candidate: task/T15b-calibration-consumer at d1ac0258bae79c1ee4d8cc58101a9f304089be9b, base 93d2897, 7 commits. Reviewer: claude-opus-5-5, medium effort, read-only and direct, with no delegation, model CLI or subworkers.
- HEAD was d1ac025 at start and end, and `git status --porcelain` showed 0 lines both times.
- `git diff --quiet 93d2897 HEAD -- packages apps/api apps/web/fixtures apps/web/public docs/specs pnpm-lock.yaml package.json apps/web/package.json` exited 0. So engine, schema, master data, golden files, fixtures, specs and dependencies are unchanged.
- My scratch is /Users/willjose/.hermes/cache/scratch/t15b-review-r1/: gates.log, build.log, e2e.log, a fresh assets/ folder, probes.log, and copy/, a throwaway copy of the worktree that holds my probe test.
- I did not read or re-run the worker's scratch (~/.hermes/cache/scratch/t15b/). Every result below comes from my own runs.

Blocking
  None.

Should fix
- S1. apps/web/src/components/CalibrationReport.tsx:71-75: when `stats.status` is `boundary`, the header still says "Selected multiplier ×N (holdout-MAE argmin…)". The engine makes no suggestion in that case, and the Suggestions section says so further down. But the bold header plus the ", at the grid boundary" suffix reads like a recommendation. Suggested fix: label it "Boundary minimum ×N (not a suggestion; widen the grid)". Only a fake test variant reaches this branch; no real fixture produces a boundary result.
- S2. CalibrationReport.tsx:169-171: in the production all-degenerate case the line says "Conditional log-likelihood … 0.00 over 1873 possible cells (mean 0.000)". The `uninformative` status does appear two lines above, which meets spec 61. Read on its own, though, 0.00 looks like a perfect fit. Suggested fix: when `apt.status === 'uninformative'`, add "(uninformative: every cell is degenerate)" to this line.

Nits
- N1. apps/web/src/workers/engine.api.ts:263-292: the comment says "ctx and info always change together". But `ctx` is assigned before `overrides` is built, so a throw while building overrides would leave a golden ctx paired with the old info.
  - I tried to trigger it (probe P5) with a truncated golden truth. The loader accepted it and the pair stayed consistent, so I could not reproduce a mismatch.
  - Suggested fix: build into locals, then assign both.
- N2. apps/web/src/lib/calibration.ts:55: the roster identity is a 32-bit FNV hash. It is only used alongside the ETag, on the user's own data, to decide what is stale, not for security. A collision is negligible in practice, and the comment already says it is not a security hash. Fine as is.
- N3. Planner.tsx:77 still calls the global `engine.cancel()` on unmount (inherited from T13). Health no longer does; it cancels only its owned job, as 61 requires. Only one route renders at a time, so they cannot overlap today, but it is worth fixing when Planner is next touched.
- N4. The report does not show the run's roster ETag or identity, though both are captured and used for staleness. Spec 61 asks for "context/version/synthetic provenance", which is shown. Optional.

Checklist
1. Spec conformance (61, 50 §8/§9, 70 F12, bindings as reconciled by 61): ok.
   - The worker calls the real `calibrateRules`/`CalibrationReport` exports. Clock and id are plain data, and a non-ULID id or bad clock is refused as a typed error.
   - The context info is captured inside the worker at call time.
   - Run calibration is enabled with no snapshot; the running state has no fake progress and offers Cancel.
   - Suggestions are labelled as unverified proposals. Apply is disabled and points to the T15c explanation, or is absent when there is no suggestion. Dismiss clears only the report.
   - The selection authority is `stats.status`. A raw "identified" that conflicts with it is flagged (lib/calibration.ts:41-49, CalibrationReport.tsx:91).
   - Full log-likelihood is null and labelled "zero-probability-observed"; the conditional value is labelled conditional with its possibleCells denominator.
   - Impossible, invalid and degenerate counts are shown, plus skills with scored-cell denominators.
   - "complete" is explained as "checks available", not verified mechanics.
   - The synthetic banner appears only for the golden-fixture context.
2. Correctness and lifecycle: ok.
   - `jobRef` is set synchronously and shared by refit and calibrate, so a same-tick double click starts one job.
   - Unmount cancels only the owned job.
   - A change to the provenance key (context kind, master, rules, ETag, content identity) terminates a running job and reports why.
   - A late reply is refused by `jobRef` identity plus an envelope check (kind, master and rules versions).
   - Reconfigure cancels inside `EngineClient.configure`.
   - A refit snapshot is stored only after `isCurrent` checks, so nothing is stored after a cancel or unmount.
   - The WeakMap session slot is per engine client and never written to storage, the API or query caches.
   - Fresh probes, all passing (probes.log):
     - P1, StrictMode: run, unmount, then a late resolve. Engine idle, 0 console errors, 1 call.
     - P2: cancel, rerun, then the first job's reply arrives late. It was ignored and the second report id was shown.
     - P3: same ETag with changed content was marked "roster changed".
     - P4: unmounting before the refit's fit starts gave 0 fits and 0 stores.
   - Comparing envelope versions rather than every report row is enough, because provenance is captured synchronously at click time and every input change revokes the job.
3. Test quality: ok.
   - The real-worker suite (calibration-worker.test.ts) checks the ×1.3 result and a poisoned-truth equality: a truth object with a planted multiplier of 9 and `latent: null` gives a report identical to `syntheticInheritance` alone. It also covers the production placeholder path, read-only behaviour, bad id/clock and the empty roster.
   - The UI tests use fake workers and are clearly labelled, with base reports taken from real engine output.
   - The real browser e2e covers run, cancel, retry, navigation while running, staleness, refit and dismiss.
   - Changelog numbers match my runs.
4. Fabrication: ok.
   - No game constants. Fixture code stays out of production (check:dist OK; `syntheticInheritance` appears 0 times in the main and worker bundles).
   - The archived reports match my fresh e2e reports exactly once report ids are masked.
5. Security: ok. No secrets; the only writes are the mock refit and fixture PATCH. The production e2e asserts no non-GET requests.
6. Free tier: not applicable (no backend calls added).
7. Scope: ok. The changes outside owned files (harness `fakeEngine`, one T13 assertion flipped, the rules-table scroll region made focusable) are declared.
8. Maintainability: ok, apart from N1. Types are strict and the engine imports on the main thread are type-only.

Evidence: 18 PNGs, 5 axe JSONs and 3 report files are archived, and my run regenerated the same 26 names. I viewed 5 PNGs: fixture desktop light, fixture mobile dark, stale desktop light, production desktop dark and running desktop light. They are legible, with no overflow or clipping. The stale banner shows "Stale report: roster changed…". The production view shows no selection, the reason list and "unavailable" metrics. The running view shows the indeterminate text, Cancel, and both action buttons disabled. All 5 axe files have 0 violations.

Commands run (all fresh, Node v25.9.0):
```
$ pnpm install --frozen-lockfile --offline && pnpm -r lint && pnpm -r typecheck && pnpm -r test && git diff --check 93d2897..HEAD   -> EXIT=0
  schema 149 | master-data 82 | api 111 | engine 329 (21 files) | web 164 (15 files)
$ pnpm --filter web build && pnpm --filter web check:dist   -> EXIT=0
  dist/assets/index-C7Eqiyq1.js 480.82 kB │ gzip: 146.20 kB  (≤250)
  check-dist: OK — no fixture code or data in the production build
  "holdout-row resampling": main 0, worker 1; worker gzip 57600 B
$ T15B_E2E_ASSETS_DIR=<scratch>/assets pnpm exec playwright test   -> 16 passed (1.2m), EXIT=0
  REAL BROWSER calibration (fixture ×1.3 roster): 1926 ms; Selected multiplier ×1.32 … suggested
  REAL BROWSER calibration (production placeholder, API-mode MOCK HTTP): 145 ms; No multiplier selected: nonidentifiable …
  AXE fixture-light/dark, stale-light, production-light/dark: serious/critical=0; all=0
$ diff (archived vs fresh, report ids masked) fixture-x1.3-report.txt / production-placeholder-report.txt   -> identical
$ vitest run test/zz-review-probe.test.tsx (in the scratch copy)   -> 6 passed
```
No recursive build and no master or golden refresh. My build and e2e runs overwrote the ignored apps/web/dist and test-results; nothing tracked changed.

Not covered here, and still open:
- T15c: explicit apply/refit, which needs an override contract and a snapshot rules fingerprint (Q-141/Q-155).
- T15 r4 S1/S2 on the engine side: the `selectionGate` field and dead code.
- H4 real-roster acceptance, and Q-3 / Q-5.
- No native, live API, cloud or real-game proof.

The ×1.32 only recovers a planted synthetic effect; it is not a real `blueStatGain` value.

session_id: 20261008_220651_79a454
