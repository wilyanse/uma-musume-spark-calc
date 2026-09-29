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

**Estimation:** weighted ridge regression, one per stat. There are two penalty groups: card-id coefficients get λ_id, and everything else gets λ_base. Choose both by **5-fold CV** on a grid {0.1, 1, 10, 100} × {0.1, 1, 10}. Fit on 80%, report on the 20% **holdout** (seeded split): MAE per stat and 80% interval coverage. `residualCov` = the weighted covariance of the holdout residuals. The implementation uses a small dense solver (Cholesky) in `src/linalg.ts`, with no heavy dependencies.

**Skill acquisition:** for each train mode, a Beta posterior of `P(acquired | skill was hinted or innate)` per skill, with a global prior `Beta(a0,b0)` fitted by the method of moments across skills. A skill is *hinted* for a veteran if it's in the deck's hint/event skills or in any parent/grandparent white/green spark. Snapshot fields: 01 §13.

**Stat cap:** predictions are clipped to `statCap`.

## 5. Child prediction (T06, `predictChild`)
For N samples (default 2,000; seeded):
1. `inh = sampleInheritance(…)`.
2. `train ~ MVN(x·β, residualCov)` using the child's features (the planned deck, mode, scenario, trainee growth).
3. `stats = clip(train + inh.statGain, 1, statCap)`.
4. Aptitudes = the trainee base + `inh.pinkGain`.
5. For each required/optional skill S: `hinted ~ Bernoulli(P(hinted))` (deck hint ∪ `inh` hints ∪ innate), then `acquired ~ Bernoulli(Beta mean for (mode, S) or the prior)`.

Return the per-stat mean, p10, p50 and p90; per-aptitude grade probabilities; per-skill acquisition probability; and the raw samples, kept only if `opts.keepSamples`.

## 6. Target scoring (T06, `scoreTarget`)
- `pMeet` = the share of samples where **all** hold: stat ≥ min for every min stat, grade ≥ min for every min aptitude, and every required skill acquired.
- `bottleneck` = the single requirement with the lowest marginal pass rate.
- `surplus` = Σ_k w_k × E[max(0, stat_k − min_k)] + Σ optional skill weight × P(acquired).
- Sort key: `pMeet` descending, then `surplus` descending.

## 7. Ranking (T06, `rankPairs`)
1. Candidates: all legal pairs from the roster (with `lockParent1` fixing one side). Exclude guests; they're never in the roster as veterans.
2. **Fast pass for all pairs:** a Gaussian approximation. stat_k ~ N(μ_train+E[inh], Σ_kk + Var[inh_k]). pMeet ≈ Π over independent requirement groups, computed with the exact aptitude distributions from §3 and skill probabilities from §4. This is O(pairs × sparks) with no sampling.
3. **Precise pass:** the top `K=100` by fast score get the full Monte Carlo with `samples=2000` and a seed derived from the pair IDs, then are re-sorted.
4. Return the top `N=50` `RankedPair {parents, pMeet, surplus, bottleneck, affinity, contributions, prediction}`.
5. **Performance budget:** 260 veterans (33,670 pairs) finish in **< 5 s** in Node 22 on the dev Mac, as a Vitest bench whose output is recorded in the changelog. Report progress every 1,000 pairs.

## 8. Calibration (T15, M4)
Use every veteran whose parents are both matched roster veterans or guests. We don't observe the activation outcomes, so we can't fit directly. Instead:
1. **Aptitude check:** compare the observed final aptitude grades with the predicted `aptitudeDist` (base + pink). Report the log-likelihood and a reliability table.
2. **Stat check:** compare the model's residuals with and without the inheritance term, over a grid of multipliers on `blueStatGain`. Report the multiplier that minimises holdout MAE.
3. **Skill check:** compare observed skills with the predicted acquisition.

Output a `CalibrationReport` with suggested rule multipliers. The user applies them from S07; they're never auto-applied.

## 9. Acceptance
- **T05:** unit tests:
  - Hand-computed expectations for three toy lineages (1, 3 and 9 sparks).
  - Aptitude distribution probabilities sum to 1.
  - Illegal pairs are rejected.
  - A property test: Monte Carlo means over 50k samples are within 1% of the closed form.
  - Every numeric constant is read from `rules.json` (a test that swaps the rules changes the outputs).
- **T06:** on the golden dataset (70 §2), the fit recovers the planted card effects within ±15%; holdout 80% coverage is 0.72–0.88; the planted best pair ranks #1 and the planted trap pair (a high single stat but a missing required skill) doesn't reach the top 10. The benchmark meets §7.5.
- **T15:** on the golden dataset with planted `blueStatGain` × 1.3, calibration suggests a multiplier in [1.2, 1.4].
