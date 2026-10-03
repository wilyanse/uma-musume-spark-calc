# T06 — Engine: training model, prediction, scoring and ranking

- **Status:** Done (pending independent review)
- **Branch:** task/T06-training-prediction
- **Agent / model:** Claude Opus 5.5 (anthropic), medium
- **Date:** 2026-10-03

## Summary

`@uma/engine` now exports working `fitTrainingModel`, `predictChild`, `scoreTarget` and `rankPairs` (50 §1) with the ADR-0002 `training-v2` semantics:

- **Fit:** eligible rows with recorded lineage, recorded-lineage residuals, the 50 §4 features (including scenario plugin `deckFeatures`), recency weights, two-group weighted ridge with 5-fold CV, the OOF non-inheritance covariance Σ_N (Jacobi PSD), the exposure-aware skill posteriors (tanh-sinh quadrature, moment-matched Beta) and an untouched holdout used only for evaluation.
- **Predict and score:** separate seeded inheritance/training/skill streams, clipping without rounding, availability counted once and a joint-sample `scoreTarget`.
- **Rank:** all legal pairs, a Gaussian fast pass, the full top-100 MC and the top-50 results.

On the golden data the planted best pair ranks #1, the trap is outside the top 50, and the full 260-veteran ranking takes a measured 2.88–3.00 s over three bench runs (fit + rank ≤ 3.33 s).

The T05b review follow-ups S1–S3/N1 are applied to the reference evidence only.

## Files

Created (all T06-owned):

- `packages/engine/src/linalg.ts`: symmetrize, cyclic Jacobi (ADR-0002 conventions), PSD floor with diagnostics, eigen factor, Cholesky, the typed `NumericError`.
- `packages/engine/src/model/errors.ts`: `RefitRequiredError`, `InsufficientDataError`, `ModelInputError`, `SkillPosteriorError`, `ScoreRequiresSamplesError`.
- `packages/engine/src/model/features.ts`: self-describing feature names and the plan feature vector.
- `packages/engine/src/model/ridge.ts`: normal equations, grouped ridge, seeded CV folds, λ grid, OOF residuals.
- `packages/engine/src/model/covariance.ts`: the Σ_N estimator, Gaussian coverage and the holdout bias/T² diagnostic.
- `packages/engine/src/model/skills.ts`: the exposure-aware posterior, tanh-sinh quadrature (exact Jacobian) and the global prior.
- `packages/engine/src/model/lineage.ts`: recorded lineage (matched / guest / unmatched / matched-missing).
- `packages/engine/src/model/fit.ts`: `fitTrainingModel`, `fitTrainingModelDetailed` (snapshot + `FitReport`), `effectiveCardEffect` (Q-122).
- `packages/engine/src/model/prepared.ts`: the version guard and model preparation.
- `packages/engine/src/model/ulid.ts`: the default snapshot ULID (`crypto.getRandomValues`); it is injectable.
- `packages/engine/src/predict/index.ts`: `predictChild`, `scoreTarget`, the MC simulator, the Gaussian fast-pass score and target normalisation.
- `packages/engine/src/predict/normal.ts`: erfc (series + continued fraction), the normal tail, E[(X−m)+], Box–Muller and type-7 quantiles.
- `packages/engine/src/rank/index.ts`: `rankPairs`, `rankPairsDetailed`.
- `packages/engine/test/model/{golden-fit.ts,linalg,covariance,skills,fit,entry}.test.ts`, `test/predict/predict.test.ts`, `test/rank/rank.test.ts`: 80 tests.
- `packages/engine/bench/rank.bench.ts`: the Vitest benchmark.
- `docs/changelog/T06-training-prediction.md`: this file.

Modified:

- `packages/engine/src/index.ts`: T06 exports (functions, typed errors, engine-local types).
- `packages/engine/vitest.config.ts`: `benchmark.include: ['bench/**/*.bench.ts']`.
- `packages/engine/package.json`: a `bench` script; `bench` added to `lint`.
- `packages/engine/tsconfig.json`: `bench` added to `include`.
- `docs/OPEN_QUESTIONS.md`: Q-140, Q-141 (appended).
- `docs/reference/model-semantics/{src/covariance.ts,src/golden.ts,src/skills.ts,probes/q124-skills.ts,test/covariance.test.ts,test/skills.test.ts,results/q124-skills.json}`: the S1–S3/N1 follow-ups (below).

## Decisions

**Interface and determinism**

- **Public surface.** These are engine-local types, not shared contracts, and are exported intentionally from `src/index.ts`: `FitOptions`, `FitReport`, `TrainingFit`, `ChildPrediction`, `PredictOptions`, `TargetScore`, `Requirement`, `RankOptions`, `RankedPair`, `RankResult`, `RankProgress`, `PredictionSamples` and others. `fitTrainingModel` returns the 01 §13 `ModelSnapshot`, schema-parsed. Diagnostics that the snapshot shape cannot hold go in `fitTrainingModelDetailed(...).report`.
  - The report covers lineage per row, the λ grid, S, C̄, eigenvalues, flooring, ESS, the OOF mean, the holdout bias/T², per-stat coverage, skill cell counts and contradictions, and the Q-130/Q-131 assumptions.
- **Injected sources.** `FitOptions.id` and `FitOptions.now` supply the snapshot ULID and `trainedAt`. `splitSeed`/`cvSeed` supply the split and folds (defaults `t06-holdout`, `t06-cv`). `PredictOptions.seed` and `RankOptions.seed` supply MC seeds.
  - The runtime graph never calls `Math.random` or `Date.now()`; a test enforces this.
  - The default id uses `crypto.getRandomValues`, and the default clock is `new Date()`.
- **Stored golden split.** It is passed through `FitOptions.split` from the tests. Production code has no fixture ids. An explicit split must be disjoint and contain only eligible ids; otherwise a typed `ModelInputError` is thrown.

**Eligibility and lineage**

- A row is eligible when `minConfidence ≥ 0.9` and it has:
  - a known scenario, outfit and cards;
  - 6 deck slots;
  - both parent slots;
  - a valid date;
  - a legal recorded lineage.
- Matched parents (present in the supplied roster) use the roster record, so their parents become grandparents.
- Guests, unmatched parents and matched ids missing from the roster use the sparks recorded on the child, with no grandparents.
- A non-matched parent with zero recorded sparks makes the row ineligible (Q-140).
- Every row's reason or role and its parent kinds are in `FitReport.rows`.

**Features**

- The intercept is separate (`perStat.intercept`) and penalised with λ_base ("everything else", 50 §4, as T08's diagnostic does).
- Cells, card ids and deck-feature keys come from TRAIN rows. The 7 type columns are always present.
- Unseen cells, cards or deck features in a plan are reported in `featureWarnings`, never guessed.
- Scenario plugin `deckFeatures` are features (`deck:<key>`); a test fits with a plugin feature.

**Estimation**

- **Ridge and CV.**
  - Grid {0.1,1,10,100} × {0.1,1,10}, chosen per stat by weighted CV MSE.
  - Ties keep the first grid point (λ_id-major).
  - Folds: sorted ids, then a Fisher–Yates shuffle with `mulberry32(seedFromString(cvSeed))`, then position mod 5.
  - OOF residuals are the CV residuals at each stat's chosen λ, from the same folds and weights (ADR-0002 §2.3).
  - The recency clock is the newest TRAIN row; the holdout never enters it.
- **Σ_N** follows ADR-0002 §2 exactly:
  - uncentred weighted S, with C̄ weighted by the same weights;
  - sym, then Jacobi (tol 1e-12·max(1, ‖R‖_F), ≤ 100 sweeps, a typed error otherwise), ascending eigenvalues with ties by index and the sign convention;
  - ε = 1e-6·max(1, tr S/5); an all-zero input gives εI;
  - warnings when diag(S−C̄) ≤ 0 or when anything is floored;
  - σ = √diag exactly.
  - No inflation constant.
- **Holdout.** MAE, `coverage80` in the Gaussian form with each row's own C_i, coverage without inheritance (diagnostic) and the weighted bias with SE and T² (diagnostic, never subtracted).
- **Skills** follow ADR-0002 §3:
  - Candidates are deck hint/event ∪ innate ∪ recorded-lineage hints, minus the unique skill.
  - q = 1 for deck/innate (Q-130), otherwise the lineage `skillHintProb`.
  - q = 0 acquisitions are counted contradictions (Q-131).
  - The tanh-sinh quadrature uses the corrected absolute Jacobian π·cosh(t)·θ(1−θ) (T05b N1). `logZ` is now an exact absolute integral, and a test checks it against B(2,3) and B(2,4).
  - The prior is fitted on train cells only, in sorted skill order.
  - A skill with no q > 0 row in a mode gets no entry and falls back to `'*'`.

**Prediction**

- **Version guard.** `prepareModel` throws `RefitRequiredError` in these cases:
  - `training-v1` (`legacy-kind`);
  - any other kind (`unknown-kind`);
  - schema or shape failures (`malformed`);
  - a different `masterVersion` (`master-version-mismatch`; see Q-141 for rules).
- **MC streams.**
  - `${seed}:inh`: T05 `sampleInheritance`.
  - `${seed}:train`: five Box–Muller normals, then xβ + L z with the eigen factor of the stored Σ_N.
  - `${seed}:skill`: one uniform per (sample, skill), always consumed whether or not the skill is available, so no stream's consumption depends on another's outcome.
  - Stats are `clip(train + inh, 1, statCap)` with no rounding.
  - Availability is drawn once: deck/innate ∪ this sample's inheritance hints, then `u < E[θ]`.
- **Outputs.**
  - Mean, sd, p10/p50/p90 (type 7) and the share clipped low/high per stat.
  - MC aptitude grade frequencies (each row sums to 1), plus the exact T05 distribution in `gaussian.aptitudeDist`.
  - Per skill: closed-form pHinted, θ and pAcquire = pHinted·θ, plus the MC rate.
  - Raw samples (final, training, inheritance, aptitudes, skills, skill uniforms) only with `keepSamples`.

**Scoring**

- `scoreTarget` computes the JOINT all-requirements share from the kept samples. Without kept samples, it returns the joint score recorded during sampling for the same target (`PredictOptions.target`, matched by a canonical `targetKey`).
- Otherwise it throws `ScoreRequiresSamplesError`. It never substitutes a product of marginals.
- A required or optional skill that was not simulated is also an error.
- Bottleneck: the lowest marginal pass rate, with ties going to the first requirement in stat, then aptitude, then skill order.
- Surplus: Σ w·E[(stat − min)+] + Σ optional weight·P(acquired).

**Ranking**

- **Candidates.** Only roster veterans (guests are never candidates). Trainee-character veterans are excluded and reported. Duplicate roster ids are rejected.
- **Legal pairs.** Two different veterans with different characters.
- **Lock.** `lockParent1` fixes parent 1. An unknown lock id is a typed error; a lock on a trainee-character veteran gives zero pairs.
- **Fast pass.** Gaussian N(μ_train + E[inh], Σ_N,kk + Var[inh_k]), clipped to [1, statCap] for the probability and the surplus. It also uses the exact aptitude distributions and P(hinted)·E[θ] for skills.
- **Order.** pMeet desc, surplus desc, then the pair key ascending.
- **Precise pass.** Top K = 100 with 2000 draws and the seed `${rankSeed}:${sortedId1}|${sortedId2}`, then re-sorted with the same keys; the top N = 50 are returned.
- **Progress.** Reported every 1000 fast-pass pairs (and at the end), and once per precise pair.
- The reference probe's top-12 shortcut is not used.

## Deviations from spec

- **50 §1 signatures.** `predictChild` takes `PredictOptions` (`samples` defaults to 2000; `seed` is required; adds `keepSamples`, `skills` and `target`). `rankPairs` has an extra optional `seed`, `topK`, `topN` and `samples` in `RankOptions` (defaults 2000/100/50). The 50 §1 call shapes still work.
- **50 §6 `scoreTarget(pred, target)`** needs kept samples or a target recorded at prediction time, because the joint pMeet cannot be recomputed from marginals (the task requires never substituting marginals).
- **50 §5 skills** are simulated for the target's skills (or an explicit list, or by default every candidate skill) rather than literally "every required/optional skill" when no target is given.

## Cross-task edits

- `packages/engine/src/context.ts` (T05-owned): added `EngineContext.cards` (a card-id map built in `loadContext`). This is minimal and additive; T06 needs card types and deck hint/event skills, and no existing behaviour changes.
- `packages/engine/src/index.ts`, `vitest.config.ts`, `package.json`, `tsconfig.json`: the declared export and bench wiring.
- `docs/OPEN_QUESTIONS.md`: append only.
- `docs/reference/model-semantics/**`: the T05b S1–S3/N1 follow-ups, as authorised by the T06 card.
- No shared schema/API, golden, master-data, web, capture or migration edits.

## T05b review follow-ups (reference evidence only, not propagated to production)

- **S1.** Added `predictiveDraws(seed, n, drawInh, drawTrain)`, which uses the separate `${seed}:inh` and `${seed}:train` streams. `mcCoverage` now uses it.
  - The new node:test changes inheritance consumption (1 vs 9 uniforms per sample) and asserts the training draws are identical, and vice versa (1 vs 2 MVN draws).
  - A shared-stream negative control shows the check can fail.
  - The old test is renamed to "deterministic per seed".
- **S2.** The test is renamed to "recovers the moments of a SYNTHETIC deterministic θ_s spread" and documented as a golden-ratio modular sequence that is not a Beta draw.
- **S3.** The q124 probe's fast pass no longer subtracts 0.5, and the MC uses `clip(μ + t + inh, 1, statCap)` with no `Math.round`. Retained `results/q124-skills.json` was regenerated:
  - sha256 `86ddbaf0…85e95` → `c21ed3f85c9524d47037acc9714bb3adf725601b4e5087f972a574e75ec9b5e9`.
  - Changed numbers: `fastSecondPMeet` 0.0213→0.0209 (exposure), 0.0193→0.0189 (literal), 0.0294→0.0288 (drop activation), 0.0196→0.0192 (conservative).
  - Unchanged: best rank #1, fastBestPMeet, mcTop12BestRank 1, mcBestPMeet (0.2115 / 0.1885 / 0.29 / 0.191), trap rank 24178 / pMeet 0.
  - Two synthetic `meanBias` values moved in the 17th significant digit (−0.003481557678786818 → …8003, −0.004228624393933094 → …3074), from the N1 log-constant change in floating-point summation. Their `within80` is unchanged.
  - Historical T05b evidence (changelog/ADR) is not rewritten.
- **N1.** The Jacobian is now `log(π·cosh t) + logθ + log(1−θ)`, with the derivation in the comment. The edge tests are unchanged and pass.
- **q123 probe.** It was rerun with `--splits 40 --write`. `results/q123-covariance.json` is byte-identical (sha256 `3eaaf67d…03d08b`), so the `predictiveDraws` refactor preserved the MC coverage stream semantics exactly.

## Verification

All commands were run on the dev Mac: Apple M1 Max, 32 GB, macOS 26.5, Node v25.9.0 (darwin/arm64), pnpm 11.22.0.

```
$ pnpm install --frozen-lockfile
Scope: all 6 workspace projects
Already up to date
Done in 305ms using pnpm v11.22.0

$ pnpm -r lint          # exit 0
packages/schema lint: Done / apps/web lint: Done / packages/master-data lint: Done / apps/api lint: Done / packages/engine lint: Done

$ pnpm -r typecheck     # exit 0
packages/schema / master-data / apps/web / apps/api / packages/engine typecheck: Done

$ pnpm -r test          # exit 0
packages/schema test:      Test Files 4 passed (4)   Tests 149 passed (149)
apps/web test:             Test Files 1 passed (1)   Tests 5 passed (5)
packages/master-data test: Test Files 3 passed (3)   Tests 82 passed (82)
apps/api test:             Test Files 13 passed (13) Tests 111 passed (111)
packages/engine test:      Test Files 15 passed (15) Tests 215 passed (215)   # was 135; +80 T06

$ pnpm --filter web build      # exit 0 (web does not import @uma/engine yet; T13 wires it)
dist/assets/engine.worker-Crm6So1O.js    4.12 kB
dist/assets/index--uMx3vdd.js          342.97 kB │ gzip: 107.66 kB
✓ built in 110ms
```

**Browser import check.** The web app does not import the engine yet, so the entry point was also bundled for the browser into scratch. Nothing was committed and `apps/web` is unchanged.

```
$ node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild packages/engine/src/index.ts \
    --bundle --platform=browser --format=esm --outfile=$SCRATCH/engine.browser.js --log-level=warning
(exit 0, no warnings; 859,903 bytes; grep -c "node:" → 0)
$ node $SCRATCH/run-bundle.mjs       # fit + rank through the BROWSER bundle
bundle: training-v2 0.8125 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2 0.218
```

`test/model/entry.test.ts` also walks the runtime import graph from `src/index.ts`:

- only `src` files are reached;
- the only bare dependency is `zod`;
- there is no `node:`, `process.`, `document.`, `window.`, `fetch(`, `Math.random` or `Date.now(`.

**T06 acceptance on the golden data** (`npx vitest run test/model test/predict test/rank --reporter verbose`, 80 passed). The `[T06]` log lines are emitted by the asserting tests:

```
[T06] card recovery: worst 5.05% over 22; max |zero card| 2.50
[T06] stored split Gaussian coverage80 0.8125 per stat 0.7708, 0.8125, 0.8333, 0.7917, 0.8542; without inheritance 0.6833
[T06] diagnostic splits (not gates): default seed coverage80 0.7750, 'other' 0.8208
[T06] stored split MC p10–p90 coverage: 0.8125, 0.8208
[T06] golden legal pairs evaluated: 32667
[T06] golden #1 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2 pMeet MC 0.218 (fast 0.2135), #2 MC 0.0225; trap in top 50: no; bottleneck {"kind":"skill","key":"skill:restraint","passRate":0.3605}
      Tests  80 passed (80)
```

Coverage of every acceptance item (50 §9 T06 and 70 F08/F09/F11):

1. **Card effects (Q-122).** All 22 planted (card, stat) cells are within ±15%; the worst is 5.05%.
   - This uses the production default CV seed `t06-cv`. With T08's fold seed the worst is 4.65%, matching T05b; that seed was a scratch check, not a test.
   - The zero-effect cards stay below 8.
2. **Coverage on the stored split.** Gaussian `coverage80` is 0.8125. MC p10–p90 is 0.8125 and 0.8208 (two seeds, 2000 draws per holdout row, recorded lineage). Other splits are diagnostic only.
3. **Covariance properties.**
   - Exact symmetry (`toBe`), min eigenvalue ≥ ε and `sigma === √diag`.
   - diag Σ_N = S − C̄ (nothing floored on the golden fit).
   - The holdout perturbation (y and dates) leaves λ, β (`Object.is` per coefficient), `residualCov` and `skillAcquire` bit-identical, while coverage and MAE change.
   - For reference only: at T08's fold seed the production fit reproduces T05b exactly (diag S 89.16/79.26/87.04/95.00/110.85, raw eigenvalues 18.24…76.48, σ 7.588/6.181/6.507/5.582/7.419, Gaussian 0.8292). This was checked in scratch, not by a test.
4. **Single count.**
   - The synthetic known-noise fixture recovers Σ_N within 2.5 without Var[inh].
   - On the two-group weighted fixture (weights 3:1, Var 80/20), C̄ = 65 exactly, so the subtraction is same-weighted, not 50.
   - MC Var(train + inh) / (Σ_N,kk + Var[inh_k]) is in [0.95, 1.05] with 20k draws.
   - S < C̄ floors all 5 eigenvalues to ε deterministically and warns.
   - All-zero input gives 1e-6·I.
   - Non-convergence, bad weights and non-finite input throw typed errors.
5. **Skills.**
   - q = 1 data equals the conjugate update exactly.
   - Known θ = 0.6 with lineage-only rows: |bias| < 0.01 over 100 datasets (the naive rate is < −0.25), with 70–92% inside z0.9·sd.
   - The result agrees with the unreduced brute force to 1e-8.
   - Rare skill: a single q = 0.2 failure gives mean 0.48889, matching the closed form.
   - No opportunity returns the prior; q = 0 acquisitions are counted contradictions.
   - P(acquire) = pHinted·θ, and the MC agrees within 4 SE while being more than 8 SE from pHinted²·θ.
   - A deck skill's MC rate ≈ θ; a no-source skill is never acquired.
   - Typed errors are thrown for bad input and for quadrature non-convergence.
6. **Version guard.**
   - `predictChild` and `rankPairs` on `training-v1` throw `RefitRequiredError {kind:'training-v1', reason:'legacy-kind'}`.
   - Unknown kinds, malformed snapshots and a different master version also require a refit.
   - The fit emits only `training-v2` (schema-parsed).
7. **Determinism and stream independence.**
   - The same seed gives deep-equal samples.
   - Another pair (different inheritance consumption) gives identical training draws.
   - A 4× Σ_N (different training draws) gives identical inheritance draws and skill uniforms.
   - Extra simulated skills (different skill-stream consumption) give identical training and inheritance draws.
   - Refits are identical, and the fit does not depend on roster order.

70 F09:

- p10 ≤ p50 ≤ p90 within [1, cap].
- Aptitude rows sum to 1 and lie within 0.04 of the exact T05 distribution.
- Clipping, tested with a context cap of 900 and a wit intercept −5000: max spd is 900, wit is all 1, and every sample equals `min(cap, max(1, train + inh))` exactly, with unclipped values fractional (no rounding).

Scoring:

- On anti-correlated hand-built samples, joint pMeet is 0 against a marginal product of 0.1875.
- The bottleneck is correct, including on ties, and the surplus is hand-computed.
- An empty target gives pMeet 1 with no bottleneck.
- Retained and non-retained paths give identical scores; the missing-samples case throws.

70 F11, ranking:

- 32,667 legal pairs (an independent brute-force count) are evaluated, with progress at 1000, 2000, …, 32000 and 32667.
- 100 precise pairs at 2000 draws each, 50 results, correctly sorted.
- Best pair #1; the trap is not in the top 50.
- The #1 result equals a direct `predictChild` with the pair-derived seed.
- Only roster ids appear, and the trainee character is excluded.
- With `lockParent1` on best2, the best pair is still #1 with parent 1 = best2.
- Unknown lock ids throw; a trainee-character lock gives 0 pairs.
- Empty, one-veteran, same-character and duplicate-id rosters are handled.
- The ranking does not depend on roster order, and the all-zero tie order is the pair key.

**Benchmark** (`pnpm --filter @uma/engine bench --reporter verbose`, Vitest 5.0.2 bench with tinybench):

- **Policy.** 1 warmup iteration, then 5 measured iterations (`iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0`).
- **Work per iteration, with nothing cached across iterations:**
  - `prepareModel` (validation + Jacobi factor);
  - plan features;
  - `planInheritance` + `expectationFromPlan` + the Gaussian score for all 32,667 legal pairs;
  - the 2000-draw MC for the top 100;
  - the top 50.
- The second task also refits the model (`fitTrainingModel`, 5-fold CV over 12 λ points, Σ_N, skill posteriors) every iteration.
- The assertions use the slowest measured run: `max < 5000 ms`.

```
[T06 bench] rankPairs legal pairs 32667, #1 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2; samples 5, mean 2919.2 ms, min 2878.1 ms, max 2959.5 ms; node v25.9.0 darwin/arm64
   name                          hz       min       max      mean       p75       p99      p995      p999     rme  samples
   rankPairs (260 veterans)  0.3426  2,878.09  2,959.51  2,919.24  2,930.59  2,958.36  2,958.93  2,959.40  ±1.33%        5
[T06 bench] fit+rank legal pairs 32667; samples 5, mean 3145.6 ms, min 3053.6 ms, max 3325.0 ms
   name                                             hz       min       max      mean       p75       p99      p995      p999     rme  samples
   fitTrainingModel + rankPairs (260 veterans)  0.3182  3,053.57  3,325.03  3,145.56  3,141.98  3,317.71  3,321.37  3,324.30  ±4.25%        5
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

That is one complete run. Two earlier runs gave rankPairs means of 2958.6 ms and 2975.9 ms (max 2998.8 ms), and fit+rank means of 3207.5 ms (max 3312.3 ms). Vitest warns that module export getters add overhead inside the benchmark runner, so the in-Vitest times are, if anything, pessimistic. I did no optimisation work after the correctness tests: the first measured implementation already met the budget.

The runtime is Node v25.9.0 (the active `node`), not Node 22. The repo requires Node ≥ 22.18, and no Node 22 install is present on this Mac (nvm has 18 and 24).

**Reference evidence**

```
$ ./node_modules/.bin/tsc -p docs/reference/model-semantics/tsconfig.json   → exit 0
$ ./node_modules/.bin/eslint docs/reference/model-semantics                → exit 0
$ node --test 'docs/reference/model-semantics/test/*.test.ts'
ℹ tests 23   ℹ pass 23   ℹ fail 0                                          # was 22: +1 S1 test
$ node docs/reference/model-semantics/probes/q124-skills.ts --write        # run twice → same sha256
c21ed3f85c9524d47037acc9714bb3adf725601b4e5087f972a574e75ec9b5e9  results/q124-skills.json
$ node docs/reference/model-semantics/probes/q123-covariance.ts --splits 40 --write
3eaaf67d23f239962893c31b72a4822aac8dbcbdf57a71c6f94922631503d08b  results/q123-covariance.json   (unchanged)
```

**Formatting, diff and unchanged inputs**

```
$ ./node_modules/.bin/prettier --check packages/engine/{src,test/model,test/predict,test/rank,bench,package.json,tsconfig.json,vitest.config.ts} docs/reference/model-semantics
All matched files use Prettier code style!
$ ./node_modules/.bin/prettier --check docs/changelog/T06-training-prediction.md   → clean
# docs/OPEN_QUESTIONS.md already fails --check on main (pre-existing); T06 only appended Q-140/Q-141, unformatted file left as is.
$ git diff --check main...HEAD && git diff --check   → DIFFCHECK_OK
$ shasum -a 256 packages/engine/test/golden/*.json   (unchanged from main)
8982ab4a…  roster.calibration-x1.3.json   6a02f360…  roster.json   3e3f8644…  targets.json   1ccf0d5a…0b2  truth.json
```

I did not run `pnpm -r build`, the master-data build/refresh or golden generation.

## Open questions / follow-ups

- **Q-140 (new):** a guest or unmatched parent with no recorded sparks is treated as unknown lineage, and the row is excluded.
- **Q-141 (new):** the snapshot has no rules version, so only master-version changes are detected at prediction. The caller must refit after rules overrides (ADR-0002 §2.11).
- **Q-130/Q-131 (unchanged):** both assumptions are kept visible in `FitReport.skills.assumptions`. Contradictions are counted (0 on the golden data).

Limitations:

- The golden inheritance and skill rates are SYNTHETIC (Q-120). None of this validates real game constants or real hint activation. Lineage sparks are only potential hints.
- The ADR-0002 limitations still apply: additivity, unverified rules, fold reuse, population-average parameter uncertainty and missing grandparents.
  - Across seeded alternative splits the coverage varies (default seed 0.7750, 'other' 0.8208); these are diagnostics, not gates.
  - No inflation is applied.
- The benchmark ran under Node 25.9, not Node 22 (none is installed).
- `apps/web` does not import the engine yet (T13). Browser safety is shown by the esbuild browser bundle and the import-graph test, not by the web build itself.
- For T13: `ChildPrediction` contains typed arrays only when `keepSamples` is set. Comlink structured clone handles them.
