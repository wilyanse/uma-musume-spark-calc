# T15 — Rules calibration engine implementation

- **Status:** Partial. The engine implementation and the synthetic/golden acceptance are done. The real-roster report waits for H4, and a meaningful real-roster `blueStatGain` value also needs Q-3/Q-5.
- **Branch:** task/T15-rules-calibration
- **Agent / model:** Claude Opus 5.5, medium reasoning (primary; no fallback was needed)
- **Date:** 2026-10-08

## Summary
`@uma/engine` now exports `calibrateRules(ctx, roster, opts?)`. It is the 50 §8 calibration and returns an engine-local `CalibrationReport` (`kind: 'calibration-v1'`):

- **Population:** T06-eligible rows whose two recorded parents are each a matched roster veteran or a guest. Every exclusion is listed per row and counted per reason.
- **Aptitude check:** log-likelihood and reliability tables against the predicted `aptitudeDist`.
- **Stat check:** a fixed `blueStatGain` multiplier grid. Each point refits the 50 §4 ridge on train rows only, with λ re-selected by CV. It reports the holdout-MAE argmin (the suggestion) and a train-CV argmin as the unbiased evaluation, plus a seeded holdout bootstrap and a no-inheritance baseline.
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
- `packages/engine/test/calibrate/golden.test.ts`: 27 tests (F12, interior minimum, unbiased evaluation, population, grid = full refit, candidate refits, determinism, base/×1.3/×2 contexts, wider/coarser/offset grids, boundary, seeded split, published context, holdout isolation per candidate, aptitude/skill checks, independent recomputation).
- `packages/engine/test/calibrate/edge.test.ts`: 25 tests (empty/small rosters, exclusions, matched/guest/unmatched/matched-missing parents, unread guest sparks, illegal lineage, low or NaN confidence, non-finite stats, duplicate ids, split errors and drops, grid/bootstrap guards, tie rule, immutability with deep-frozen inputs, aptitude/skill contradictions, published context, import purity).
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
```
Type exports:
- `CalibrationReport`, `CalibrationOptions`, `CalibrationGrid`, `CalibrationExclusion`;
- `CalibrationPopulationRow`, `CalibrationGridPoint`, `CalibrationSelection`, `CalibrationStatCheck`;
- `CalibrationCandidate`, `CalibrationCandidateFit`, `CalibrationSuggestion`, `NotCalibrated`;
- `AptitudeCheck`, `ReliabilityBin`, `SkillHoldoutCheck`.

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
  - `logLik` sums log p(observed) over possible cells. Impossible cells (p = 0) are excluded and counted as `belowBase` or `aboveMax` (Q-158).
  - `degenerateCells` (max p ≥ 1 − 1e-12) carry no information.
  - Reliability: one event per (uncertain cell, grade with 0 < p < 1), in 10 bins.
  - Diagnostics only; no rule suggestion comes from this check.
- **`stats`:**
  - For each grid m: y = stat − (E₀ + m·(E₁ − E₀)), where E₀/E₁ are E[inh | recorded lineage] with `blueStatGain` × 0 and × 1. This is exact because `blueStatGain` only scales event gains.
  - Design and recency weights follow 50 §4 from train rows only. `fitRidge` re-selects λ per stat by 5-fold CV on train rows.
  - Two criteria per point:
    - `holdoutMae`: Σ over stats of the unweighted holdout MAE, which equals T06 `report.holdout.mae` (tested against full refits at six multipliers, |Δ| < 1e-7, same λ);
    - `trainCvMae`: Σ over stats of the recency-weighted OOF MAE on train rows.
  - `selected` is the holdout-MAE argmin (50 §8). `trainCvSelected` is the train-CV argmin, and its holdout MAE is `evaluation.unbiasedHoldoutMae`. `selectedHoldoutMaeIsPostSelection: true` is explicit.
  - Status values:
    - `suggested`;
    - `boundary`: the argmin is at a grid end, so no suggestion is made and a warning says to widen the grid;
    - `nonidentifiable`: no used row's E[inh] depends on `blueStatGain` (zero table and/or no inheritance turns, with reasons);
    - `insufficient-data`: fewer than 5 train rows or no holdout row.
  - `bootstrap`: a seeded resample of holdout rows with the train fit fixed, so it covers holdout sampling only. It reports the argmin p05/p50/p95, the share at a boundary, and whether the interval contains 1.
  - `withoutInheritance`: the same procedure with y = stat.
- **`candidates`:**
  - m = 1 (current), plus the suggested m when it differs from 1. Each candidate gets a full `fitTrainingModelDetailed` refit with the same split and CV seed (ADR-0002 §2.11).
  - Each reports holdout MAE, coverage80 with and without inheritance, λ, σ, covariance warnings and a train-parameter fingerprint.
  - If a refit's MAE differs from the grid value by more than 1e-6, a warning is raised.
- **`skills`:**
  - Per candidate, holdout cells are scored against q·E[θ] from that candidate's refit, with availability counted once. Contradictions (q = 0, y = 1) are excluded and counted (Q-131), the own unique skill is excluded (Q-142), and underflow cells are counted.
  - Because `blueStatGain` does not change q, the skill check is identical across blue candidates. The report says so, and the check does not discriminate blue multipliers.
- **`suggestions`:**
  - Only `{rule: 'blueStatGain', kind: 'multiplier'}`, and only when the status is `suggested`.
  - Each carries `current`, `proposed`, `change`, `applied: false`, `basis: 'holdout-mae'` and `consistentWithCurrent` (whether the bootstrap interval contains 1).
- **`notCalibrated`:** every other rule, with `verified`/`placeholder` flags and the reason it is not estimated (Q-157). `blueStatGain` is included here whenever no suggestion is made.
- **`status`:** `complete` when the aptitude, stat and skill checks all ran; `partial` when some did; `unavailable` when none did.
- **`runtime`:** measured from the injected timer. It is never an input to any result.

## Decisions
- **Engine-local report, no schema change (Q-155).** 01 has no calibration contract, and 80 keeps browser/apply integration out of T15.
- **The population reuses T06 `prepareRow`, then applies the 50 §8 parent filter.** The calibration rows are then exactly the rows the training model could use, with the same low-confidence, unknown-id, illegal-lineage, unread-sparks and non-finite guards.
- **The default split is seeded over the 50 §8 population** (`t15-holdout`). An explicit split drops ineligible ids into `dropped` instead of throwing. This makes the stored golden split usable: its 44 unmatched-parent rows are dropped and counted.
- **The selection criterion is holdout MAE as the spec says. The unbiased evaluation is reported separately (Q-156).** No claim is made that the post-selection holdout MAE is independent proof.
- **Fixed 0.01 grid over [0.5, 2.0]; not adaptive and no coarse/refine step.** This is the T08 feasibility grid. The fixed grid's measured cost is about 1.1–1.3 s, so no refinement was needed. Wider (0–4, 0.5–3), narrower (1–2), coarser (0.05) and offset (0.73–1.91, step 0.03) grids are tested. Every 0.01 grid that contains the default one returns the same argmin (1.33).
- **The tie rule prefers the multiplier closest to 1, then the smaller one.** Ties are relative 1e-12. It is deterministic and conservative, never towards 1.3.
- **The multiplier is relative to the context's current table.** The golden ×1.3 and ×2 contexts recover ≈1.02 and 0.66, i.e. 1.33 and 1.32 in absolute terms. There is no planted-value fallback anywhere.
- **Grid points reuse the T06 ridge (`fitRidge`) but not the full `fitTrainingModelDetailed`.** Σ_N and θ do not enter MAE. Full refits are done for the candidate contexts, and the tests prove the grid value equals the full refit at six multipliers.
- **Impossible aptitude cells are excluded and counted, not smoothed (Q-158).**
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

Golden evidence: `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/runA.json`, run twice (A and B). Excerpt of real output (MAE = Σ over 5 stats):
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
- The published context's `apt ll 0.00` is honest. With no inheritance turns every aptitude is predicted to stay at the base grade with p = 1. The 87 cells that differ are impossible and excluded (Q-158), so the remaining cells contribute log 1 = 0.
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
- Q-156: holdout selection vs unbiased evaluation.
- Q-157: only `blueStatGain` can be suggested; zero placeholders are nonidentifiable.
- Q-158: impossible aptitude grades are excluded and counted.
- **H4 (blocking for Done):** run `calibrateRules(loadContext(master, master.rules), realRoster)` on ≥ 20 imported real veterans and attach the report: population/exclusion counts, aptitude impossible counts, skill contradictions, runtime and input hashes. With the published rules (zero `blueStatGain`, no turns) the stat check will be `nonidentifiable`. A real multiplier needs Q-3/Q-5 values first.
- **Browser consumer (separate reviewed task, T13/S07):** worker wiring, progress/cancellation (the call is synchronous, about 1.3 s on golden-sized data in Node, with no progress callback), display of `notCalibrated` and the evaluation caveats, and the apply/refit flow (Q-141, Q-155). S07 calibration stays disabled until then.
- Follow-up: the `test/calibrate` suite takes about 18 s because it runs many full calibrations. Memoisation is already used, and further trimming is optional.
- No `TODO`s in the code.
