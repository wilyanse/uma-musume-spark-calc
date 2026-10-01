# T08 independent review — round 2

Reviewer session: 20261002_074211_2ff052. Reviewed commit: dae3cc5.

## Verdict: CHANGES_REQUESTED

The card-effect fix (round-1 B1) holds up under independent probes. The retune, however, causes a new blocking problem: on a fine grid, the ×1.3 calibration dataset no longer lands inside the T15 band of [1.2, 1.4].

## Blocking

- [B1] packages/engine/scripts/golden.ts:144-147, 566 and 1224; docs/changelog/T08-golden-dataset.md:327-332 and 488 — the T15 calibration acceptance (50 §8/§9, 70 §3 F12) regressed after the retune.
  - In round 1, holdout-MAE on the ×1.3 roster was minimised at 1.3. Now I used the same 50 §4 fit at λ 0.1/0.1, the stored split, and E[inh] from the recorded lineage under `loadGoldenContext(master, truth, m)`. Holdout-MAE (sum of the 5 stats) is:

    | m | 1.36 | 1.38 | 1.39 | 1.40 | 1.41 | 1.42 | 1.43 | 1.44 | 1.46 |
    |---|---|---|---|---|---|---|---|---|---|
    | MAE | 43.58 | 43.40 | 43.33 | 43.27 | 43.25 | 43.26 | 43.29 | 43.35 | 43.61 |

    The argmin is 1.41, just outside the band.
  - The changelog's "argmin 1.40" comes from a 0.05-step grid, so the search was truncated rather than finding a real in-band minimum.
  - Restricting to the 50 §8 calibration population (both parents matched or guest: 39 holdout rows) makes it worse:
    - 192-row fit: argmin 1.42–1.45 (1.42: 42.46, 1.45: 42.46, 1.40: 42.57). Per-stat argmins are 1.5, 1.45, 1.45, 1.5, 1.35.
    - 157-row fit: argmin at the edge, 1.40 (46.52).
  - The criterion is biased upward. On the ×1.0 roster the holdout argmin is 1.1, not 1.0. Only train 5-fold CV-MAE lands inside: 1.30 (50.50).
  - T15 isn't written yet, but 50 §8 names holdout MAE as the criterion, so this is a dataset regression and not just a follow-up.
  - Required fix:
    1. Retune so the ×1.3 roster's holdout-MAE argmin (on the 50 §8 row set, and on the 50 §4 split) sits well inside [1.2, 1.4] on a ≤0.01 grid over at least [1.0, 2.0], with margin.
    2. Investigate and document the ≈+0.1 upward bias seen on the base roster (for example, guest or unmatched parents having no grandparents in E[inh]).
    3. Add a test-only feasibility check for this, in the same style as the B1 diagnostic.
    4. Correct changelog lines 327-332 and 488.
    5. Remove the unverified claim "calibration should suggest ×1.2–1.4" from the `truth.calibration.note` written at golden.ts:1224, or make it accurate.

## Should fix

- [S1] docs/changelog/T08-golden-dataset.md (Review round 1 λ table) — the table doesn't match the committed code.
  - Running the worker's own `t06-diagnostic.ts` (`ridge` + `effectiveCardEffect`) on the committed data gives:
    - λ 0.1/10: worst 12.53% (champion-s-passion pow 45→50.64). The changelog says 7.5% (→48.39).
    - λ 1/10: worst 8.46%. The changelog says 8.7%.
    - λ 0.1/0.1: worst 6.71% (→37.31). The changelog says 6.8% (→37.29).
  - The table appears to come from an earlier iteration. Replace it with output from the committed code.
  - λ 0.1/10 is a valid grid point and leaves only a 2.5-point margin. Add it to the it.each set in planted.test.ts:620-635, or state that it is the thin-margin point.
- [S2] packages/engine/scripts/golden.ts:45-51 — the generator now imports `../test/golden/t06-diagnostic.ts`, so a script depends on test code.
  - It creates no cycle (the diagnostic imports only `src/index.ts` and schema types) and has no browser exposure.
  - But the S3 test at planted.test.ts:655-666 then recomputes the value with that same code and checks it against `truth.holdout.coverageDiagnostic`. That part is self-consistency, not independent proof; only the band assertion carries weight.
  - Either move the diagnostic to `scripts/` (or `test/golden/` used only by tests) and compute coverage only in the test, or label the truth value as derived.
  - My independent coverage probes, with my own design and solver, all fall in the band, so this is not blocking.
- [S3] S3 limitations text at golden.ts:1120-1121 — the "may differ" claim is now measurable, so record it. With CV λ:
  - 50 §4 literal `residualCov` (weighted covariance of the holdout residuals): pooled 0.8125.
  - Plus 50 §7 Var[inh]: 0.8292.
  - Train plug-in sd without the leverage/sandwich factors: 0.7417, just 0.02 above the band floor.
  - Record these so T06 knows its margin depends on the variance definition.

## Nits

- [N1] packages/engine/test/golden/t06-diagnostic.ts:271-272 — `recencyWeights(rows)` is recomputed inside the fold loop for every grid point and fold. Hoist it out.
- [N2] packages/engine/test/golden/planted.test.ts:649 — `expect(c.lambdaId).toBeLessThanOrEqual(1)` ties the test to one CV outcome; any CV seed or definition change would break it.
  - I confirmed that CV with 3 other fold seeds picks λ_id ∈ {0.1, 1} and recovers every effect (worst ≤7.4%).
  - Add a comment explaining that the assertion encodes the data's recoverable region (λ_id ≤ 1).
- [N3] docs/OPEN_QUESTIONS.md Q-122 — the β_id + β_type interpretation is the right reading of the collinearity.
  - Evidence: at λ 0.1/0.1, the id-only coefficient is off by up to 54%, while |β_type| reaches 23. That is a real penalty-determined split, not an oracle correction.
  - Q-122 could add that the zero-effect cards' effective contributions (max |·| 4.99) are what tests whether type pooling bleeds into other cards.

## Checklist

1. Spec conformance: issues (B1, against 50 §8/§9 T15 and 70 F12).
   - Unchanged and verified: 260 rows, 156/104 modes, 12 planted effects, MVN noise.
   - Dates span 2026-06-25 to 2026-09-23 (90 days); every pool card reaches LB4; the retune is documented as synthetic in `truth.trainingModel.synthetic`.
   - The 50 §4 eligibility rule (confidence ≥0.9, scenario set, two parents) reproduces the 240 eligible rows exactly. The 48/192 split re-derives exactly from `holdout.seed`.
   - The B1 fit genuinely meets ±15%:
     - λ 0.1/0.1: worst 6.71%.
     - 4 CV fold seeds: worst ≤7.39%.
     - 30 alternative random 80/20 splits at λ 0.1/0.1: all pass, median 6.2%, max 9.6%.
     - λ_id ≥ 10 fails, as the changelog says.
   - S2, S4, N2 and N3 are documented, and the S2 regression test is present.
2. Correctness: ok for the diagnostic.
   - It reads no `truth.latent`. y = stat − E[inh | recorded lineage].
   - Weights are relative to the newest train row; using the newest roster row instead gives identical results.
   - No holdout data reaches the choice of λ, features or coefficients: CV runs on the train rows only, and the holdout is used only for coverage.
3. Test quality: issues (S1 stale table, S2 self-consistency). The vitest golden tests pass, 45/45.
4. Fabrication: issues (S1). The changelog numbers don't reproduce from the committed code, and the "argmin 1.40" figure is a grid artefact (B1).
5. Security: ok.
6. Free tier: n/a.
7. Scope: ok. `golden-context.ts` is the declared extension. Engine `src`, specs, web config and the lockfile are untouched.
8. Maintainability: S2, N1. `golden-context.ts` is browser-safe: an esbuild `--platform=browser` bundle succeeds with 0 `node:` references. Typed `GoldenTruth` is shared with `load.ts`.

## Commands run

```
$ git rev-parse HEAD; git branch --show-current; git status --short
dae3cc523e6507a9f378ea1721022d268cc8507f
task/T08-golden-dataset
(clean)

$ node scratch/probe.ts main     # independent design + Gaussian-elimination ridge; no t06-diagnostic import
eligible 240 eq truth true
split reproduced true n 48 192
dates 2026-06-25 2026-09-23
ESS 176.3 p 47
λ 0.1/0.1 worst 0.0671 wz 4.99 idOnlyWorst 0.543 maxType 23.38 nfail 0
λ 0.1/1 0.0628 | 0.1/10 0.1253 | 1/0.1 0.0739 | 1/1 0.0733 | 1/10 0.0846 (all nfail 0)
λ 10/* 0.195–0.196 nfail 2–3 | λ 100/* 0.59–0.60 nfail 22
CV t08-diagnostic-cv 0.1/0.1 x4, 0.1/1 → worst 0.0671
CV rev-a/rev-b/rev-c → worst 0.0733 / 0.0671 / 0.0739, nfail 0
alt splits λ.1/.1 pass 30/30 worst median 0.0616 max 0.0956

$ node scratch/probe.ts cov
pooled: trainSd-plugin 0.7417  50§4 holdout residualCov 0.8125  50§7 residualCov+Var[inh] 0.8292

$ node scratch/probe.ts calib    # λ 0.1/0.1, stored split
calib holdoutMAE 1.2:48.73 1.3:44.87 1.35:43.75 1.4:43.27 1.45:43.46 1.5:44.47 1.6:47.88 2:79.55
calib trainCV-MAE 1.25:50.93 1.3:50.50 1.35:50.69 1.4:51.39
base  holdoutMAE 1:42.15 1.1:40.81 1.2:42.58
$ node scratch/probe.ts calib 1.36..1.46
calib holdoutMAE 1.38:43.40 1.39:43.33 1.4:43.27 1.41:43.25 1.42:43.26 1.43:43.29 1.44:43.35
$ node scratch/probe.ts calib8   # 50 §8 population (parents matched/guest): holdout 39
calib train192 1.4:42.57 1.41:42.51 1.42:42.46 1.45:42.46 1.5:43.27  per-stat argmin 1.5,1.45,1.45,1.5,1.35
calib train8(157) 1.35:46.61 1.4:46.52 1.41:46.55
base train192 1:41.65 1.1:40.14 1.2:41.61

$ node scratch/p.ts   # worker's own t06-diagnostic on committed data
0.1 10 0.1253 champion-s-passion-el-condor-pasa.pow 45->50.64   (changelog: 7.5%, ->48.39)
1 10 0.0846
0.1 0.1 0.0671 wave-of-gratitude-fine-motion.spd 40->37.31

$ cd packages/engine && npx vitest run test/golden
Test Files 2 passed (2)   Tests 45 passed (45)

$ esbuild packages/engine/scripts/golden-context.ts --bundle --platform=browser --alias:@uma/schema=…
gc.js 768.2kb  Done;  grep -c "node:" → 0

$ rm -rf ~/.hermes/cache/scratch/t08r2 t08r2b; git status --short | wc -l
0
```

Reviewed commit: dae3cc5 (task/T08-golden-dataset; fix diff 84c64be..dae3cc5).
