Verdict: PASS. Nothing blocks merge. There are two should-fixes, both about labels and wording, and a few nits. I did not self-merge; the parent saves this report.

Candidate: task/T15-rules-calibration at fa4810d16089214f275f1ef5ba57d376b372ed56 (base 9e62727, focused fix e47981c..HEAD). Reviewer: claude-opus-5-5, medium effort, read-only and direct, with no delegation, model CLI or subworkers. HEAD was fa4810d at start and end, and `git status --porcelain` showed 0 lines both times. I made no tracked edits, commits or pushes. My scratch is /Users/willjose/.hermes/cache/scratch/t15-review-r4/ (probeA, A5, C, D, E .mts files with their JSON, gates.log, runA/B.json and .log). I only read the r3 scratch; probeA, A5 and C were copied from it unchanged.

Blocking
  None.

Should fix
  S1. The identification status can say `identified` while the report says nonidentifiable.
    - `stats.identification.status` can be `identified` while the gate is false and `stats.status` is `nonidentifiable`. Fresh unit probes: D5 (mixed stats, 5 bad folds) and D5b (one bad fold, no confounded stats) both give status `identified` with `identifiable: false`.
    - identify.ts:185-192 computes the full-design status; :288-293 computes the gate. `BlueIdentification` (identify.ts:66-83) has no field for the gate.
    - The report itself is correct. `stats.status` is `nonidentifiable`, `selected` is null, there are no suggestions, the report is not `complete`, and the reasons name the confounded stats and the bad fold ids (identify.ts:276-287).
    - The risk is a consumer such as S07 reading `identification.status` alone. Suggested fix: add a `selectionGate: boolean` (or `criterionStatus`) field to `BlueIdentification`. Alternatively, document that consumers must read `stats.status`; changelog:496 currently tells S07 to show `identification.status`.
  S2. Dead or misleading leftovers from the old policy.
    - index.ts:541-551: the two warnings guarded by `ident.identifiable && …` can no longer fire, since the gate now excludes both cases. Their text ("the multiplier is identified by the other sensitive stat(s)") describes the superseded policy.
    - index.ts:271 / :811: `Suggestion.confoundedStats` is now always `[]`, and the doc still says "usually empty".
    - identify.ts:42: `IdentificationBasis` still includes `'structural-design'`, which nothing can produce now. `'intercept-only'` is only reachable through the bare unit API with no design.
    - identify.ts:147 / :89 / index.ts:528: the `structural` option is passed through but ignored (`_structural`).

Nits
  N1. index.ts:269: the literal `identification: 'identified'` is enforced only by the runtime guard at :795-799 (status `suggested`, gate true, basis `full-design`), not by the type. Correct today; the type has no discriminant.
  N2. The end-to-end mixed-stat path is only covered by unit tests. Through the full `calibrateRules`, the r3 C rescue is now caught by saturation before the mixed rule matters. My D1/D3 attempt to build a non-saturated cell-confounded spd failed: spd residual was 0.57, probably from matched-parent lineage legacy. So treat D1/D3 as inconclusive, not as evidence either way.

Checklist (all fresh unless marked inherited)
1. HEAD and scope
   - fa4810d at start and end; status 0 lines.
   - `git diff --quiet 9e62727 HEAD -- packages/engine/test/golden apps packages/schema packages/master-data docs/specs` exited 0.
   - `git diff --quiet e47981c HEAD -- src/model src/index.ts test/calibrate/helpers.ts golden-report.ts` exited 0. The visibility-only exports in fit.ts are unchanged.
   - The diff since e47981c touches 7 files: identify.ts, index.ts, review-r1/r2/r3 tests, Q-159 and the changelog.
2. Gates
   - Run serially on Node v25.9.0 under heavy load (load average about 45): `pnpm install --frozen-lockfile --offline && pnpm -r lint && pnpm -r typecheck && pnpm -r test && git diff --check 9e62727..HEAD` exited 0.
   - Counts: schema 149, master-data 82, api 111, engine 329 (21 files), web 124.
   - No recursive build.
3. B1 on saturated designs (fresh probes)
   - A1, the card-indicator d at k = 0, 1.3, 3 and −2: all `partial`/`nonidentifiable`, selection and train-CV selection null, no suggestions. Identification is design-confounded, full-design basis, saturated (rank 27/27), all 5 folds design-confounded.
   - A2 (the original Q7 guest roster) and A3 (pure card effect at k = 0 and 3): same result.
   - C, the r3 row-single-stat rescue (one or two perturbed rows, at k = 1.3 and 3): nonidentifiable with no selection or suggestion. All residuals are 1e-31 against the full design.
   - D7 (4 train rows): insufficient-data, saturated identification shown, `partial`. Low rank is handled.
   - identify.ts:170-176 now uses only the full fitted design (card-id columns included), and :190 never returns `identified` when saturated.
4. Mixed-stat and fold gate
   - The gate (identify.ts:288-293) requires: status `identified`, not saturated, no confounded stats, and every fold `identified`, unsaturated and on the full design.
   - Fold status (identify.ts:235-239) is downgraded to design-confounded when any sensitive stat in the fold is confounded, even if another stat is independent. D5 (a mixed fold with one independent stat) gives every fold design-confounded.
   - D5b: the full design is clean but fold 0 is confounded. Result: `identifiable: false`, reason "CV fold(s) 0".
   - Fold ids reconcile with the fit: `cvFolds(trainIds, cvSeed)` at index.ts:522 matches `fitRidge`'s `cvFolds(rows.map(id), foldSeed)` (ridge.ts:129) on the same train ids and seed.
   - Stats that are not sensitive have `confounded: null` and do not trip the gate.
5. Near-collinearity and the meaning of "identified"
   - D4: 1e-5 relative jitter is identified (residual 9.9e-6). 1e-9 jitter is design-confounded.
   - C.unit (a single row off by 1e-4): status `identified`, but fold 0 is confounded, so the gate is false.
   - So "identified" only means "not numerically collinear". That caveat is now stated at Q-159:243, changelog:506 and identify.ts:23/33.
   - Absent train (D6, no train ids): insufficient-data, identification null, `partial`.
6. Report and suggestion paths
   - Suggestions require `suggested` status, a true gate and the full-design basis (index.ts:795-799).
   - Candidate refits are limited to ×1 unless `suggested` (index.ts:702). Every probe above shows candidates `[[1, current, fitted|skipped]]`.
   - `complete` requires `suggested` or `boundary` (index.ts:831-836), which is unreachable without the gate.
   - Grid, tie-breaking and bootstrap code is unchanged since e47981c.
   - The R1 retarget (probeE: full train set with 1 holdout row) gives `insufficient-holdout`, bootstrap null, `withinInterval` null and `consistentWithCurrent` null. The selections disagree (1.23 vs 1.31), so the "disagree … no bootstrap interval" warning branch does run on this fixture.
   - Coverage of the unavailable interval is intact. The only weakening is that the disagreement assertion became conditional (review-r1.test.ts:226), which today evaluates true.
7. Golden evidence
   - `golden-report.ts --variants` run twice (runA, runB): both exit 0, 17 runs each.
   - runA equals runB with every *Ms field stripped, and equals the coordinator's t15-coordinator-A.json.
   - The 4 SHA-256 hashes match r3: 6a02f360…, 8982ab4a…, 1ccf0d5a…, 352e5ea3….
   - ×1.3: `complete`/`suggested` at 1.33 (holdout MAE 40.939), train-CV 1.31, bootstrap 1.31/1.33/1.37, full-design rank 38 over 157 train rows, folds all identified, minimum residual 0.61.
   - Published context: `partial`, nonidentifiable, full likelihood zero-probability-observed (`fullLikelihood` = `zero-probability-observed`, so `logLik` is null), 87 impossible.
   - Compared with r3's runA, the only differences are in run [2]: one extra nonidentifiable reason (4 vs 3) and its warning text. That is the expected new saturated/fold reason text.
8. Tests and preservation
   - review-r3 adds 4 tests (saturation, mixed stats, fold, guest report).
   - Retargets in r1/r2 change several expectations from true/suggested to false/nonidentifiable, as B1 required.
   - Positive identification is still pinned: review-r2:194 (within-group variation) and :244 (scale-awareness) expect `identifiable` true, and the golden test expects `suggested`.
   - Inherited, not re-probed this round: holding q once, null full likelihood, invalid observations, timeouts, immutability and train-only fits. aptitude.ts, fit.ts, helpers.ts and the timeout constant are unchanged since e47981c, and their suites pass.

Inherited and not re-verified: the parent's RED run (4 failed / 325 passed) and first GREEN run (327/329). The commit order is consistent with them, but I did not check out the pre-fix code.

Not done: real roster, browser, native and live proof. H4, Q-3 and Q-5 are still pending. Nothing here establishes game facts.

session_id: 20261008_153134_7f2c8b
