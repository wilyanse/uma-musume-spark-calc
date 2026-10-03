# 50 — Engine (inheritance, training model, prediction, ranking)

Owner tasks: **T05** (inheritance + scenarios), **T06** (training model + prediction + CM scoring + ranking), **T08** (golden dataset, shared with QA), **T15** (rules calibration, M4).
Package: `packages/engine`. Pure TypeScript with no DOM or network access. Every function is deterministic given a seeded RNG (`mulberry32` or `xoshiro128**` in `src/rng.ts`). The web app calls it from a Web Worker.

## 1. Public API (`packages/engine/src/index.ts`)
```ts
loadContext(master: MasterBundle, rules: Rules): EngineContext
inheritanceExpectation(ctx, trainee: OutfitId, parents: [Veteran, Veteran], scenarioId): InheritanceResult   // T05
fitTrainingModel(ctx, roster: Veteran[], opts?: FitOptions): ModelSnapshot                                   // T06
predictChild(ctx, model, input: PlanInput, pair: [Veteran, Veteran], opts: {samples: number, seed: number}): ChildPrediction // T06
scoreTarget(pred: ChildPrediction, target: CmTarget): TargetScore                                          // T06
rankPairs(ctx, model, input: PlanInput, roster: Veteran[], target: CmTarget, opts: RankOptions, onProgress?): RankedPair[] // T06
calibrateRules(ctx, roster: Veteran[]): CalibrationReport                                                  // T15
PlanInput = { traineeOutfitId, deck: DeckSlot[6], trainMode: TrainMode, scenarioId, lockParent1?: VeteranId }
```
`Veteran` = `RosterVeteran` from 01 §9.

## 2. Scenario plugins (`src/scenarios/<id>.ts`)
```ts
interface ScenarioPlugin {
  id: string
  statCap(ctx): number                              // from scenarios.json
  inheritanceTurns(ctx): number[]                   // from scenarios.json
  deckFeatures(deck: DeckSlot[], ctx): Record<string, number>   // extra model features, may be {}
  sparkEffects?(spark, ctx): Partial<Effect>         // scenario-specific white spark effects
}
```
Register every Global scenario in master data. A scenario without a plugin uses `DefaultScenario`, which reads everything from master data. This is the "pluggable" requirement: adding a scenario means a master data row plus an optional plugin file.

## 3. Inheritance model (T05)
The inputs are the trainee outfit T, the parents P1 and P2, and grandparents (the parents' own parents, whose sparks are `owner=parent1|parent2` on each P).
- **Legality:** `P1.characterId != P2.characterId`, and neither equals T's character. Illegal pairs are never scored.
- **Affinity:** `aff(T,P1) + aff(T,P2) + aff(T,P1,GP)…` using the `affinity.json` groups. The exact formula comes from the cited source in `rules.json.affinity` (`verified:false` until T15). Return the total and a per-relationship breakdown.
- **Spark roll per inheritance event e ∈ inheritanceTurns:** each spark s from P1, P2 (weight 1) and the 4 grandparents (weight `grandparentWeight`) activates independently with
  `p(s) = clamp(activation[type][stars] × weight × affinityMultiplier(affinity), 0, 1)`.
- **Effects of one activation:**
  - blue: `+blueStatGain[stars]` to the stat;
  - pink: `+pinkGradeGain[stars]` grades to the aptitude, capped at S;
  - green / white(skill): a hint for that skill (hint level `whiteHintLevels[stars]`);
  - white(race / scenario): `raceSparkStatGain` / `sparkEffects`.
- **Initial bonus at career start:** the parents' (not grandparents') blue sparks add `blueInitialBonus[stars]`.
- **Outputs** (`InheritanceResult`):
  - `expectedStatGain[5]` (exact: Σ p × gain × number of events + initial);
  - `aptitudeDist: Record<AptKey, Grade→prob>`, computed exactly by a convolution over events (the grade changes are small integers);
  - `skillHintProb: Record<skillId, prob>` = 1 − Π(1 − p) over all activations that hint it;
  - `contributions[]`: {sparkId, from: 'P1'|'P2'|'GP1a'…, type, stars, p, expectedEffect};
  - `affinity`: {total, breakdown}.
- Everything above is exact (closed form). Also provide `sampleInheritance(ctx, …, rng)` for the Monte Carlo in §5.

## 4. Training model (T06, `fitTrainingModel`)
**Training rows:** veterans with `min_confidence ≥ 0.9`, a scenario, and both parents known (a guest counts as known because its sparks are on the child). For each row:
`residual[k] = finalStat[k] − E[inheritance stat gain k | its real parents, grandparents, trainee]` for k in the 5 stats (§3 applied to the veteran's own lineage).

**Features x** (a design matrix, with names stored in the snapshot):
- intercept, one-hot `scenarioId × trainMode`;
- the trainee outfit's growth % per stat (5);
- for each card in the deck: an indicator × `(1 + lb/4)` aggregated by **card id**. It's also pooled by **card type** (7 type-count features weighted by LB), so an unseen card borrows strength from its type;
- scenario `deckFeatures`;
- recency: days since the most recent veteran, a decaying weight `w = 0.5^(age_days/60)` used as the sample weight, not as a feature.

**Estimation:** weighted ridge regression, one per stat. There are two penalty groups: card-id coefficients get λ_id, and everything else gets λ_base. Choose both by **5-fold CV** on a grid {0.1, 1, 10, 100} × {0.1, 1, 10}. Fit on 80%, report on the 20% **holdout** (seeded split): MAE per stat and 80% interval coverage. ~~`residualCov` = the weighted covariance of the holdout residuals.~~ The implementation uses a small dense solver (Cholesky) in `src/linalg.ts`, with no heavy dependencies.

**Erratum (ADR-0002 §2, T05b; supersedes the struck sentence).**
- `residualCov` (Σ_N) is the covariance of the training outcome *excluding* inheritance sampling variance. It is estimated without the holdout:
  - start from the recency-weighted (clock = newest train row), **uncentred** second moment S of the 5-fold **out-of-fold** residuals on the train split, using the same folds and per-stat λ as the CV;
  - subtract C̄, the mean of each row's engine `statGainCov` on its recorded lineage, with the **same** weights (the heteroskedastic term subtracted exactly once);
  - symmetrise, then floor to PSD by a deterministic cyclic Jacobi eigen-decomposition with λ' = max(λ, ε), ε = 1e-6·max(1, tr(S)/5). Non-convergence is a typed error, and an all-zero input gives εI.
- Fit diagnostics (not snapshot fields): the floored count and mass, a warning when any diag(S − C̄) ≤ 0, the OOF mean and the ESS.
- `perStat.sigma` = √Σ_N[k][k].
- The holdout is used only for:
  - MAE;
  - `coverage80` = the pooled share of (row, stat) cells with |e| ≤ z0.9·√(Σ_N,kk + Var[inh_k | row lineage]);
  - a weighted mean-residual bias diagnostic (SE, T²), which is never subtracted.
- No inflation constant is applied. Any change to rules or master data requires a refit.

**Skill acquisition:** for each train mode, a Beta posterior of `P(acquired | skill was hinted or innate)` per skill, with a global prior `Beta(a0,b0)` fitted by the method of moments across skills. ~~A skill is *hinted* for a veteran if it's in the deck's hint/event skills or in any parent/grandparent white/green spark.~~ Snapshot fields: 01 §13.

**Erratum (ADR-0002 §3, T05b; supersedes the struck sentence).** The estimand is θ = P(acquired | actually hinted or innate). Lineage sparks are only *potential* hints, because activation is unobserved.
- **Exposure.** For each train row and each candidate skill (deck hint/event ∪ innate ∪ any recorded-lineage source, minus the unique skill):
  - q = 1 for deck hint/event or innate (an unverified approximation, Q-130);
  - otherwise q = `skillHintProb` from §3 on the recorded lineage.
  - Acquired y ~ Bernoulli(q·θ).
- **Posterior** under the mode prior Beta(a0, b0):
  - q = 1 rows update conjugately;
  - q < 1 successes add 1 to a;
  - q < 1 failures multiply the density by (1 − qθ), so the posterior is **not** Beta;
  - q = 0 non-acquisitions are dropped;
  - q = 0 acquisitions are contradictions, excluded and reported (Q-131).
- **Integration.** Posterior moments come from deterministic tanh-sinh quadrature:
  - computed in log space, with the boundaries θ = 0 and θ = 1 never evaluated;
  - converged when successive levels agree to a relative error < 1e-10, otherwise a typed error.
- **Storage.** Store the moment-matched Beta {a, b} (exact mean and variance). It equals the conjugate update when all q = 1.
- **Global prior `'*'`.** Method of moments on train rows only, exposure-aware: r_s = Y_s/Σq, τ² = between-skill spread − mean sampling variance. m is clamped to [0.005, 0.995] and ν to [2, 1000]; with fewer than 2 usable skills, use Beta(1,1).
- **Unseen skills** use `'*'`.
- Reference implementation and evidence: `docs/reference/model-semantics/`.

**Stat cap:** predictions are clipped to `statCap`.

## 5. Child prediction (T06, `predictChild`)
For N samples (default 2,000; seeded):
1. `inh = sampleInheritance(…)`.
2. `train ~ MVN(x·β, residualCov)` using the child's features (the planned deck, mode, scenario, trainee growth).
3. `stats = clip(train + inh.statGain, 1, statCap)`.
4. Aptitudes = the trainee base + `inh.pinkGain`.
5. For each required/optional skill S: `hinted ~ Bernoulli(P(hinted))` (deck hint ∪ `inh` hints ∪ innate), then `acquired ~ Bernoulli(Beta mean for (mode, S) or the prior)`.

**Erratum (ADR-0002, T05b).**
- Step 2: `residualCov` excludes inheritance (§4 erratum); inheritance variance enters only through step 1. Draw `train = x·β + L z`, where:
  - L = V·diag(√λ') is the eigen factor from the §4 PSD step (not Cholesky);
  - z is five Box–Muller standard normals in stat order.
- Seeded streams: inheritance uses `seedFromString(`${seed}:inh`)` and training uses `seedFromString(`${seed}:train`)`, so neither consumes the other's draws.
- Step 5: `hinted` is sampled **once**, from deck hint/event ∪ innate ∪ *this sample's* `inh` hints. Then `acquired ~ Bernoulli(E[θ_{mode,S}])` with the v2 conditional rate (§4 erratum). The Beta is never multiplied by P(hinted) a second time.
- A `training-v1` snapshot is rejected with a typed refit-required error.

Return the per-stat mean, p10, p50 and p90; per-aptitude grade probabilities; per-skill acquisition probability; and the raw samples, kept only if `opts.keepSamples`.

## 6. Target scoring (T06, `scoreTarget`)
- `pMeet` = the share of samples where **all** hold: stat ≥ min for every min stat, grade ≥ min for every min aptitude, and every required skill acquired.
- `bottleneck` = the single requirement with the lowest marginal pass rate.
- `surplus` = Σ_k w_k × E[max(0, stat_k − min_k)] + Σ optional skill weight × P(acquired).
- Sort key: `pMeet` descending, then `surplus` descending.

## 7. Ranking (T06, `rankPairs`)
1. Candidates: all legal pairs from the roster (with `lockParent1` fixing one side). Exclude guests; they're never in the roster as veterans.
2. **Fast pass for all pairs:** a Gaussian approximation. stat_k ~ N(μ_train+E[inh], Σ_kk + Var[inh_k]). pMeet ≈ Π over independent requirement groups, computed with the exact aptitude distributions from §3 and skill probabilities from §4. This is O(pairs × sparks) with no sampling.
   *Erratum (ADR-0002, T05b):*
   - Σ_kk is the non-inheritance `residualCov` (§4 erratum) and Var[inh_k] is the closed form from §3, each counted once.
   - The skill factor is P(acquire S) = P(hinted S | pair) · E[θ_{mode,S}], where P(hinted) = 1 for deck/innate and the §3 `skillHintProb` otherwise.
3. **Precise pass:** the top `K=100` by fast score get the full Monte Carlo with `samples=2000` and a seed derived from the pair IDs, then are re-sorted.
4. Return the top `N=50` `RankedPair {parents, pMeet, surplus, bottleneck, affinity, contributions, prediction}`.
5. **Performance budget:** 260 veterans (33,670 pairs) finish in **< 5 s** in Node 22 on the dev Mac, as a Vitest bench whose output is recorded in the changelog. Report progress every 1,000 pairs.

## 8. Calibration (T15, M4)
Use every veteran whose parents are both matched roster veterans or guests. We don't observe the activation outcomes, so we can't fit directly. Instead:
1. **Aptitude check:** compare the observed final aptitude grades with the predicted `aptitudeDist` (base + pink). Report the log-likelihood and a reliability table.
2. **Stat check:** compare the model's residuals with and without the inheritance term, over a grid of multipliers on `blueStatGain`. Report the multiplier that minimises holdout MAE.
3. **Skill check:** compare observed skills with the predicted acquisition. *(ADR-0002: use the exposure-aware prediction q·E[θ] per (row, candidate skill). Refit the training model after applying any rule multiplier, because both Σ_N and q depend on the rules.)*

Output a `CalibrationReport` with suggested rule multipliers. The user applies them from S07; they're never auto-applied.

## 9. Acceptance
- **T05:** unit tests:
  - Hand-computed expectations for three toy lineages (1, 3 and 9 sparks).
  - Aptitude distribution probabilities sum to 1.
  - Illegal pairs are rejected.
  - A property test: Monte Carlo means over 50k samples are within 1% of the closed form.
  - Every numeric constant is read from `rules.json` (a test that swaps the rules changes the outputs).
- **T06:** on the golden dataset (70 §2), the fit recovers the planted card effects within ±15%; holdout 80% coverage is 0.72–0.88; the planted best pair ranks #1 and the planted trap pair (a high single stat but a missing required skill) doesn't reach the top 10. The benchmark meets §7.5.
  *Clarification (ADR-0002, T05b; thresholds, golden seed, roster and targets unchanged).* The T06 tests are:
  1. **Card effects** use the Q-122 estimand: β_id[card] + β_type[type(card)] per unit of (1 + lb/4), every planted card and stat within ±15%, on the stored split.
  2. **Coverage, stored split:** the snapshot `coverage80` (§4 erratum, Gaussian form) is in [0.72, 0.88], and so is the seeded §5 Monte Carlo p10–p90 coverage of the holdout rows with the chosen Σ_N. Additional splits are reported as robustness diagnostics, not as gates.
  3. **Covariance properties:**
     - `residualCov` is exactly symmetric, with min eigenvalue ≥ ε;
     - `sigma` is √diag exactly;
     - perturbing the holdout y leaves λ, β and `residualCov` bit-identical.
  4. **Single count:**
     - on a synthetic fixture with a known noise covariance, Σ_N recovers it without Var[inh];
     - on a two-group weighted fixture, the subtraction uses the same-weighted C̄;
     - the empirical MC variance matches Σ_N,kk + Var[inh_k];
     - a fixture with S < C̄ floors deterministically and warns.
  5. **Skills:**
     - q = 1 data equals the conjugate update;
     - known-θ lineage-only synthetic data is recovered without bias;
     - no-opportunity, rare-skill and q = 0 contradiction cases behave as in ADR-0002;
     - P(acquire) multiplies availability exactly once.
  6. **Version guard:** `predictChild`/`rankPairs` on a `training-v1` snapshot throw the typed refit-required error, and the fit emits only `training-v2`.
  7. **Determinism:** the same seed gives identical samples, and the inheritance stream is independent of training draws.
- **T15:** on the golden dataset with planted `blueStatGain` × 1.3, calibration suggests a multiplier in [1.2, 1.4].
