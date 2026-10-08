Verdict: CHANGES_REQUESTED. There is one blocker, S-A. S-B and S-C are fixed, the nits are fixed, and the round-1 regressions still hold. Because the bounded worker fix round is used up, B1 below needs coordinator takeover, not another worker loop.

Candidate: task/T15-rules-calibration at e47981c671e758c67afdc25a59105b484e5c46f8 (base 9e62727, fix diff dffb549..HEAD). Reviewer: claude-opus-5-5, medium effort, working read-only and directly, with no delegation, model CLI or subworkers. HEAD was the same SHA at start and end, and `git status --porcelain` was empty (0 lines) at the end. I made no tracked edits, commits, pushes or merges. Everything I wrote is in /Users/willjose/.hermes/cache/scratch/t15-review-r3/ (probeA/A4/A5/B/C.mts with JSON outputs, gates.log, runA/B.json and .log). I only read the r2 reviewer's and the worker's scratch files and did not change them.

Blocking

B1 (S-A is not met). The saturated-design fallback reports a multiplier as `identified` even when the design does not identify it. That produces suggestions and a `complete` report, and only a warning says otherwise.

  Where:
  - packages/engine/src/calibrate/identify.ts:172-186: when full rank ≥ n, it falls back to the structural basis, then to the intercept.
  - identify.ts:195-202: `identified` if any one stat has a residual above 1e-7.
  - calibrate/index.ts:536-552: saturation, confounded-stat and fold problems are warnings only.
  - index.ts:806: the suggestion is hard-coded `identification: 'identified'`.
  - index.ts:828-836: the report is `complete` whenever the stat check is suggested or boundary.

  Why it is wrong: if rank(X_full) = n, every d lies in the span of X_full. That includes the card-id columns that `fitRidge` actually fits. So m·d can always be absorbed and the MAE curve over m is shaped only by λ_id/λ_base. Testing against the structural subspace instead of the actual design does not identify m. It replaces the fitted model with a different one and reports the result under the same label. Fresh probes:

  A1 (probeA.mts): guest-only roster (n=27, 44 columns, full rank 27, so saturated).
    - Non-self blue is removed. Only rows carrying card:7-more-centimeters-air-shakur (lb set to 0, so the card column is exactly the indicator) get 3★+3★ speed, and k·240 is planted on spd. So d = 240·1[card].
    - probeA5 confirms this d is exactly confounded with the card column: relative residual against {intercept, cells, card col} is 9.2e-17, so it is design-confounded. Against the structural basis the residual is 0.23, so the code returns `identified`.
    - Results:
      - k=1.3: `complete`/`suggested` at 0.71, train-CV 1.17, suggestion identification `identified`.
      - k=0 and k=−2: `boundary` 0.5.
      - k=3: `boundary` 2.
      - The report is `complete` in all four cases, and all 5 folds are `identified`.
    - The selection does not follow the planted k. This is the same failure as r2's Q13, reached through the card columns instead of the cells.

  A3: same guest roster with a pure +720 spd card effect added and the blue table unchanged.
    - The suggestion stays `identified` at 1.28, and train-CV moves from 1.30 to 1.22.
    - The roster is saturated, so this "identification" cannot be told apart from card confounding.

  C (probeC.mts): Q13 with the parent2 star count lowered to 1★ on 2 rows.
    - With k=1.3 planted on all stats, spd, sta and pow have residuals of 1e-16 to 1e-31 and are confounded. Only wit has a residual (0.097), coming from two rows. The result is `complete`/`suggested` 1.72 (planted 1.3), train-CV 1.15, `identified`, and fold 4 is design-confounded.
    - The mixed-stat policy (one non-confounded stat is enough) lets two rows of one stat validate a shared multiplier. Meanwhile three confounded stats' MAE terms, which are ridge-only, still drive the selection criterion, because `holdoutMae` sums every stat.

  A2: the worker's "genuine" Q7.orig positive (1.28) is also saturated. Its identification comes from the same structural-only test, so I can't call it proof of identification. It is only consistent with it.

  Acceptable semantics (concrete):
  - (a) When `identification.saturated` is true, or the status was obtained on any basis other than `full-design`, the stat check must not be `suggested`/`boundary` and must not count towards `complete`. Use a distinct status such as `penalty-identified` or `nonidentifiable` with the reason "design saturated (rank ≥ n): m is identified only by the ridge penalty". At most, keep the grid MAEs as labelled diagnostics, with no `selected` suggestion and no entry in `suggestions`.
  - (b) Fix the Suggestion type so the literal `identification: 'identified'` is only reachable when the basis is `full-design`.
  - (c) Gate on, or at minimum block `complete` for, folds whose status is not `identified`, and for selections whose criterion includes confounded stats. Alternatively, compute the holdout/CV criterion only over non-confounded stats.
  - (d) Tests: pin A1 (card-indicator d, saturated) and C (2-row single-stat rescue) as non-suggested. Retarget the Q7.orig test so it expects the penalty-only status, not `suggested`.

  Golden is unaffected: it uses the full design (rank 38 < 157) and all folds are identified, so 1.33 / train-CV 1.31 is preserved. Non-saturated card confounding is also caught correctly (A4, full roster: residual 0.62, legitimately identified; probeA5: exact confounding is detected on a non-saturated design).

Should fix
  S1. identify.ts:37 and :200. COLLINEAR_REL_TOL = 1e-7 only guards against round-off; there is no minimum signal strength. In unit probe C.unit, a single row deviating by 1e-4 out of 240 gives a residual of 1.65e-7, which counts as `identified`, and one fold is confounded. This is acceptable as a numeric guard, but the docs and Q-159 should say that `identified` means "not exactly collinear", not "well-determined". The reported residuals let a consumer judge. I would fold this into the coordinator's B1 work rather than treat it as separate.

Nits
  None outstanding. The changelog file description no longer says "unbiased" (the remaining matches are labelled historical, at lines 89, 163-164 and 309-311). The note that likelihood fields stay populated under `uninformative` with near-degenerate p is documented (aptitude.ts:16-18, changelog:448).

Checklist (all fresh unless marked inherited)
1. HEAD and scope.
   - `git rev-parse HEAD` gave e47981c at start and end; `git status --porcelain` showed 0 lines.
   - `git diff --check 9e62727..HEAD` exited 0.
   - `git diff --quiet 9e62727 HEAD -- packages/engine/test/golden apps packages/schema packages/master-data docs/specs` exited 0.
   - src/model changes are only the visibility exports in fit.ts from round 0, unchanged since.
   - The new exports in src/index.ts are COLLINEAR_REL_TOL and the types CalibrationBlueIdentification and InvalidObservedGrade. All outputs round-trip through JSON (probeB rt=true).
2. Gates, run serially at load average about 4.5-8, Node v25.9.0, pnpm 11.22.0: `pnpm install --frozen-lockfile --offline && pnpm -r lint && pnpm -r typecheck && pnpm -r test` exited 0. Counts: schema 149, master-data 82, api 111, engine 325 (20 files), web 124. No recursive build.
3. S-A math. The basis is built by modified Gram–Schmidt (MGS) with a second reorthogonalisation pass on unit-normalised columns, RANK_REL_TOL 1e-10, and a relative residual on the normalised d. Zero columns are skipped (`!(n0>0)`). Non-finite y throws a ModelInputError in statGrid.
   - Probes: a near-duplicate column (1e-13), a 1e9-scaled column and a zero column, each with d in the span, all give design-confounded.
   - Q13 at k = 0, 1.3, 3 and −2: nonidentifiable, `partial`, all folds confounded, no suggestion.
   - Q7.unitTiny: false. A 1e-6 relative variation: true.
   - Golden full-design is correct, and folds are tested on the actual fold rows.
   - It fails on saturated and mixed-stat cases (B1).
4. S-B (probeB). For 'Z', 'b', 5, null, NaN, undefined, {} and a 500-character string:
   - invalidObserved is 1 and cells drop from 10 to 9; cells + invalid = 10.
   - impossible and belowBase are 0, unchanged from base. possibleCells is 9 and conditionalLogLik covers only the valid cells. turf is insufficient-data.
   - Examples are JSON-safe (strings truncated to 16 characters).
   - The input is unchanged and was deep-frozen during the run.
   - A missing `aptitudes` object gives 10 invalid, insufficient-data, no-cells, logLik null.
   - Passed.
5. S-C. The whitespace-normalised token comparison of edge, golden and review-r1 against dffb549 shows identical expect( counts (76/117/114) and it( counts (16/25/18), with 0 skip/only/todo. The only differences are the T argument, the import, the constant and identify.ts in the purity list. FULL_CALIBRATION_TIMEOUT_MS is 30,000 and applied per test. Passed.
6. Round-1 regressions. Covered by the passing gate suites (review-r1 tests: null+state, conditional, per-aptitude, empty, all-impossible, degenerate, grid ≥ 3, holdout ≥ 20, skills null). The published run gives `uninformative`, full zero-probability-observed, ll null, cond 0/1873, imp 87, report `partial`. I did not re-probe these individually this round; the r2 reviewer's Q1-Q5 are inherited.
7. Golden evidence: `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/run{A,B}.json`.
   - Both exited 0, and all 17 runs match between A and B once timing fields are stripped.
   - Compared with the r2 reviewer's runA, with the new identification/invalid fields stripped: diffs [].
   - The 4 SHA-256 hashes match r2 (6a02f360…, 8982ab4a…, 1ccf0d5a…, 352e5ea3…).
   - ×1.3 gives 1.33 (40.939), train-CV 1.31, bootstrap 1.31/1.33/1.37, identified on full-design rank 38/157.
   - The published context gives no-train-sensitivity. Context statuses are reported truthfully.
8. Immutability and apply: the deep-freeze test passes, suggestions are `applied: false`, and S-B inputs are unchanged.

Inherited, not re-verified: the worker's RED/GREEN logs (the commit order bbadbbf → e47981c is consistent with them), the worker's t15-fix-r2 probe claims, and r2's P3/P4 refit equivalence and holdout isolation (statGrid math is unchanged apart from sharing the design builder).

Not done: real roster, native, browser, live proof. H4 and Q-3/Q-5 remain open.

session_id: 20261008_151531_e2898e
