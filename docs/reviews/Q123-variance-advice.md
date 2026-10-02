# Q-123 independent statistical advice

Adviser session: 20261003_002714_d3201d. Reviewed main: 17e3236.

Evidence note: numerical probes were reported by the adviser but deleted; the parent has not independently reproduced the proposed estimator. T05b must retain runnable evidence and verify the recommendation before it unblocks T06.

Q-123 adviser report: covariance semantics before T06 dispatch

Read-only review at 17e3236 (main, T08 merged at 1066e89). The worktree was clean before and after; I made no tracked edits. My probes lived in ~/.hermes/cache/scratch/q123 and are deleted. All probes used only observable inputs (roster rows, the recorded lineage, and the engine's E[inh] and statGainCov through the committed scripts). The one exception is a labelled oracle diagnostic that used the planted noise covariance; it fed no estimator.

1. Recommendation

Adopt option B, "out-of-fold (OOF) training deconvolution":

- `params.residualCov` (Σ_N) becomes the NON-inheritance training covariance.
  - It is estimated from 5-fold out-of-fold residuals on the 80% train split.
  - The same-weighted mean of the engine's per-row inheritance covariance is subtracted exactly once.
  - The result is symmetrised and floored to PSD.
- Prediction (§5 Monte Carlo and §7 Gaussian) adds inheritance exactly once.
- The 20% holdout never enters the covariance. It only produces MAE, coverage80 and a bias diagnostic.
- No correction constant is applied.

Reject option A (deconvolve the holdout covariance; this is the minimal change):
- Under the §5 Monte Carlo form it fails the authoritative band on the stored split itself: 0.7167.
- It sets its own width from the holdout it is scored on.
- 147 of 200 splits needed eigenvalue flooring.

The ±15% card recovery is untouched: β does not change, and the worst error stays 4.65% at the CV λ. The 0.72–0.88 band is not relaxed.

The JSON shape stays the same. I recommend bumping the kind discriminator; see section 5.

2. Evidence

Reproduce the baseline with: `node packages/engine/test/golden/diagnostics.ts`

My probes reproduced the committed numbers exactly before adding the new options: literal 0.7917, +Var[inh] 0.9000, net 0.7292, CV λ 0.1/0.1 ×4 and 0.1/1, train ESS 176.3.

Probe setup:
- Python/numpy re-implementation of the same design, ridge, CV grid and recency weights.
- Inheritance samples: 2000 per row from `sampleInheritance`, seeded `q123-inh:<id>`.
- "§5 MC" = interval [p10, p90] of train ~ MVN(0, Σ) + (sampled inh − E[inh]).
- "§7 Gauss" = ±z0.9·sqrt(Σ_kk + C_i,kk), with C_i the row's engine statGainCov.
- Coverage is pooled over 48 × 5 cells.

Stored split (192/48):

| Option | §7 Gauss | §5 MC |
|---|---|---|
| literal holdout residualCov, no inheritance added | 0.7917 | — |
| literal + Var[inh] (the double count, as the spec currently reads) | 0.9000 (fail) | 0.9000 (fail) |
| A: PSD(S_hold − C̄_hold) + C_i | 0.7333 | 0.7167 (fail) |
| B: PSD(S_oof − C̄_train) + C_i | 0.8250 | 0.8125 |

- Option B per stat (Gauss): 0.7708, 0.8125, 0.8333, 0.8125, 0.8958.
- Option B §5 MC over 20 sampling seeds: 0.8125 / 0.8240 / 0.8375 (min / mean / max).
- Option B over 20 OOF fold seeds: 0.8125 / 0.8258 / 0.8417.

Matrices on the stored split (order spd, sta, pow, gut, wit):

- Holdout total residual covariance, centred (current 50 §4), holdout ESS 43.5:

  ```
  71.00  21.97   9.21 -12.93  -0.54
  21.97  59.80   7.98   7.70  -7.50
   9.21   7.98  58.96  10.43  -7.20
 -12.93   7.70  10.43  84.94  -7.36
  -0.54  -7.50  -7.20  -7.36  66.94
  ```

- C̄_hold (holdout-weighted mean engine Cov[inh]): diagonal 32.32, 39.02, 35.65, 67.00, 47.29.
- Option A before flooring has eigenvalues [−5.46, 11.48, 14.06, 41.52, 58.77]; one is floored.
- S_oof (OOF train, uncentred): diagonal 77.49, 71.88, 95.37, 95.63, 123.82. Its mean is [−0.15, −0.47, 0.01, 0.27, −0.24].
- C̄_train: diagonal 31.57, 41.05, 44.69, 63.84, 55.81.
- Option B result, Σ_N, with eigenvalues before flooring [19.11, 27.79, 37.57, 61.85, 80.90] (none floored):

  ```
  45.92  12.47  16.20  -3.06   3.75
  12.47  30.83  10.34  -5.73  -5.46
  16.20  10.34  50.68   2.97  13.82
  -3.06  -5.73   2.97  31.79  -4.22
   3.75  -5.46  13.82  -4.22  68.00
  ```

- perStat.sigma = sqrt(diag Σ_N) = 6.776, 5.552, 7.119, 5.638, 8.247.
- For reference only (not an input): the planted noise sd is 6, 5.4, 6, 5.4, 5.4. The excess is parameter-estimation error plus rounding, which B is meant to absorb.

200 independent random 192/48 splits (numpy-seeded 10000+rep; λ re-chosen by 5-fold CV for each split):

| Option | mean | sd | p5 | min | max | share in band |
|---|---|---|---|---|---|---|
| literal | 0.8091 | 0.020 | 0.7708 | — | — | 1.000 |
| literal + inh (Gauss) | 0.8914 | — | — | — | — | 0.235 |
| literal + inh (MC) | 0.8849 | — | — | — | — | 0.420 |
| A Gauss | 0.7395 | 0.039 | 0.6706 | — | — | 0.705 |
| A MC (first 50 splits) | 0.7300 | — | — | — | — | 0.680 |
| B Gauss | 0.7801 | 0.035 | 0.7167 | 0.6833 | 0.8667 | 0.945 |
| B §5 MC | 0.7751 | 0.037 | 0.7165 | 0.6750 | 0.8667 | 0.930 |
| C: leverage-corrected in-sample σ² − C̄ + per-row sandwich | 0.7555 | — | 0.6958 | — | — | 0.830 |
| oracle (planted noise + C_i, no parameter error) | 0.7413 | — | — | — | — | — |

- Option C on the stored split: 0.8000.
- Option B ratio E[e²/var] = 1.137 (p5 0.88, p95 1.49).
- The oracle shows that parameter-estimation error is real (about −0.06 of coverage). Option B absorbs most of it, because the OOF fits estimate it at the population level; about −0.02 to −0.025 of residual under-coverage remains.
- I did not add a correction for that. A constant inflation chosen here would be tuning to the test.

Holdout residual mean, stored split:
- Weighted: [−0.83, 0.19, 2.08, 2.67, −2.18].
- Hotelling-type T² = 8.43, below the χ²₅ 95% value of 11.07, so it is consistent with zero.

Small samples: with train subsamples of n = 20, 30, 40, 60 and 100 (100 draws each), option B needed no flooring.

3. Exact algorithm for 50 §4 (the T06 spec)

1. Split, λ choice and β are unchanged. The snapshot β is the fit on the 80% train rows T.
2. Weights: w_i = 0.5^(age_i/60), with the clock at the newest row of T. Let W = Σ_T w_i.
3. Folds: the same seeded 5-fold partition used for CV, with λ fixed per stat at the CV choice. For each fold f, refit on T∖f and record e_i = y_i − x_i·β^(−f) for i in f. Here y = finalStat − E[inh | recorded lineage].
4. Total OOF covariance, uncentred: S = Σ_T w_i e_i e_iᵀ / W.
   - No degrees-of-freedom correction: OOF residuals are already out of sample.
   - Uncentred, so systematic bias counts as error.
   - Also report the OOF mean m = Σ w e / W and ESS = W²/Σw² (engine diagnostics; not in the snapshot).
5. Heteroskedastic inheritance term: C̄ = Σ_T w_i C_i / W, where C_i = statGainCov from `expectationFromPlan` on the same recorded lineage used for y_i. The weights must match step 4.
6. Raw = S − C̄; symmetrise R = (Raw + Rawᵀ)/2. Eigen-decompose with a deterministic cyclic Jacobi method (5×5, fixed sweep order, convergence at 1e-12·trace).
   - Floor each eigenvalue: λ' = max(λ, ε), with ε = 1e-6·max(1, tr(S)/5).
   - Σ_N = V diag(λ') Vᵀ, symmetrised again.
   - Report the count of floored eigenvalues and the total floored mass as fit diagnostics.
   - If any diag(R) ≤ 0 (inheritance variance exceeds the total), emit a warning. That signals mis-specified rules, not just noise.
7. perStat.sigma_k = sqrt(Σ_N[k][k]). This is the non-inheritance training sd, never the total.
8. Holdout H (untouched by steps 3–6):
   - MAE as now.
   - coverage80 = pooled share of (row, stat) cells with |y − xβ| ≤ z0.9·sqrt(Σ_N,kk + C_i,kk). This is the §7 Gaussian form, using the row's recorded-lineage C_i.
   - The weighted holdout mean residual is a diagnostic only.

Prediction (§5):
- train ~ MVN(xβ, Σ_N), using factor L = V diag(sqrt(λ')) from step 6. Do not use Cholesky; the eigen factor is robust when Σ is near-singular.
- Separate seeded streams, so neither consumes the other's draws:
  - inheritance: seedFromString(`${seed}:inh`);
  - training: seedFromString(`${seed}:train`), standard normals by Box–Muller, five per sample in stat order.
- Then add inh.statGain once and clip.

Fast pass (§7): Var = Σ_N,kk + Var[inh_k | candidate pair].

Meaning of a non-zero holdout mean: the 80% fit is biased for the holdout population. Possible causes are drift beyond the recency model, cards seen rarely or never in training, ridge shrinkage, missing grandparents in recorded lineages, or wrong inheritance rules (the T15 signal). Do not subtract or centre it away. Being uncentred, the OOF covariance includes the training-side bias². Report the holdout mean (with its standard error) and flag it when T² exceeds the χ²₅ 95% value.

4. Limitations to state in the ADR

- The subtraction assumes training noise and inheritance are additive and independent, and that the engine's Var[inh] is correct.
  - If rules.json is wrong (Q-3 placeholders, T15 multipliers), Σ_N absorbs the error.
  - Any change to rules or master data requires a refit.
- Parameter uncertainty enters only as a population average from 4/5-size fits. It is not per-row, so unusual decks (rare cards) are under-covered and well-supported decks over-covered.
  - The finite-sample shortfall is about −0.02 to −0.025 (mean 0.775–0.780 against nominal 0.80).
  - The per-split sd of about 0.035 at n_hold = 48 dominates. About 5–7% of random splits fall below 0.72.
- Reusing the CV folds for both λ selection and OOF residuals is mildly optimistic.
- Unmatched parents have no grandparents in the recorded lineage. Their missing inheritance variance lands in Σ_N, but child predictions use full lineages, so this is a slight double count for those rows.
- Rounding and clipping are not modelled; the clip is not exercised by the golden data (max stat/cap 0.601).

5. Proposed text edits (the parent applies these)

50 §4, replace the sentence "`residualCov` = the weighted covariance of the holdout residuals." with:

"`residualCov` (Σ_N) is the covariance of the training outcome *excluding* inheritance-sampling variance, estimated without the holdout: the recency-weighted, uncentred covariance of 5-fold out-of-fold residuals on the train split (same folds and per-stat λ as the CV), minus the same-weighted mean of the per-row inheritance covariance `statGainCov` on each row's recorded lineage, symmetrised and floored to PSD by eigenvalue (ε = 1e-6·max(1, tr/5)). `perStat.sigma` = √Σ_N[k][k]. The holdout is used only for MAE, `coverage80` (|e| ≤ z0.9·√(Σ_N,kk + Var[inh_k | row lineage]), pooled over rows × stats) and a mean-residual bias diagnostic. Inheritance variance is added exactly once, at prediction (§5, §7). See ADR-0002."

50 §5, step 2: "`train ~ MVN(x·β, residualCov)` where residualCov excludes inheritance (§4); inheritance variance enters only through step 1. Use a deterministic eigen factor of residualCov and the separate seeded streams `${seed}:inh` / `${seed}:train`."

50 §7, step 2: "Σ_kk (non-inheritance, §4) + Var[inh_k] (closed form, §3), counted once."

01 §13 comments:
- `residualCov: number[][] /*5x5 NON-inheritance training covariance (50 §4, ADR-0002); PSD*/`
- `sigma: number /* √residualCov[k][k] */`
- `coverage80 /* untouched holdout, 50 §4 predictive form */`
- `kind: 'training-v2'` (see versioning below).

Versioning: the JSON shape is unchanged. I recommend `kind: z.enum(['training-v1','training-v2'])`, with T06 emitting only training-v2 and the engine rejecting training-v1 with a typed error that prompts a refit. This needs a small schema/API literal update (T01/T04 ownership; the D1 kind column is plain TEXT, so no migration).

Fallback with zero contract change: keep training-v1 and record in the ADR that no compliant v1 producer ever existed. That is only safe if you confirm no real training-v1 rows exist in D1. I could not check that (no credentials, by design).

6. ADR-0002 outline: residual covariance semantics

1. Context: the Q-123 double count; the T08 numbers 0.9000, 0.7917, 0.7292.
2. Options: literal; A (holdout deconvolution); B (OOF deconvolution); C (leverage + sandwich), with the numbers from section 2.
3. Decision: B.
4. Estimator details: section 3.
5. Versioning: section 5.
6. Limitations: section 4.
7. Consequences:
   - T15 calibration needs a refit after any rules change.
   - The UI σ column is labelled "training σ (excl. inheritance)" (bindings.md:191).
8. Related open item: the skill-hint double count below.

7. Related issue (new Q, not in scope here): skill-hint double count

50 §4 counts a skill as "hinted" if any lineage spark could hint it, so for lineage-only rows the Beta posterior estimates rates × skillHintProb (truth.skills.observableEstimand already documents this). 50 §5 then also samples `hinted ~ Bernoulli(P(hinted))` from `inh` hints, which applies the activation probability twice.

Fix options:
- train the Beta on deck-, innate- or event-hinted rows only, or
- define the §4 "hinted" set exactly as §5 does and drop the extra Bernoulli.

It affects pMeet and the best-pair/trap tests through skill X. It needs its own Q before T06.

8. Acceptance tests T06 must implement (no relaxed thresholds)

1. Golden, stored split:
   - card recovery within ±15% (unchanged);
   - snapshot coverage80 in [0.72, 0.88];
   - also the §5 Monte Carlo p10–p90 coverage in band (my reference values: 0.8250 Gauss, about 0.81–0.84 MC).
2. Snapshot.residualCov is symmetric and PSD (min eigenvalue ≥ ε); sigma_k equals √diag exactly.
3. No-leakage test: permuting or perturbing holdout y leaves residualCov and β bit-identical; it changes only MAE, coverage80 and the bias diagnostic.
4. Single-count test:
   - On a synthetic fixture with known noise covariance and large n, residualCov stays within tolerance of that noise covariance and does not include Var[inh].
   - Predictive variance equals Σ_N + Var[inh] (empirical MC variance within tolerance).
5. Heteroskedastic test: on a two-group fixture with different C_i, the subtraction uses the weighted mean of C_i with the same weights as S.
6. Flooring test: a fixture where S < C̄ on some stat yields floored eigenvalues, the diagnostics count and a warning. Sampling with a rank-deficient Σ is deterministic and finite (eigen factor).
7. Determinism:
   - the same seed gives identical samples;
   - the inheritance stream is unaffected by the training draws.
8. Version guard: predictChild/rankPairs on a training-v1 snapshot throws the typed error (or whatever the fallback decision specifies).
9. Robustness diagnostic (report only, not a gate): coverage over ≥40 alternative splits, recorded in the changelog with mean and p5.

The probe scripts are deleted, so there is no command to re-run them. The estimator to re-implement is fully specified in section 3. The baseline above comes from the committed diagnostics command.
