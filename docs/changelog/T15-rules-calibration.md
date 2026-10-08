# T15 — Rules calibration engine implementation

- **Status:** Partial. The engine implementation and the synthetic/golden acceptance are done. The real-roster report waits for H4, and a meaningful real-roster `blueStatGain` value also needs Q-3/Q-5.
- **Branch:** task/T15-rules-calibration
- **Agent / model:** Claude Opus 5.5, medium reasoning (primary; no fallback was needed)
- **Date:** 2026-10-08

## Summary
`@uma/engine` now exports `calibrateRules(ctx, roster, opts?)`. It is the 50 §8 calibration and returns an engine-local `CalibrationReport` (`kind: 'calibration-v1'`):

- **Population:** T06-eligible rows whose two recorded parents are each a matched roster veteran or a guest. Every exclusion is listed per row and counted per reason.
- **Aptitude check:** the full log-likelihood (null when an observed grade has probability 0), a separately named conditional log-likelihood over the possible cells, and reliability tables against the predicted `aptitudeDist`.
- **Stat check:** a fixed `blueStatGain` multiplier grid. Each point refits the 50 §4 ridge on train rows only, with λ re-selected by CV. It reports the holdout-MAE argmin (the suggestion) and a train-CV argmin with its holdout MAE (`holdoutMaeOfTrainCvSelection`), plus a conditional seeded holdout bootstrap (suppressed below 20 holdout rows) and a no-inheritance baseline.
- **Skill check:** exposure-aware (q·E[θ], availability counted once) on a full `fitTrainingModelDetailed` refit for each candidate rules context.

Nothing is applied. A zero-placeholder table is reported as nonidentifiable.

On the golden ×1.3 roster (stored split, 50 §8 population 157/39) the engine suggests **×1.33**. The train-CV selection gives ×1.31, and the bootstrap gives p05/p50/p95 = 1.31/1.33/1.37.

## Files
Created:
- `packages/engine/src/calibrate/index.ts`: `calibrateRules`, `CalibrationOptions`, `CalibrationReport` and its subtypes, the population/split logic, the stat grid, candidate refits, suggestions and the `notCalibrated` list.
- `packages/engine/src/calibrate/aptitude.ts`: the 50 §8.1 aptitude check (log-likelihood, impossible-cell counts, reliability bins, per-aptitude summaries).
- `packages/engine/src/calibrate/skills.ts`: the 50 §8.3 holdout skill check (q·E[θ], guaranteed vs lineage-only, contradictions, own-unique exclusion, reliability).
- `packages/engine/src/calibrate/grid.ts`: grid validation/building (exact decimal ticks), the deterministic argmin tie rule, percentile and a non-cryptographic fingerprint.
- `packages/engine/src/calibrate/context.ts`: `withBlueStatGainMultiplier(ctx, m)`, which returns a new context and never mutates the input.
- `packages/engine/test/calibrate/helpers.ts`: test inputs (golden context, stored split, injected clock/id/timer) and a deep-freeze helper.
- `packages/engine/test/calibrate/golden.test.ts`: 27 tests (F12, interior minimum, the train-CV selection and its holdout MAE, population, grid = full refit, candidate refits, determinism, base/×1.3/×2 contexts, wider/coarser/offset grids, boundary, seeded split, published context, holdout isolation per candidate, aptitude/skill checks, independent recomputation).
- `packages/engine/test/calibrate/edge.test.ts`: 25 tests (empty/small rosters, exclusions, matched/guest/unmatched/matched-missing parents, unread guest sparks, illegal lineage, low or NaN confidence, non-finite stats, duplicate ids, split errors and drops, grid/bootstrap guards, tie rule, immutability with deep-frozen inputs, aptitude/skill contradictions, published context, import purity).
- `packages/engine/test/calibrate/review-r1.test.ts` (review round 1): 19 tests for B1, S1–S4, N1 and N2.
- `packages/engine/src/calibrate/identify.ts` (review round 2, S-A): train-design identifiability of the blue multiplier (column-space projection, saturation fallback, per-fold check).
- `packages/engine/test/calibrate/review-r2.test.ts` (review round 2): 14 tests for S-A, S-B and S-C.
- `packages/engine/test/calibrate/golden-report.ts`: a TEST-ONLY evidence runner. It prints input hashes, summaries and timings, and writes JSON only with `--out`.

Modified:
- `packages/engine/src/index.ts`: T15 exports (see *Public API*).
- `packages/engine/src/model/fit.ts`: `PreparedRow`, `prepareRow`, `seededSplit` and `recency` are now `export`ed. This is a visibility-only change; behaviour is unchanged.
- `docs/OPEN_QUESTIONS.md`: appended Q-155 to Q-158.

## Public API
```ts
calibrateRules(ctx: EngineContext, roster: readonly Veteran[], opts?: CalibrationOptions): CalibrationReport
withBlueStatGainMultiplier(ctx: EngineContext, m: number): EngineContext   // new context, input untouched
CALIBRATION_KIND = 'calibration-v1'
DEFAULT_CALIBRATION_GRID = { min: 0.5, max: 2, step: 0.01 }   // 151 points, fixed
DEFAULT_CALIBRATION_SPLIT_SEED = 't15-holdout'
DEFAULT_BOOTSTRAP = 200
DEFAULT_BOOTSTRAP_SEED = 't15-bootstrap'
CalibrationOptions = { split?, splitSeed?, cvSeed? (default T06 't06-cv'), grid?, bootstrap?, bootstrapSeed?, now?, id?, timer? }
MIN_SEARCH_GRID_POINTS = 3          // review round 1 (S1)
MIN_BOOTSTRAP_HOLDOUT = 20          // review round 1 (S2), statistical guard
COLLINEAR_REL_TOL = 1e-7            // review round 2 (S-A), numeric guard
```
Type exports:
- `CalibrationReport`, `CalibrationOptions`, `CalibrationGrid`, `CalibrationExclusion`;
- `CalibrationPopulationRow`, `CalibrationGridPoint`, `CalibrationSelection`, `CalibrationStatCheck`, `CalibrationStatUncertainty`, `CalibrationSelectionAgreement` (round 1);
- `CalibrationCandidate`, `CalibrationCandidateFit`, `CalibrationSuggestion`, `NotCalibrated`;
- `AptitudeCheck`, `AptitudeStat`, `FullLikelihoodState`, `ImpossibleReason`, `ReliabilityBin`, `SkillHoldoutCheck`, `SkillCellSummary` (the last four were added in round 1);
- `CalibrationBlueIdentification`, `InvalidObservedGrade` (round 2).

Errors are the existing `ModelInputError` codes: `duplicate-id`, `split-unknown`, `split-overlap`, `bad-grid`, `bad-bootstrap`, `bad-multiplier`, `non-finite`.

## Report semantics
- **`population`:**
  - `rosterRows = used + Σ excluded[].count`, with one `rows[]` entry per roster row.
  - Exclusion reasons are the T06 `ExclusionReason` values plus `parent-not-matched-or-guest`. That reason covers an unmatched non-guest parent and a `matchedVeteranId` absent from the roster (`matched-missing`, named in `detail`).
  - A guest or unmatched parent with no recorded sparks is `parent-sparks-unread` (Q-140).
- **`split`:**
  - An explicit split (ids must exist and must not overlap) keeps only used rows. Dropped ids and their reasons are listed in `dropped`, and used rows in neither list are counted in `unused`.
  - Without a split: a seeded 80/20 split over the used rows.
  - `lineageCoupling` counts train→holdout matched-parent references (ADR-0002 limitation; the holdout is not fully independent of train lineage inputs).
- **`aptitude`:**
  - Computed on every used row under the current rules, with no fit.
  - `fullLikelihood` is `'finite'`, `'zero-probability-observed'` or `'no-cells'`. `logLik`/`meanLogLik` are the full log-likelihood over every cell, and they are null unless the state is finite. A p = 0 observation makes the full value −∞, which is reported as null and never as −Infinity or 0.
  - `conditionalLogLik`/`conditionalMeanLogLik` sum over `possibleCells` (p > 0) only. They are named separately and are not the model's likelihood.
  - Impossible cells are counted as `belowBase`, `aboveMax` or `unreachable` (an interior support gap), and the three sum to `impossible` (Q-158).
  - The same fields appear per aptitude, each with its own `status`.
  - `degenerateCells` (max p ≥ 1 − 1e-12) carry no information. When every cell is degenerate the status is `uninformative` (with an `uninformative` reason) rather than `ok`, and the check does not count towards `complete`.
  - The likelihood fields stay populated when the status is `uninformative`: a near-degenerate observed grade (0 < p < 1e-12) still gives a finite, very negative `logLik` (about −29.9 in review 2's Q3 probe). `uninformative` describes discrimination, not whether a likelihood exists.
  - Observed values that are not a schema grade (e.g. 'Z', 'a', a number, null, a missing key) are excluded from every cell count and the likelihood and counted in `invalidObserved` (overall and per aptitude; an aptitude with no valid cell is `insufficient-data`). The first 20 appear in `invalidExamples`, with the raw string (or null) and its type. They are never classified below-base (round 2, S-B).
  - Reliability: one event per (uncertain cell, grade with 0 < p < 1), in 10 bins.
  - Diagnostics only; no rule suggestion comes from this check.
- **`stats`:**
  - For each grid m: y = stat − (E₀ + m·(E₁ − E₀)), where E₀/E₁ are E[inh | recorded lineage] with `blueStatGain` × 0 and × 1. This is exact because `blueStatGain` only scales event gains.
  - Design and recency weights follow 50 §4 from train rows only. `fitRidge` re-selects λ per stat by 5-fold CV on train rows.
  - Two criteria per point:
    - `holdoutMae`: Σ over stats of the unweighted holdout MAE, which equals T06 `report.holdout.mae` (tested against full refits at six multipliers, |Δ| < 1e-7, same λ);
    - `trainCvMae`: Σ over stats of the recency-weighted OOF MAE on train rows.
  - `selected` is the holdout-MAE argmin (50 §8). `trainCvSelected` is the train-CV argmin, and its holdout MAE is `evaluation.holdoutMaeOfTrainCvSelection`. It was called `unbiasedHoldoutMae` before round 1; the new name avoids overclaiming, because ADR-0002 lineage coupling remains. `selectedHoldoutMaeIsPostSelection: true` is explicit.
  - Status values:
    - `suggested`;
    - `boundary`: the argmin is at a grid end, so no suggestion is made and a warning says to widen the grid;
    - `nonidentifiable`: no TRAIN row's E[inh] depends on `blueStatGain`; or every train row's sensitivity is the same per stat (absorbed by the intercept); or every sensitive stat's sensitivity lies in the column space of the train design (`design-confounded`: a selected m would be ridge-only). Reasons are given, including holdout-only sensitivity, a zero table and no inheritance turns (round 1 N2, round 2 S-A). `stats.identification` gives the per-stat relative residuals, the basis, the rank, saturation and the per-fold status;
    - `insufficient-data`: fewer than 5 train rows, no holdout row, or fewer than 3 grid points. With 1–2 points the grid MAEs are still reported, but nothing is selected (round 1, S1).
  - `bootstrap`: a seeded resample of holdout rows with the split and train fit fixed. It is conditional and covers holdout sampling only, not full uncertainty. It reports the argmin p05/p50/p95, the share at a boundary, and whether the interval contains 1.
    - It is null when disabled, when there are fewer than 20 holdout rows, or when no search ran. `uncertainty.status`/`reason`/`scope` say which.
  - `selectionAgreement` compares the holdout and train-CV selections against the interval. `withinInterval` is null when there is no interval.
    - A warning is raised when they disagree beyond the interval, or disagree with no interval to judge (round 1, S2).
  - `withoutInheritance`: the same procedure with y = stat.
- **`candidates`:**
  - m = 1 (current), plus the suggested m when it differs from 1. Each candidate gets a full `fitTrainingModelDetailed` refit with the same split and CV seed (ADR-0002 §2.11).
  - Each reports holdout MAE, coverage80 with and without inheritance, λ, σ, covariance warnings and a train-parameter fingerprint.
  - If a refit's MAE differs from the grid value by more than 1e-6, a warning is raised.
- **`skills`:**
  - Per candidate, holdout cells are scored against q·E[θ] from that candidate's refit, with availability counted once. Contradictions (q = 0, y = 1) are excluded and counted (Q-131), the own unique skill is excluded (Q-142), and underflow cells are counted.
  - Because `blueStatGain` does not change q, the skill check is identical across blue candidates. The report says so, and the check does not discriminate blue multipliers.
  - With zero scored cells, overall or in the guaranteed/lineage-only subgroup, `logLik`, `meanLogLik` and `brier` are null and `status` is `insufficient-data`. `skills.status` is `ok` only when every candidate scored ≥ 1 cell (round 1, S4).
- **`suggestions`:**
  - Only `{rule: 'blueStatGain', kind: 'multiplier'}`, and only when the status is `suggested`.
  - Each carries `current`, `proposed`, `change`, `applied: false`, `basis: 'holdout-mae'` and `consistentWithCurrent`: whether the conditional bootstrap interval contains 1, or null (unknown) when no interval is available.
- **`notCalibrated`:** every other rule, with `verified`/`placeholder` flags and the reason it is not estimated (Q-157). `blueStatGain` is included here whenever no suggestion is made.
- **`status`:** `complete` when the aptitude check is `ok` (informative), the stat check reached `suggested`/`boundary`, and the skill check is `ok`; `partial` when some did; `unavailable` when none did.
- **`runtime`:** measured from the injected timer. It is never an input to any result.

## Decisions
- **Engine-local report, no schema change (Q-155).** 01 has no calibration contract, and 80 keeps browser/apply integration out of T15.
- **The population reuses T06 `prepareRow`, then applies the 50 §8 parent filter.** The calibration rows are then exactly the rows the training model could use, with the same low-confidence, unknown-id, illegal-lineage, unread-sparks and non-finite guards.
- **The default split is seeded over the 50 §8 population** (`t15-holdout`). An explicit split drops ineligible ids into `dropped` instead of throwing. This makes the stored golden split usable: its 44 unmatched-parent rows are dropped and counted.
- **The selection criterion is holdout MAE as the spec says. The train-CV selection and its holdout MAE are reported separately (Q-156).** No claim is made that the post-selection holdout MAE is independent proof.
- **Fixed 0.01 grid over [0.5, 2.0]; not adaptive and no coarse/refine step.** This is the T08 feasibility grid. The fixed grid's measured cost is about 1.1–1.3 s, so no refinement was needed. Wider (0–4, 0.5–3), narrower (1–2), coarser (0.05) and offset (0.73–1.91, step 0.03) grids are tested. Every 0.01 grid that contains the default one returns the same argmin (1.33).
- **The tie rule prefers the multiplier closest to 1, then the smaller one.** Ties are relative 1e-12. It is deterministic and conservative, never towards 1.3.
- **The multiplier is relative to the context's current table.** The golden ×1.3 and ×2 contexts recover ≈1.02 and 0.66, i.e. 1.33 and 1.32 in absolute terms. There is no planted-value fallback anywhere.
- **Grid points reuse the T06 ridge (`fitRidge`) but not the full `fitTrainingModelDetailed`.** Σ_N and θ do not enter MAE. Full refits are done for the candidate contexts, and the tests prove the grid value equals the full refit at six multipliers.
- **Impossible aptitude cells are counted and not smoothed. They null the full likelihood, and the finite sum is reported separately as conditional (Q-158, revised in round 1).**
- **Timer fallback.** The engine entry purity test forbids `Date.now(`. Without `performance`, runtimes are 0, which is documented.

## Deviations from spec
- 50 §1 `calibrateRules(ctx, roster)` gains an optional third `opts` argument. The two-argument call still works with defaults.
- 50 §8 says "output a CalibrationReport with suggested rule multipliers". Only `blueStatGain` can be suggested. All other rules are listed as not calibrated with reasons, because activations are unobserved and no estimator for them is specified (Q-157).

## Cross-task edits
- `packages/engine/src/model/fit.ts` (T06): added `export` to `PreparedRow`, `prepareRow`, `seededSplit` and `recency`. No behavioural change; the whole T06 suite still passes (292/292 engine tests).
- `packages/engine/src/index.ts`: added T15 exports, as the task allows.

## Verification
Environment: Node on PATH is v25.9.0 (`/opt/homebrew/bin/node`; satisfies `>=22.18`). The suggested `/Users/willjose/.hermes/cache/scratch/node-v22.18.0-darwin-arm64` does not exist on this machine (`ls: … No such file or directory`), so it was not used. pnpm 11.22.0.

TDD: the tests were committed first (`d50c61c`). Before the implementation, `vitest run test/calibrate` gave `Test Files 2 failed (2)` because the exports were missing. The implementation followed in `8e0ddc2`.

```
$ pnpm install --frozen-lockfile
Done in 6.8s using pnpm v11.22.0

$ pnpm -r lint && pnpm -r typecheck && pnpm -r test      # exit 0
packages/schema test:       Tests  149 passed (149)
packages/master-data test:       Tests  82 passed (82)
apps/api test:       Tests  111 passed (111)
packages/engine test:  Test Files  18 passed (18)
packages/engine test:       Tests  292 passed (292)
apps/web test:       Tests  124 passed (124)

$ pnpm --filter @uma/engine exec vitest run test/calibrate
      Tests  52 passed (52)          # 27 golden + 25 edge
```
The first full run failed one existing test, `test/model/entry.test.ts` (an entry purity test that rejects `Date.now(`), because of the timer fallback. That fallback was removed and the gates re-ran green, as shown above.

Mutation checks (temporary, reverted, verified with `git status`):
- Counting availability twice (`p = q·q·E[θ]`) fails `skill expected count = Σ q·E[θ]`.
- Adding holdout rows to the grid ridge fit fails `train criteria, λ choices and candidate fit parameters are bit-identical`.

Golden evidence: `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/runA.json`, run twice (A and B). Excerpt of real output (MAE = Σ over 5 stats). These are **historical first-candidate figures**; the round-1 output is under *Review round 1*:
```
x1.3 roster, golden context, stored split | complete/suggested | used 196 split 157/39 | holdout-argmin 1.33 (40.939) trainCV-argmin 1.31 unbiased 41.020 current 88.453 noInh 332.506 | boot 1.31/1.33/1.37 | apt ll -235.24 imp 0 | skills E770.7/O797 z1.25 | ms total 1249 grid 1084 (151 pts) fits 126 (2) boot 7
base roster, golden context, stored split | complete/suggested | used 196 split 157/39 | holdout-argmin 1.03 (35.908) trainCV-argmin 1 unbiased 36.317 current 36.317 noInh 261.802 | boot 1/1.03/1.06 | ... | ms total 1285 grid 1135 (151 pts) fits 123 (2)
x1.3 roster, published context | partial/nonidentifiable | used 196 split 157/39 | ... | apt ll 0.00 imp 87 | skills E734.7/O751 z0.81 | ms total 48 grid 0 (0 pts) fits 29 (1)
x1.3 roster, golden ×1.3 context | holdout-argmin 1.02 trainCV-argmin 1.01 | boot 1.01/1.02/1.05
x1.3 roster, golden ×2 context   | holdout-argmin 0.66 trainCV-argmin 0.65 | boot 0.66/0.66/0.68
x1.3 roster, grid 0..4 step 0.01 | holdout-argmin 1.33 (40.939) | ms total 3310 grid 3152 (401 pts)
x1.3 roster, seeded split t15-holdout | split 156/40 | holdout-argmin 1.32 trainCV-argmin 1.32 | boot 1.29/1.32/1.36
x1.3 seeded t15-alt-1..5: holdout-argmin 1.32, 1.30, 1.30, 1.31, 1.34; trainCV-argmin 1.32, 1.31, 1.31, 1.32, 1.32
base seeded t15-alt-1..5: holdout-argmin 1.01, 1.00, 1.01, 1.01, 1.04; trainCV-argmin 1.02, 1.01, 1.01, 1.02, 1.02
```
- *Superseded (review round 1, B1):* the first candidate printed the published context's `apt ll 0.00` and called it honest. With no inheritance turns every aptitude is predicted to stay at the base grade with p = 1, and 87 observed cells have p = 0, so the true full log-likelihood is −∞. That 0.00 was only the sum over possible cells. It is now `logLik: null`, `fullLikelihood: 'zero-probability-observed'`, `conditionalLogLik: 0` over 1,873 `possibleCells`, and the status is `uninformative`.
- The 1.33 result agrees with the T08 TEST-ONLY diagnostic on the same population (50§8/50§8: 1.33, λ fixed 0.1/0.1). Here λ is re-selected per point, so the agreement is consistent but not identical code.

Determinism and input integrity:
```
identical except timings: True 17          # runA.json vs runB.json, runtime *Ms fields removed
published inputs unchanged                 # git diff --quiet HEAD -- packages/engine/test/golden apps packages/schema packages/master-data docs/specs
6a02f36050f92899f55ffc2a78ab355d12b545c0b41888e6b7e110619c707911  packages/engine/test/golden/roster.json
8982ab4aba43c4c770fc41260361a29255e2cccd57a5b3db70075c23f94f5434  packages/engine/test/golden/roster.calibration-x1.3.json
1ccf0d5a9c2b1fb6d9626126c22a0a2c4d9eb634af79457097a6dc68eceed0b2  packages/engine/test/golden/truth.json
352e5ea3350fb39a68fd38815938d01565e7e1ed8e8aff0e2510f036d22a95e7  apps/web/public/master/global-20260930/rules.json
```
The three golden hashes equal those recorded in the T08/T06 changelogs.

Runtime, measured on the dev Mac (Node 25.9.0, warm):
- One full `fitTrainingModelDetailed` on the 260-row golden roster takes 57–83 ms, so 151 full fits would be about 9–12 s.
- One `fitRidge` (192 rows, 46 features, 12-point λ CV) takes about 7.3 ms. That is why the grid uses the ridge alone, plus full refits only for the candidates.
- A default `calibrateRules` takes about 1.25–1.56 s in total: grid 1.08–1.29 s for 151 points, two candidate refits 0.11–0.22 s, bootstrap (200) 7–31 ms. A 401-point grid takes 3.3 s.
- The `test/calibrate` suite takes 17.6 s.
- None of this is a browser or Worker measurement.

Not run: the golden generator command, any recursive build, and the web build. No web files changed.

## Open questions / follow-ups
- Q-155: `CalibrationReport` is engine-local and has no apply path.
- Q-156: holdout selection vs the train-CV selection; round-1 guards (≥ 3 grid points, bootstrap ≥ 20 holdout rows, identifiability on train rows).
- Q-157: only `blueStatGain` can be suggested; zero placeholders are nonidentifiable.
- Q-158: impossible aptitude grades null the full likelihood; they are counted below-base/above-max/unreachable; the check is uninformative when every cell is degenerate (revised in round 1).
- **H4 (blocking for Done):** run `calibrateRules(loadContext(master, master.rules), realRoster)` on ≥ 20 imported real veterans and attach the report: population/exclusion counts, aptitude impossible counts, skill contradictions, runtime and input hashes. With the published rules (zero `blueStatGain`, no turns) the stat check will be `nonidentifiable`. A real multiplier needs Q-3/Q-5 values first.
- **Browser consumer (separate reviewed task, T13/S07):** worker wiring, progress/cancellation (the call is synchronous, about 1.3 s on golden-sized data in Node, with no progress callback), display of `notCalibrated` and the evaluation caveats, and the apply/refit flow (Q-141, Q-155). S07 calibration stays disabled until then.
- Follow-up: the `test/calibrate` suite takes about 18 s (about 21–31 s after round 2 adds 14 tests) because it runs many full calibrations. Memoisation is already used, and further trimming is optional.
- No `TODO`s in the code.

## Review round 1
Review: `docs/reviews/T15-review-1.md` (CHANGES_REQUESTED: B1, S1–S4, N1, N2), against HEAD `1a484d6`. The reviewer's evidence under `~/.hermes/cache/scratch/t15-review-r1/` was read only, never modified. My scratch is `~/.hermes/cache/scratch/t15-fix-r1/`.

The TDD order is visible in git. Tests were committed first (`efe43eb T15: failing review-1 tests`): the new `test/calibrate/review-r1.test.ts`, plus updates to three existing assertions that pinned the old semantics (edge: impossible grade; golden: renamed evaluation, published aptitude status). Real RED output against the unchanged candidate code:
```
$ pnpm exec vitest run test/calibrate          # in packages/engine, before any src change
 × impossible aptitude grades null the full log-likelihood; ...   expected undefined to be 'zero-probability-observed'
 × published context: 87 zero-probability cells -> full logLik null ...   expected undefined to be 'zero-probability-observed'
 × golden ×1.3: no impossible cell -> the full likelihood is the actual finite value   expected undefined to be 'finite'
 × pinkGradeGain 2/2/2 creates interior gaps: classified unreachable ...   expected undefined to be 34
 × published context: the 87 impossible cells reconcile ...   expected NaN to be 87
 × the minimum is 3 points   expected undefined to be 3
 × grid { min: 1.3, max: 1.3, step: 0.01 } (1 point(s)) ...   expected 'suggested' to be 'insufficient-data'
 × grid { min: 1.3, max: 1.31, step: 0.01 } (2 point(s)) ...   expected 'boundary' to be 'insufficient-data'
 × minimum holdout for the bootstrap is documented (20)   expected undefined to be 20
 × 5 train + 1 holdout: bootstrap null with a reason ...   expected { resamples: 100, …(6) } to be null
 × golden ×1.3: bootstrap available, labelled conditional ...   TypeError: Cannot read properties of undefined (reading 'status')
 × selectionAgreement: outside the reported interval ...   TypeError: selectionAgreement is not a function
 × no scored cell at all: totals null, status insufficient-data ...   expected undefined to be 'insufficient-data'
 × an empty subgroup is null while the other keeps its real metrics   expected undefined to be 'insufficient-data'
 × golden: real numeric metrics, status ok   expected undefined to be 'ok'
 × holdoutMaeOfTrainCvSelection replaces unbiasedHoldoutMae   expected undefined to be 41.019800926455574
 × holdout-only sensitivity (train rows carry no parent blue spark) is nonidentifiable   expected 'suggested' to be 'nonidentifiable'
 × blueIdentifiability: zero, holdout-only, constant ... signals   TypeError: blueIdentifiability is not a function
 × (golden) the train-CV selection ... holdout MAE beats current rules   expected undefined to be 41.019800926455574
 × (golden) proposes no blueStatGain factor and says why   expected 'ok' to be 'uninformative'
 Test Files  3 failed (3)
      Tests  20 failed | 51 passed (71)
```
After the RED commit I made one change to a test. In the S2 one-row test, a conditional `if (holdout !== trainCv) expect(warning)` became an unconditional assertion that the selections differ and the disagreement warning is present. During RED that test already failed earlier, on `bootstrap` not being null.

GREEN:
```
$ pnpm exec vitest run test/calibrate
 Test Files  3 passed (3)
      Tests  71 passed (71)          # 27 golden + 25 edge + 19 review-r1
   Duration  17.36s
```

### B1: full aptitude likelihood (blocking)
- `aptitude.ts` changes, applied to the aggregate and to every per-aptitude entry:
  - `fullLikelihood: 'finite' | 'zero-probability-observed' | 'no-cells'`.
  - `logLik`/`meanLogLik` are the FULL value and are null unless the state is finite. They are JSON-safe: null, never −Infinity or a finite stand-in.
  - The old finite sum is now `conditionalLogLik`/`conditionalMeanLogLik`, with the denominator `possibleCells`.
- Status:
  - The aggregate status is `ok | uninformative | insufficient-data`. Each aptitude has `ok | uninformative`.
  - All-degenerate cells give `uninformative` with an `uninformative` reason, plus a report warning. That check no longer counts towards `complete` (`index.ts` status uses `aptitude.status === 'ok'`).
- The impossible-cell warning now says the full log-likelihood is −∞ (null) and names the conditional denominator.
- Published context (test `B1 published context`; evidence run):
  - `apt uninformative full zero-probability-observed ll null cond 0.00/1873 imp 87 (below 0 above 87 gap 0)`;
  - report `partial/nonidentifiable`;
  - every per-aptitude entry is `uninformative`, and those with impossible > 0 have a null full logLik.
- Golden ×1.3: `apt ok full finite ll -235.24 cond -235.24/1960 imp 0`. That is the actual likelihood, the same value as before; the independent public-API recomputation test still passes.
- Edge row with a below-base turf G: `logLik` null, `possibleCells = cells − 1`, finite negative `conditionalLogLik`, `status: ok` (informative cells remain), and dirt stays `finite`.
- Documentation: Q-158 is rewritten. The old "`apt ll 0.00` is honest" claim and its figure are kept above and labelled *Superseded*. The evidence runner prints the full and conditional values and the state.

### S1: one- and two-point grids
- New constant `MIN_SEARCH_GRID_POINTS = 3`. With fewer points the stat check is `insufficient-data`, with the reason `need ≥ 3 grid points for a multiplier search`:
  - grid MAEs and the current point are still reported as diagnostics;
  - `selected`/`trainCvSelected`/`bootstrap` are null and `uncertainty.status` is `grid-too-small`;
  - there is no suggestion and only the m = 1 candidate is refitted;
  - `blueStatGain` is listed in `notCalibrated`.
- `atBoundary` no longer needs the `ms.length > 1` special case.
- Tests pin `{1.3,1.3}` (1 point; before the fix: `suggested`) and `{1.3,1.31}` (2 points; before the fix: `boundary`). Default grid: still 151 points, `suggested`.

### S2: tiny holdout and the bootstrap
- Decision: `MIN_BOOTSTRAP_HOLDOUT = 20`. This is a statistical guard, not a game fact.
  - Below 20 holdout rows the percentile bootstrap of the argmin rests on very few distinct resamples: there is exactly 1 at n = 1, and C(2n−1, n) = 126 at n = 5. That gives zero- or near-zero-width intervals.
  - 20 is a conservative conventional floor. The rationale is in the `index.ts` doc comment and in Q-156.
  - The golden holdouts (39/40 rows) are above it, so the published golden figures are unchanged.
- Below 20, or with `bootstrap: 0`:
  - `bootstrap` is null;
  - `uncertainty: {status: 'insufficient-holdout' | 'disabled', reason, minHoldout: 20, scope}`;
  - `consistentWithCurrent` is null (unknown, not false);
  - `selectionAgreement.withinInterval` is null.
- The 50 §8 holdout-MAE selection is still reported and suggested, as the spec requires. The "only N holdout rows: noisy" warning stays.
- `uncertainty.scope` says the interval is holdout-row resampling, conditional on the fixed split and train fit, and is not full uncertainty.
- `selectionAgreement {holdout, trainCv, difference, withinInterval}`:
  - The warning `selections disagree beyond the reported conditional holdout-bootstrap interval` is raised when the train-CV argmin falls outside [p05, p95].
  - When no interval exists, the warning is `… disagree … and no bootstrap interval is available`.
- Controlled one-row test (the reviewer's P5 shape, 5 train + 1 holdout): selections 1.42 vs 1.97, bootstrap null, `insufficient-holdout`, `consistentWithCurrent: null`, disagreement warning present, JSON round-trip equal.
- Unit tests cover in-interval (true), out-of-interval (false) and no interval (null).
- Golden ×1.3: `available`, `withinInterval: true` (1.31 in [1.31, 1.37]), no disagreement warning.

### S3: unreachable interior grades
- `ImpossibleReason = 'below-base' | 'above-max' | 'unreachable'`:
  - below-base: observed index < trainee base;
  - above-max: observed index > the highest grade with p > 0;
  - unreachable: otherwise, a gap inside the support.
- Counts are kept overall and per aptitude, and `belowBase + aboveMax + unreachable = impossible` holds at both levels (tested). Examples carry the new reason.
- pinkGradeGain 2/2/2 test, with an independent classification through the public API: unreachable = 34 (the reviewer's P7 gap count), aboveMax and belowBase equal the independent counts, and the per-aptitude gaps match.
- Published context reconciles: 87 = 0 + 87 + 0.

### S4: zero scored skill cells
- `SkillHoldoutCheck` and the `SkillCellSummary` subgroups (guaranteed / lineage-only) gain `status: 'ok' | 'insufficient-data'`.
- `logLik`, `meanLogLik` and `brier` are now `number | null`, and are null when cells = 0. `z` was already null.
- `skills.status` is `ok` only when every candidate scored ≥ 1 cell. Otherwise it is `insufficient-data`, so the report is not `complete`, and a warning is added per candidate.
- Tests:
  - A context with no deck/innate sources and zero green/white/race/scenario activation: cells 0, every total and subgroup metric null, `skills.status` insufficient-data, report not `complete`, JSON round-trip equal.
  - Deck/innate sources removed only: the guaranteed subgroup is null and insufficient-data, while lineage-only keeps its real negative logLik and stays `ok`.
  - Golden: real numeric metrics, all statuses `ok`.

### N1: precise naming
- `evaluation.unbiasedHoldoutMae` was renamed to `evaluation.holdoutMaeOfTrainCvSelection`. The API is engine-local and unmerged, so no compatibility alias was kept.
- The note no longer says "unbiased". It says holdout targets were not used to choose the train-CV selection, and that ADR-0002 lineage coupling means neither value is a fully independent evaluation.
- Also updated: the source doc comments, the golden test, the evidence runner label (`holdoutMaeOfTrainCvSel`), Summary, Report semantics, Decisions and Q-156. A test asserts the old key is absent and the note mentions lineage and not "unbiased".

### N2: identifiability on train rows
- `blueIdentifiability(trainD, holdD)` replaces the any-used-row sensitivity check:
  - nonidentifiable when no train row is sensitive, and the reason names any holdout-only sensitivity (the holdout is evaluation only);
  - nonidentifiable when every train row has the same sensitivity per stat (relative tol 1e-9). Then m·d is a constant per-stat shift absorbed by the intercept, and the reason says so. No argmin is fabricated.
  - Any within-train variation stays identifiable.
- The zero-table and no-turns reasons are still appended where they apply.
- Tests:
  - Controlled: 34 guest/guest rows, with the 28 train rows' parent blue sparks removed, give `nonidentifiable` ("no train row … 6 holdout row(s) do") and no suggestion. Before the fix: `suggested` 1.21 with train-CV argmin 1.
  - Unit cases: zero, holdout-only, constant, and varying.
  - Golden: still `suggested`.

### Verification (round 1)
Environment: Node v25.9.0, pnpm 11.22.0.
```
$ pnpm install --frozen-lockfile --offline
Done in 329ms using pnpm v11.22.0

$ pnpm -r lint && pnpm -r typecheck && pnpm -r test      # exit 0
packages/schema test:       Tests  149 passed (149)
packages/master-data test:       Tests  82 passed (82)
apps/api test:       Tests  111 passed (111)
packages/engine test:  Test Files  19 passed (19)
packages/engine test:       Tests  311 passed (311)
apps/web test:       Tests  124 passed (124)
```
The first recursive gate attempt ran at the same time as the two evidence runs, and failed once. The failure was the unchanged existing test `deep-frozen context rules and roster produce the same report`: `Test timed out in 5000ms` under the CPU contention. Run alone, the gates gave the exit-0 output above. Its default 5 s timeout is listed as a follow-up; I did not change it, because that would be an acceptance or timeout change outside this fix.

Evidence: `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/t15-fix-r1/run{A,B}.json`, run twice, both exit 0.
```
identical except timings: True 17
x1.3 roster, golden context, stored split | complete/suggested | used 196 split 157/39 | holdout-argmin 1.33 (40.939) trainCV-argmin 1.31 holdoutMaeOfTrainCvSel 41.020 current 88.453 noInh 332.506 | boot 1.31/1.33/1.37 | apt ok full finite ll -235.24 cond -235.24/1960 imp 0 (below 0 above 0 gap 0) | skills E770.7/O797 z1.25 ok E770.7/O797 z1.25 ok | ms total 1457 grid 1273 (151 pts) fits 144 (2) boot 8
base roster, golden context, stored split | complete/suggested | holdout-argmin 1.03 (35.908) trainCV-argmin 1 holdoutMaeOfTrainCvSel 36.317 | boot 1/1.03/1.06 | apt ok full finite ll -235.24
x1.3 roster, published context | partial/nonidentifiable | boot - (not-run) | apt uninformative full zero-probability-observed ll null cond 0.00/1873 imp 87 (below 0 above 87 gap 0) | skills E734.7/O751 z0.81 ok
x1.3 roster, golden ×1.3 context | holdout-argmin 1.02 trainCV-argmin 1.01 | boot 1.01/1.02/1.05
x1.3 roster, golden ×2 context   | holdout-argmin 0.66 trainCV-argmin 0.65 | boot 0.66/0.66/0.68
x1.3 roster, grid 0..4 step 0.01 | holdout-argmin 1.33 (40.939) | boot - (disabled)
x1.3 roster, seeded split t15-holdout | split 156/40 | holdout-argmin 1.32 trainCV-argmin 1.32 | boot 1.29/1.32/1.36
x1.3 seeded t15-alt-1..5: holdout-argmin 1.32, 1.30, 1.30, 1.31, 1.34; trainCV-argmin 1.32, 1.31, 1.31, 1.32, 1.32
base seeded t15-alt-1..5: holdout-argmin 1.01, 1.00, 1.01, 1.01, 1.04; trainCV-argmin 1.02, 1.01, 1.01, 1.02, 1.02
6a02f36050f92899f55ffc2a78ab355d12b545c0b41888e6b7e110619c707911  packages/engine/test/golden/roster.json
8982ab4aba43c4c770fc41260361a29255e2cccd57a5b3db70075c23f94f5434  packages/engine/test/golden/roster.calibration-x1.3.json
1ccf0d5a9c2b1fb6d9626126c22a0a2c4d9eb634af79457097a6dc68eceed0b2  packages/engine/test/golden/truth.json
352e5ea3350fb39a68fd38815938d01565e7e1ed8e8aff0e2510f036d22a95e7  apps/web/public/master/global-20260930/rules.json
$ git diff --quiet HEAD -- packages/engine/test/golden apps packages/schema packages/master-data docs/specs && echo "published inputs unchanged"
published inputs unchanged
```
- Golden ×1.3 is still 1.33, in [1.2, 1.4]. I compared all 17 runs read-only against the reviewer's `t15-review-r1/runA.json` for the first candidate: selected, trainCvSelected, currentHoldoutMae, maeAt, bootstrap, withoutInheritance, suggestions, candidates (MAE, coverage, fingerprint), skills (excluding the new status), aptitude impossible counts and the old `unbiasedHoldoutMae` against the new `holdoutMaeOfTrainCvSelection` gave `diffs []`. The hashes are equal.
- Not run: the golden generator, any recursive build, and the web build. No web, schema, fixture, golden, master or contract files changed.
- `fit.ts` keeps the round-0 visibility-only exports and was not touched in this round.

### Decisions (round 1)
- Null rather than −Infinity for an impossible full likelihood (JSON safety), with an explicit state enum rather than overloading null.
- `uninformative` is a check status, not a warning only: a check that cannot discriminate must not make a report `complete`.
- `MIN_SEARCH_GRID_POINTS = 3` is the smallest grid with an interior point. `MIN_BOOTSTRAP_HOLDOUT = 20` is a documented statistical guard. Neither changes the default grid, the golden holdouts or the F12 band.
- The 50 §8 holdout argmin is still suggested on small holdouts, because the spec selects on the holdout; only the uncertainty and agreement fields become unknown.
- The identifiability check uses exact zero for "no sensitivity" (as before) and a relative 1e-9 tolerance for "constant across train rows".

### Follow-ups (round 1)
- The existing edge test `deep-frozen context rules and roster produce the same report` runs a full calibration under the default 5 s Vitest timeout. It passes alone (1118 ms in a verbose run) but timed out once under CPU contention. A separate decision is needed on whether to give it an explicit timeout. *(Resolved in review round 2, S-C.)*
- A browser consumer must display `fullLikelihood`/`uninformative`, `uncertainty.reason` and `selectionAgreement`, and never show a null as 0 (S07 task, Q-155).
- H4 real-roster run and Q-3/Q-5 are unchanged.

## Review round 2
Review: `docs/reviews/T15-review-2.md` (PASS, no blockers; should-fix S-A, S-B, S-C and two nits), against HEAD `dffb549`. The coordinator chose to fix S-A/S-B/S-C in this second and final worker round, before the browser consumer. The reviewer's scratch `~/.hermes/cache/scratch/t15-review-r2/` (probe.mts, probe-*.json) was read only, never modified. My scratch is `~/.hermes/cache/scratch/t15-fix-r2/`.

TDD order is in git: `bbadbbf T15: failing review-2 tests` adds `test/calibrate/review-r2.test.ts` only; the fix commit follows. Real RED output against the unchanged `dffb549` code:
```
$ pnpm exec vitest run test/calibrate/review-r2.test.ts      # in packages/engine, before any src change
 × numeric guards are documented and are not game facts              TypeError: actual value must be number or bigint, received "undefined"
 × Q13: d = 240 × scenario indicator (planted k = 1.3) is design-confounded   expected 'suggested' to be 'nonidentifiable'
 × Q13: d = 240 × scenario indicator (planted k = 3) is design-confounded     expected 'boundary' to be 'nonidentifiable'
 × genuine within-cell signal on the same small guest roster stays identified  TypeError: Cannot read properties of undefined (reading 'status')
 × golden ×1.3: identified on the full train design, still 1.33 / train-CV 1.31 TypeError: Cannot read properties of undefined (reading 'status')
 × Q7.unitTiny: a 1e-8 relative variation is not within-train signal  expected true to be false
 × a group-indicator sensitivity is design-confounded; a within-group one is identified   expected true to be false
 × mixed stats: one confounded and one independent stat is identified ...  TypeError: Cannot read properties of undefined (reading 'status')
 × a column-space test that is vacuous ... falls back to the intercept only TypeError: Cannot read properties of undefined (reading 'saturated')
 × "Z" on turf: excluded with a reason and a count, not an impossible cell  expected undefined to be 1
 × non-string, missing, null and lowercase values are invalid ...      expected undefined to be 5
 × every grade invalid (or no aptitudes object) ...                     TypeError: Cannot read properties of undefined (reading 'turf')
 × the shared timeout is bounded and above the Vitest default           TypeError: actual value must be number or bigint, received "undefined"
      Tests  13 failed | 1 passed (14)
```
(The one passing RED test is the scale-aware unit test. Against the old two-argument `blueIdentifiability` it passed vacuously, because a varying d was already "identifiable"; after the fix it exercises the projection.) Before the fix, the existing edge suite with `--testTimeout=800` timed out on the deep-frozen and two contradiction tests (`Error: Test timed out in 800ms`). This demonstrates the S-C mechanism: a full calibration takes about 1.1 s, so any contention that pushes it past the default timeout fails the test, not an assertion.

GREEN (after the fix):
```
$ pnpm exec vitest run test/calibrate/review-r2.test.ts
      Tests  14 passed (14)
$ pnpm exec vitest run test/calibrate --no-file-parallelism --reporter=verbose     # serial
      Tests  85 passed (85)          # 27 golden + 25 edge + 19 review-r1 + 14 review-r2
   Duration  30.58s
```

### S-A: blue sensitivity collinear with the train design
- I inspected the design actually used: `statGrid` builds `featureNames(ctx, train plans)` + `featureVector`, with the intercept in column 0 and `isId` from `isCardIdFeature`. That is the same construction `fitTrainingModelDetailed` (`fit.ts` lines 299–314) uses for the candidate refits on the same train ids. The CV folds (`cvFolds(trainIds, cvSeed)`) fit on train rows minus one fold. That design builder is now factored into `trainDesign()` in `calibrate/index.ts` and shared by the identifiability test and `statGrid`. `fit.ts` is unchanged.
- I measured it before coding (scratch `design.mts`, read-only against the candidate):
  - Golden stored split: 157 train rows, 47 columns, rank 38, per-stat relative residual 0.61–0.68 on the full design.
  - Q13 / Q7 guest-only rosters: 27 train rows, 44 columns, full rank 27 = n (**saturated**: every d is trivially in the span, so a full-design test alone would reject everything, including Q7.orig's genuine signal). On the structural columns (non-card-id, rank 17): Q13 d residual ≈ 1e-16 to 1e-31 (exactly in the span), Q7.orig 0.51–0.60 (genuine), Q7.sameBlue ≈ 5e-17 (constant).
- The fix is the new `src/calibrate/identify.ts`:
  - It builds an orthonormal basis of the train design columns by modified Gram–Schmidt with columns normalised to unit length and a second full reorthogonalisation pass. A column joins the basis when its residual exceeds `RANK_REL_TOL = 1e-10` (relative). For each sensitive stat, d is normalised, projected twice, and its relative residual ‖d − Pd‖/‖d‖ is compared with `COLLINEAR_REL_TOL = 1e-7`. It uses plain loops and no new library.
  - Saturation: if the full design's rank is ≥ the number of train rows, it falls back to the structural columns (everything but card-id columns), then to the intercept alone. `saturated` and `basis` are reported, and a warning says that beyond the basis the multiplier fit rests on the ridge penalty.
  - Statuses: `no-train-sensitivity`, `intercept-confounded` (the round-1 constant case, now also scale-aware), `design-confounded` (every sensitive stat's residual is at or below the tolerance) and `identified`.
  - The sensitivity guard is now scale-aware. A stat is sensitive when max|d| > `SENSITIVITY_REL_TOL = 1e-9` × max(1, max |observed stat| on train rows), so round-off-sized d (1e-12) no longer counts. The old `CONSTANT_SIGNAL_TOL` is replaced; constancy is now judged by the same projection onto the intercept, at the relative tolerance 1e-7.
  - The tolerances are numeric guards. Projection round-off here is about 1e-15 to 1e-17 and real signals are about 0.5 to 0.7, so 1e-7 sits many decades from both. They are not game facts, and the doc comments and Q-159 say so.
- Mixed-stat policy: m is one shared multiplier of the blue table. It is identified when at least one sensitive stat has a non-negligible residual. Confounded stats are listed in `identification.confoundedStats` and on the suggestion (`confoundedStats`), and a warning says their MAE terms vary with m only through the penalty. This avoids over-rejecting a real signal carried by other stats (unit test "mixed stats").
- Sibling design paths: the same test runs on each CV fold's fitting rows (`identification.folds[]`). If the full train design identifies m but some fold does not, a warning names those folds (their train-CV/λ terms are ridge-only). The full train design decides the status, because it is the fit that produces the holdout-MAE selection; fold results are reported, not used for gating. The candidate refit design equals the train design (same rows, same builder), so it needs no separate check.
- When the status is design-confounded, the stat check is `nonidentifiable`: nothing is selected, there is no bootstrap, no suggestion, only the ×1 candidate refit, and `blueStatGain` is in `notCalibrated`. The reason states it explicitly: "design-confounded: every sensitive stat's blueStatGain sensitivity lies in the column space of the train design (…) a selected m would be ridge-only (set by the penalty, not by data); no multiplier is reported". This is not just a warning.
- Reviewer probes reproduced on the fix (scratch `probe2.mts`/`probe2.log`):
```
Q13.k0 / k1.3 / k3 / k-2   nonidentifiable, report partial, ident design-confounded structural-design saturated rank [27 full, 17 basis, 27 rows],
                           residuals [8.1e-17, 3.9e-31, 3.0e-31, null, 3.0e-31], all 5 folds design-confounded, sel null, 0 suggestions
                           (before: k1.3 -> suggested 1.25, k3 -> 2.95, k0/k-2 -> boundary 0)
Q7.orig                    suggested 1.28, complete, identified structural-design, residuals 0.51–0.60, folds all identified, warning "saturated"
Q7.sameBlue                nonidentifiable (intercept-confounded), residual 4.0e-17
Q7.unitTiny                [1, 1+1e-8] -> false (intercept-confounded); [1e-12, 3e-12] -> false (no-train-sensitivity)   (before: true / true)
```
- Tests (`review-r2.test.ts`, S-A block): Q13 at k = 1.3 and k = 3 (end to end, JSON round trip, not `complete`); Q7.orig genuine within-cell positive (still suggested, saturation disclosed); golden ×1.3 identified on the full design with residuals > 0.1, all folds identified, still 1.33 / train-CV 1.31; unitTiny; synthetic group-indicator and linear-combination designs (confounded) vs within-group (identified); mixed stats; vacuous design falling back to the intercept; scale invariance across 1e-6…1e6.
- The golden and context statuses are unchanged. All 17 evidence runs are `identified` on the full design (rank 38 of 156/157 rows, min residual 0.59–0.62). The published context is still `nonidentifiable`, now with status `no-train-sensitivity`.

### S-B: invalid observed aptitude grades
- `aptitude.ts` now validates every observed value at runtime with `isGrade` (a string in the schema `GRADES`, via a Set). The typed `Veteran` shape is not trusted: a missing or non-object `aptitudes` is handled too.
- An invalid value is not a cell. It is excluded from `cells`, `possibleCells`, impossible/below/above/unreachable, degenerate counts, reliability and likelihood, and counted in `invalidObserved` overall and per aptitude. The first 20 go to `invalidExamples`: `{id, apt, observed: string (≤ 16 chars) | null, valueType, reason: 'invalid-grade'}`, which is JSON-safe (NaN, numbers and undefined become null with their type). A report warning gives the count.
- Decision: exclude and count rather than throw `ModelInputError`. This matches how T06/T15 handle row-level data problems (non-finite stats and low confidence are excluded with a reason, not thrown) and keeps the rest of the report usable. Typed errors stay reserved for caller-option errors (split, grid, bootstrap, duplicate ids). The input is not changed and no grade is substituted. The schema is not touched.
- An aptitude with no valid cell is `insufficient-data`, and so is the aggregate when no valid cell remains at all. Valid support-gap classification is unchanged: the golden, pink 2/2/2 and published reconciliations still pass (87 = 0 + 87 + 0).
- Probe Q2.invalidGrade on the fix: `cells 9, impossible 0, belowBase 0, invalidObserved 1, turf [cells 0, invalid 1, impossible 0], examples [], invalidExamples [{observed 'Z', valueType 'string', reason 'invalid-grade'}]`, round-trip true. Before: impossible 1, belowBase 1, example reason 'below-base'.
- Tests: 'Z' on turf; number, missing, null, lowercase 'a' and NaN on five aptitudes (each per-aptitude count 1, status insufficient-data, `no-cells`); no aptitudes object at all (10 invalid, aggregate `no-cells`, `insufficient-data`, null likelihoods).

### S-C: explicit timeout for full-calibration tests
- New `FULL_CALIBRATION_TIMEOUT_MS = 30_000` in `test/calibrate/helpers.ts`, with a doc comment giving the reason and the timings. It is passed as the third `it()` argument only to tests that run at least one full `calibrateRules` on golden-sized data or read a memoised one that may be computed first: 5 in edge, 23 in golden, 14 in review-r1 and 3 in review-r2. Cheap unit tests keep the default.
- A whitespace-insensitive comparison of the old and new test files shows that only the trailing `T` argument, the import and the purity-test file list (which gains `identify.ts`) changed. No assertion was relaxed, removed or skipped, and no acceptance or runtime target changed.
- Timings, serial run (`--no-file-parallelism`, load average about 8): deep-frozen 1084 ms, impossible-grade edge 1183 ms, golden identification 1060 ms. The slowest is the 401-point grid at 3452 ms. In the parallel run, the B1 golden test took 2023 ms and deep-frozen 2071 ms. 30 s is a ceiling about 9× the slowest test, so it only absorbs contention like the reviewer's load average of about 42. It still stops a genuine hang.

### Nits
- The `golden.test.ts` file description no longer says "unbiased evaluation". It now reads "the train-CV selection and its holdout MAE". The historical lines in round 0 and round 1 are left as labelled.
- Report semantics now say that likelihood fields stay populated when the status is `uninformative`. A near-degenerate observed grade (0 < p < 1e-12) gives a finite, very negative logLik (about −29.9, review-2 Q3).

### Verification (round 2)
Environment: Node v25.9.0, pnpm 11.22.0. Run serially, with no evidence run at the same time.
```
$ pnpm install --frozen-lockfile --offline && pnpm -r lint && pnpm -r typecheck && pnpm -r test     # exit 0
Done in 342ms using pnpm v11.22.0
packages/schema test:       Tests  149 passed (149)
packages/master-data test:       Tests  82 passed (82)
apps/api test:       Tests  111 passed (111)
packages/engine test:  Test Files  20 passed (20)
packages/engine test:       Tests  325 passed (325)
apps/web test:       Tests  124 passed (124)
```
Evidence: `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/t15-fix-r2/run{A,B}.json`, run serially, both exit 0. The runner now also prints `ident <status> <basis> rank <r>/<n> minRes` and `invalid <n>`.
```
x1.3 roster, golden context, stored split | complete/suggested | used 196 split 157/39 | holdout-argmin 1.33 (40.939) trainCV-argmin 1.31 holdoutMaeOfTrainCvSel 41.020 current 88.453 noInh 332.506 | ident identified full-design rank 38/157 minRes 6.12e-1 | boot 1.31/1.33/1.37 | apt ok full finite ll -235.24 cond -235.24/1960 imp 0 (below 0 above 0 gap 0) invalid 0 | skills E770.7/O797 z1.25 ok ...
base roster, golden context, stored split | complete/suggested | holdout-argmin 1.03 (35.908) trainCV-argmin 1 | ident identified full-design rank 38/157 | boot 1/1.03/1.06
x1.3 roster, published context | partial/nonidentifiable | ident no-train-sensitivity | boot - (not-run) | apt uninformative full zero-probability-observed ll null cond 0.00/1873 imp 87 (below 0 above 87 gap 0) invalid 0
x1.3 roster, golden ×1.3 context | holdout-argmin 1.02 trainCV-argmin 1.01 | boot 1.01/1.02/1.05
x1.3 roster, golden ×2 context   | holdout-argmin 0.66 trainCV-argmin 0.65 | boot 0.66/0.66/0.68
x1.3 roster, grid 0..4 step 0.01 | holdout-argmin 1.33 (40.939)
x1.3 roster, seeded split t15-holdout | split 156/40 | holdout-argmin 1.32 trainCV-argmin 1.32 | ident identified full-design rank 38/156 minRes 5.99e-1 | boot 1.29/1.32/1.36
x1.3 seeded t15-alt-1..5: holdout-argmin 1.32, 1.30, 1.30, 1.31, 1.34; base: 1.01, 1.00, 1.01, 1.01, 1.04  (all identified, full-design)

A==B except timings: True 17     hashes eq round 1: True
diffs vs fix-r1 runA (new identification/invalidObserved fields removed): []
6a02f36050f92899f55ffc2a78ab355d12b545c0b41888e6b7e110619c707911  packages/engine/test/golden/roster.json
8982ab4aba43c4c770fc41260361a29255e2cccd57a5b3db70075c23f94f5434  packages/engine/test/golden/roster.calibration-x1.3.json
1ccf0d5a9c2b1fb6d9626126c22a0a2c4d9eb634af79457097a6dc68eceed0b2  packages/engine/test/golden/truth.json
352e5ea3350fb39a68fd38815938d01565e7e1ed8e8aff0e2510f036d22a95e7  apps/web/public/master/global-20260930/rules.json
$ git diff --quiet dffb549 -- packages/engine/src/model packages/engine/test/golden apps packages/schema packages/master-data docs/specs && echo unchanged-since-dffb549
unchanged-since-dffb549
```
- Every golden selection, train-CV selection, MAE, bootstrap, candidate fingerprint, aptitude count, skill metric and warning is identical to round 1. The new guard changes no golden or context status, because the golden sensitivities have relative residuals of about 0.6 against a rank-38 design with 157 rows.
- Preserved from earlier rounds: q counted once, train-only fitting (holdout-isolation tests pass), immutable inputs (deep-freeze test), null full likelihood on impossible cells, and the round-1 sparse guards (S1–S4).
- Not run: the golden generator, any recursive build, the web build. No web, schema, fixture, golden, master, contract or `src/model` file changed.

### Decisions (round 2)
- Identifiability is judged against the column space of the actual train design, with a saturation fallback that is reported rather than hidden. Without the fallback, small rosters with as many columns as rows would always be called confounded, even when the signal is genuine (Q7.orig).
- One sensitive stat with independent signal identifies the shared multiplier. Confounded stats are disclosed, not used to reject.
- Fold-level confounding is reported and warned about, not gating.
- Invalid grades are excluded and counted, not thrown. That is consistent with row-data handling elsewhere.
- One bounded timeout constant applied per test, not a global `testTimeout`, so cheap tests keep fast-failure behaviour.
- New `OPEN_QUESTIONS` entry: Q-159 (design confounding and invalid grades).

### Follow-ups (round 2)
- The saturated fallback is a policy choice. On real rosters with fewer train rows than design columns, the structural-design test is the effective guard, and card-id contributions beyond it rest on λ_id. A reviewer may prefer requiring n > full rank before any suggestion. That is a stricter acceptance change, so I did not make it.
- The browser consumer (S07) must display `stats.identification` (status, basis, saturation, confounded stats) and `aptitude.invalidObserved` / `invalidExamples`.
- H4 real-roster run and Q-3/Q-5 are unchanged. The status stays Partial.

## Review round 3 — coordinator takeover

Independent Opus r3 requested changes: the saturation fallback still permitted false identification. Both worker fix rounds were consumed; the coordinator applied this fix directly, not through another worker loop. The round-2 fallback and mixed-stat/fold policy above are superseded.

### B1 / S-A and S1
- Always project against the full fitted design, including card-id columns. Saturated designs are nonidentifiable; no structural/intercept fallback, selection or suggestion is permitted.
- Conservative all-stat criterion policy: suppress selection when any sensitive stat is confounded or any CV fold fails identification, rather than letting ridge-only terms select a shared multiplier. Full-design residuals remain reported.
- `identified` denotes numerical non-collinearity, not adequate signal strength, precision or verified mechanics. Q-159 carries this clarification.
- Suggestions additionally require full-design basis and the complete identification gate. Invalid-grade and likelihood fixes remain unchanged.
- Files modified: calibration identify/index, review-r1/r2 tests, Q-159 and this changelog. New review-r3 tests cover saturation, mixed-stat contamination, fold gating and the saturated guest report.
- Retargeted the guest positive to nonidentifiable (reviewer explicitly required this); retargeted the one-holdout bootstrap test to an identified full train design, retaining unavailable-interval assertions. No golden fixture or F12 band changed.

### Verification
```
$ pnpm --filter @uma/engine test -- test/calibrate/review-r3.test.ts
Tests 4 failed | 325 passed (329), exit 1
```
All four new regressions failed on the previous production code for the expected true-vs-false/suggested-vs-nonidentifiable reasons. This script ran the entire suite despite the filter; no claimed targeted-only run.
First GREEN attempt: 327/329 passed; two older assertions relied on the superseded fallback/mixed-stat policy. They were updated as described above.
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test && git diff --check
schema 149 passed; master-data 82 passed; api 111 passed
engine 329 passed (21 files); web 124 passed; exit 0
$ node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/t15-coordinator-A.json
$ node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/t15-coordinator-B.json
Both exit 0; 17 runs; Python comparison excluding *Ms: True
Golden ×1.3: complete/suggested 1.33, train-CV 1.31, full-design rank 38/157
Published context: partial/nonidentifiable, full likelihood null, impossible 87
```
All four reported input hashes match round 2. Real-roster/H4, browser and live evidence remain absent. Fresh independent review of the coordinator fix is required before merge.

## Review round 4 — independent approval

Opus 5.5 medium independently approved code candidate `fa4810d16089214f275f1ef5ba57d376b372ed56`: PASS, no blockers. Exact report: `docs/reviews/T15-review-4.md`. Fresh card-indicator and two-row-rescue probes are nonidentifiable without suggestions; independent workspace gates passed (engine329) and twice17 evidence runs matched apart from timings. These are synthetic/local checks only; task remains Partial for H4.

Nonblocking follow-ups retained:
- S1: consumers must use `stats.status` and the nonidentifiable reasons as the selection authority, not `stats.identification.status` alone. The latter is a full-train rank diagnostic and may say identified while mixed-stat/fold gating suppresses selection. Add an explicit selectionGate field in separately reviewed consumer/API work.
- S2: remove unreachable old-policy warnings, ignored structural option and obsolete basis variant; clarify always-empty suggestion confoundedStats. No behavior patch after approval.
- N1: strengthen the suggestion type's identification discriminant when evolving the consumer contract.
- N2: add nonsaturated end-to-end mixed-stat coverage; reviewer construction attempts were inconclusive, not evidence of correctness. Current mixed-stat/fold guards have unit coverage and saturation probes have end-to-end coverage.
- H4/real-roster, browser consumer, native and live proof remain pending; Q-3/Q-5 unverified. No game facts established.
