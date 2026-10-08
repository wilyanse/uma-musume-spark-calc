Verdict: PASS. There are no blockers left. I'd fix S-A before the real-roster run (H4) or the browser consumer is built, but it doesn't need to block this merge. You still have the one remaining worker fix round if you want S-A fixed now.

Reviewed by claude-opus-5-5 (medium effort), working read-only and directly: no delegation, no model CLI, no subagents. Candidate is task/T15-rules-calibration at dffb549c7e10d58b04ddb30244deb30e9e25ca3d (base 9e62727, fix diff 1a484d6..HEAD). HEAD was the same SHA with a clean `git status --porcelain` at start and end. I made no tracked edits, commits, pushes or merges. Everything I wrote is in /Users/willjose/.hermes/cache/scratch/t15-review-r2/ (probe.mts, probe-*.json, gates.log, gates2.log, runA/B.json and .log). I only read the round-1 reviewer's and the worker's scratch files.

Blocking
  None.

Should fix

  S-A. The new train-row identifiability check (N2) only catches a sensitivity that is constant across all train rows. It misses one that is collinear with other design columns. See packages/engine/src/calibrate/index.ts:349-384 (blueIdentifiability) and the reason text at :378.
    - The check's own argument is that a constant per-stat shift is absorbed by the intercept. The same argument applies to any sensitivity that is constant within each scenario×mode cell, because the cell one-hot absorbs it too (features.ts:6-15).
    - Probe Q13 (guest-only roster, 34 used, split 27/7): each scenario's parents carry 3★ blue in one stat only, so d = 240 × the scenario indicator, which is exactly in the span of the cell one-hot.
    - The engine still returned `stats: suggested`, report `complete`, with the selection tracking whatever shift I planted: k=1.3 gave 1.25, k=3 gave 2.95, k=0 and k=−2 gave boundary 0.
    - That "identification" comes only from the λ_base ridge penalty. A genuine per-scenario stat difference would be attributed to blueStatGain.
    - The tolerance is also absolute: a variation of 1e-8 on d of about 1 counts as identifiable (Q7.unitTiny).
    - Suggested fix: test d against the train design's column space (a projection residual or rank test, with a residual-norm threshold). Mark nonidentifiable, or at least add a "penalty-identified" flag and warning, when the residual is about 0. Pin the Q13 case in a test.
    - Not triggered by the golden data: on real-like rows d varies within cells (Q9, Q10).

  S-B. An invalid observed grade is counted as `below-base` rather than rejected. See aptitude.ts:182-188.
    - Probe Q2.invalidGrade: `aptitudes.turf = 'Z'` was accepted, with impossible 1, belowBase 1, example reason 'below-base'. The cause is that GRADES.indexOf returns −1.
    - Non-finite stats already have a runtime exclusion. An unknown grade should get one too, or a typed ModelInputError, instead of being mislabelled.

  S-C. Gate flakiness. In my first serial gate run (load average about 42 from other host processes), the engine tests failed 1 of 311: edge.test.ts:212, the new B1 test, timed out at 5000ms.
    - In isolation it took 1613ms, and the full gate rerun exited 0.
    - The worker's follow-up already lists the same 5s-timeout problem for the deep-frozen test. It now affects two full-calibration edge tests, so it needs a decision on an explicit timeout.

Nits
  - docs/changelog/T15-rules-calibration.md:28 still says "unbiased evaluation" in the golden.test.ts file description. Lines 157-158 are labelled as historical, so they're fine.
  - When a cell's observed grade has p < 1e-12 and is still treated as degenerate, the full logLik is finite (about −29.9) and the status is `uninformative` (Q3.nearDegenerateWithinTol). This is the correct semantics; the docs could add one line saying likelihood fields are still populated when the status is uninformative.

Checklist (everything below is fresh evidence from my own runs unless marked inherited)

1. HEAD, scope and diff hygiene.
   - `git rev-parse HEAD` gave dffb549 at start and end; `git status --porcelain` was empty both times.
   - `git diff --check 9e62727..HEAD` printed ok.
   - No file outside calibrate/**, src/index.ts, model/fit.ts, the T15 changelog and OPEN_QUESTIONS changed.
   - `git diff 1a484d6..HEAD -- packages/engine/src/model` is 0 lines, so the visibility-only exports in fit.ts are unchanged.
   - `git diff --quiet 9e62727 HEAD -- packages/engine/test/golden apps packages/schema packages/master-data docs/specs` exited 0 (unchanged).

2. Gates, run serially: `pnpm install --frozen-lockfile --offline && pnpm -r lint && pnpm -r typecheck && pnpm -r test`.
   - Run 1 exited 1: engine 310/311, the S-C timeout.
   - The rerun of lint, typecheck and test exited 0: schema 149, master-data 82, api 111, engine 311, web 124.
   - Node v25.9.0, pnpm 11.22.0. No recursive build and no golden refresh.

3. B1, full likelihood.
   - Published context (Q1): status uninformative, fullLikelihood zero-probability-observed, logLik and meanLogLik null, possibleCells 1873, conditionalLogLik 0, impossible 87 (below 0, above 87, gap 0), degenerate 1960 of 1960, 0 reliability events. Report `partial`, not complete; JSON round-trip true. Both warnings say −∞/null and that every cell is degenerate.
   - Per aptitude: dirt is `finite` with ll 0 and 0 impossible (correct: every dirt cell has p=1); the other 9 are zero-probability-observed with null logLik; all 10 are `uninformative`.
   - All impossible (Q2): logLik null, conditionalLogLik null, possibleCells 0, uninformative, round-trip true.
   - Empty roster (Q2): no-cells, insufficient-data, report unavailable, round-trip true.
   - Mixed support (Q3): an interior gap gives 'unreachable' and above the top gives 'above-max'; aggregate status ok, full null, conditional over 9.
   - Subnormal p = 5e-324 gives a finite ll of −744.44 (no underflow to −∞).
   - Tolerance boundary: 1−1e-13 is degenerate (uninformative); 1−1e-11 counts as informative (ok).
   - Golden ×1.3: finite, −235.24 for both full and conditional over 1960, identical to round 0.

4. S3 and S4. The pink 2/2/2 test reconciles unreachable 34 (tested in review-r1.test.ts:83, which I read; it passes in the gate). Zero skill cells give null totals and subgroups with insufficient-data and a non-complete report; the empty-subgroup case is also covered in tests that pass in the gate.

5. S1 and S2.
   - S1 (Q4): grids of 1 and 2 points give insufficient-data, grid-too-small, no selection, bootstrap or suggestion, only the ×1 candidate, and blueStatGain in notCalibrated. 3-point grids work; all three I tried were at the boundary, so nothing was suggested.
   - S2 (Q5): 1 and 19 holdout rows give insufficient-holdout with a reason, bootstrap null, consistentWithCurrent null, withinInterval null, and a disagreement warning saying no interval is available. 20 rows: available, [1.23, 1.29, 1.35], train-CV 1.35 within the interval, no warning. bootstrap 0 gives disabled with null fields and a warning.
   - The scope string says conditional, not full uncertainty.
   - When the train-CV pick falls outside the interval, the beyond-interval warning fires (Q8). The report stays complete; acceptable, since it is a warning.

6. N1 and N2.
   - `holdoutMaeOfTrainCvSelection` equals the trainCv holdout MAE (41.0198). The note mentions lineage coupling, and "unbiased" no longer appears in production source.
   - N2 handles holdout-only sensitivity (tested) and constant train sensitivity (Q7: 27 of 27 constant gives nonidentifiable).
   - Gap: collinearity with the design (S-A).

7. Golden evidence, run twice: `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/run{A,B}.json`.
   - Both exited 0. All 17 runs match between A and B once timing fields are stripped, and also match the worker's runA.
   - Compared with the round-1 reviewer's runA (first candidate): no differences in selected, trainCvSelected, currentHoldoutMae, maeAt, bootstrap, withoutInheritance, suggestions, candidates, split or status. The old unbiasedHoldoutMae equals the new holdoutMaeOfTrainCvSelection, the old logLik equals the new conditionalLogLik, and the skills are equal apart from the new status field.
   - ×1.3 gives 1.33 (40.939), which is in [1.2, 1.4]; train-CV 1.31; bootstrap 1.31/1.33/1.37. The grid 0..4 run also gives 1.33.
   - SHA-256 hashes of the roster, the ×1.3 roster, truth and the published rules.json all match the changelog.

8. Immutability, apply and exports. Suggestions are still `applied: false`, and the R1 deep-freeze test passes in the gate. The index.ts additions are type and constant exports only.

Inherited, not rerun: the worker's RED output (accepted from the commit order: tests in efe43eb, fix in dffb549). Round-1 probes P3/P4 (refit equivalence, holdout isolation) are not rerun either; the stat-grid code they cover is unchanged apart from the guards. These fields are engine-local and unmerged in the API; the browser consumer is separate. Nothing here proves game facts. Not done: real roster, browser, native, live proof. H4 and Q-3/Q-5 remain open.

session_id: 20261008_143400_0b9b3e
