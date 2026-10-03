# ADR-0002: Statistical semantics of the training model (residual covariance, skill acquisition) and `training-v2`

- Status: Accepted by the orchestrator after independent T05b review PASS and verified local merge `3f64d39`. See `docs/reviews/T05b-review-1.md`; nonblocking reference-code follow-ups are recorded in the T05b changelog and T06 handoff.
- Resolves: Q-123 (variance double count), Q-124 (skill-hint double count).
- Amends: 01 §13 (snapshot kind and field meanings), 50 §4–§9 (errata), 70 §3 (acceptance clarifications). The numeric thresholds are unchanged.
- Evidence: `docs/reference/model-semantics/` (code, seeded probes, `results/*.json`, diagnostic tests). Reproduce with the commands in its README. The Q-123 adviser's numbers (`docs/reviews/Q123-variance-advice.md`) are self-reports from deleted probes. Every number in this ADR comes from the retained T05b code instead.

## 1. Context

Two quantities in 50 §4 were defined on observable data whose meaning differs from how 50 §5/§7 use them.

1. **Q-123, residual covariance.** 50 §4 sets `residualCov` to the weighted covariance of the holdout residuals of y = stat − E[inh | recorded lineage]. Those residuals already contain the inheritance sampling variance. 50 §5/§7 then add Var[inh] again. On the T08 golden data (stored 192/48 split, recomputed by `probes/q123-covariance.ts`), pooled holdout 80% coverage is:
   - literal holdout covariance alone: 0.7917;
   - literal + Var[inh], as the spec reads today: 0.9000, outside the 0.72–0.88 band;
   - literal − mean Var[inh] + per-row Var[inh]: 0.7292;
   - train plug-in: 0.7208.
     A covariance estimated on the holdout is also scored on that same holdout.
2. **Q-124, skill acquisition.** 50 §4 counts a skill as hinted when any lineage spark _could_ hint it. For lineage-only rows the observed acquired/eligible rate is therefore θ × P(hint activated). 50 §5 then multiplies by P(hinted) again, so activation is counted twice. Activation is never observed.

## 2. Decision A: residual covariance (Q-123)

Adopt the adviser's direction, "out-of-fold (OOF) training deconvolution", with these exact rules. Reference implementation: `src/covariance.ts` and `src/golden.ts` (`fitSplit`).

Let T be the 80% train rows of the seeded split and H the 20% holdout. Let y_i = finalStat_i − E[inh | recorded lineage of i].

1. **β and λ:** unchanged (50 §4). β is the per-stat weighted ridge fitted on all of T, with (λ_id, λ_base) chosen per stat by 5-fold CV on T.
2. **Weights:** w_i = 0.5^(age_i/60), where age is measured from the newest row of T (one clock for all of T). W = Σ_T w_i. H never enters the clock.
3. **OOF residuals:** use the same seeded 5-fold partition of T as the λ CV, with λ fixed per stat at the CV choice. For fold f, refit on T∖f using the step-2 weights of those rows. Record e_i = y_i − x_i·β^(−f) for i ∈ f. Every row of T has exactly one OOF residual vector (5 stats).
4. **Total second moment, uncentred:** S = Σ_T w_i e_i e_iᵀ / W.
   - No degrees-of-freedom correction, because the residuals are already out of sample.
   - Uncentred, so systematic training-side bias counts as error.
   - The OOF mean m = Σ w e / W and ESS = W²/Σw² are reported as fit diagnostics. m is never subtracted.
5. **Inheritance term:** C̄ = Σ_T w_i C_i / W. Here C_i is the engine's exact 5×5 `statGainCov` (T05 `expectationFromPlan`) on the same recorded lineage used for y_i, and the weights are identical to step 4. This handles heteroskedastic inheritance by subtracting each row's own variance, through the same weighted mean, exactly once.
6. **Deconvolve:** R = sym(S − C̄), where sym(A) = (A + Aᵀ)/2.
   - If any R_kk ≤ 0, emit a fit warning: inheritance variance ≥ total for that stat, which signals mis-specified rules or lineage.
7. **PSD projection (deterministic):**
   - Eigen-decompose R with cyclic Jacobi:
     - fixed row-major (p<q) sweep order and the Golub–Van Loan §8.5.2 rotation;
     - stop when off(A) ≤ 1e-12·max(1, ‖R‖_F);
     - at most 100 sweeps, otherwise throw a typed `eigen-nonconvergence` error (never silently continue);
     - eigenvalues sorted ascending, ties broken by original index;
     - each eigenvector's largest-|component| entry made positive.
   - Floor: λ'_k = max(λ_k, ε), with ε = 1e-6·max(1, tr(S)/5).
     - ε is a numerical guard, not a tuned inflation.
     - An all-zero S gives ε = 1e-6 and Σ_N = εI, never a singular matrix.
   - Σ_N = sym(V diag(λ') Vᵀ), with factor L = V diag(√λ').
   - Report the floored count and the floored mass Σ(λ' − λ) as diagnostics.
   - Non-finite inputs and non-positive weights throw typed errors.
8. **Snapshot (training-v2):**
   - `params.residualCov` = Σ_N, the NON-inheritance training covariance.
   - `perStat[k].sigma` = √Σ_N[k][k], exactly.
9. **Holdout (evaluation only):**
   - MAE per stat, as now.
   - `coverage80` = the pooled share of (row, stat) cells in H with |y − xβ| ≤ z0.9·√(Σ_N,kk + C_i,kk), i.e. the 50 §7 form with the row's own recorded-lineage C_i.
   - The recency-weighted holdout mean residual (with its SE and a Hotelling-type T² against χ²₅ 0.95 = 11.07) is a diagnostic only. It is never subtracted, never fed back and never used to rescale Σ_N.
10. **Prediction, inheritance exactly once:**
    - 50 §5 Monte Carlo: train ~ MVN(xβ, Σ_N) drawn as xβ + L z, where z is five Box–Muller standard normals in stat order from the stream `${seed}:train`. Do not use Cholesky. Inheritance is drawn from its own stream `${seed}:inh`. Then stats = clip(train + inh.statGain, 1, statCap).
    - 50 §7 fast pass: Var_k = Σ_N,kk + Var[inh_k | pair] from the T05 closed form.
11. **Refit triggers:** any change to `rules.json` (including applied T15 multipliers), to master data, or to the snapshot semantics requires a refit. Σ_N absorbs any error in the engine's Var[inh].

### Evidence (retained, `results/q123-covariance.json`)

**Card recovery (Q-122 estimand β_id + β_type, stored split, CV λ):** worst 4.65%, 0 failures at ±15%, max |zero-effect card| 2.50. This is identical to `node packages/engine/test/golden/diagnostics.ts`, so β is untouched.

**Chosen estimator (B) on the stored split:**

- ESS 176.32; OOF mean [0.42, −0.32, 0.19, −0.02, 0.10].
- diag S = [89.16, 79.26, 87.04, 95.00, 110.85]; diag C̄ = [31.57, 41.05, 44.69, 63.84, 55.81].
- Raw eigenvalues [18.24, 23.68, 38.78, 67.14, 76.48]: none floored, 4 Jacobi sweeps.
- σ = [7.588, 6.181, 6.507, 5.582, 7.419], with σ = √diag exactly. Σ_N is exactly symmetric, min eigenvalue 18.24.

**Coverage, stored split:**

- Gaussian pooled coverage **0.8292**; per stat 0.854 / 0.833 / 0.813 / 0.792 / 0.854.
- Seeded §5 Monte Carlo p10–p90 (2000 samples, 5 seeds `t05b-q123-mc:0..4`): **0.8292–0.8417**.
- Without inheritance: 0.6958. Inheritance is needed, and it is added once.

**Rejected option A** (deconvolve the centred holdout covariance): raw eigenvalues [−5.46, 11.48, 14.06, 41.52, 58.77], with 1 floored. Gaussian 0.7333, MC 0.7167 (fails the band on the stored split). This matches the adviser's self-report exactly.

**No leakage:** after perturbing every holdout y by 1000·sin(i+k)+37:

- λ is identical, β is bit-identical and Σ_N is bit-identical;
- coverage changes.

**MC/fast-pass variance consistency:** empirical Var(L z + inh) / (Σ_N,kk + Var[inh_k]) over 12 holdout rows × 5 stats with 20,000 draws each: min 0.9727, mean 0.9998, max 1.0188.

**Small samples** (10 seeded train subsamples each at n = 20/30/40/60/100, λ by CV on the subsample): no flooring, no warnings, all finite. At n ≤ 40, Σ_N is large (min eigenvalue 106–249) because OOF error dominates. That is the intended, conservative behaviour.

**Robustness (diagnostic, not a gate):** 40 seeded alternative 192/48 splits (`t05b-q123-split:<rep>`, λ re-chosen per split):

| Form              | mean   | sd    | p5    | min   | in band |
| ----------------- | ------ | ----- | ----- | ----- | ------- |
| Gaussian          | 0.7885 | 0.030 | 0.745 | 0.704 | 39/40   |
| MC (1000 samples) | 0.7821 | 0.032 | 0.737 | 0.696 | 39/40   |

No split needed flooring, and none failed card recovery.

**Fold-partition sensitivity (diagnostic):** 10 alternative OOF partitions on the stored split give Gaussian coverage 0.8208–0.8375 and diag S between [76.5, 67.9, 83.9, 84.3, 103.5] and [94.2, 82.4, 97.0, 95.6, 124.1]. This explains why the adviser's diag S (77.49, 71.88, 95.37, 95.63, 123.82) and its stored-split coverage (0.8250 Gauss) differ from ours (its Python port used a different fold partition). The conclusions agree; the adviser's exact matrices are not claimed as reproduced.

### Limitations (stated, not corrected)

- **Additivity and correctness of Var[inh].** The subtraction assumes training noise and inheritance are additive and independent, and that the engine's Var[inh] is correct. `rules.json` constants are largely `verified:false` (Q-3/Q-5). On the golden data the inheritance is SYNTHETIC (Q-120). With real rules, any error is absorbed into Σ_N.
- **Parameter uncertainty.** It enters only as a population average from 4/5-size fits, not per row. Rare decks are under-covered and common decks over-covered.
  - Across the robustness splits the mean coverage is about 0.78–0.79 against a nominal 0.80.
  - The per-split sd is about 0.03 at n_hold = 48.
  - About 1 in 40 random splits fell below 0.72.
  - No inflation constant is applied: choosing one here would tune to the test.
- **Fold reuse.** Reusing the CV folds for both λ selection and OOF residuals is mildly optimistic. Nested λ re-selection is not quantified in the retained probes.
- **Missing grandparents.** Unmatched parents have no grandparents in the recorded lineage. Their missing inheritance variance lands in Σ_N, while child predictions use full lineages, so those rows contribute a slight double count.
- **Rounding and clipping** are not modelled. The golden data never clips.
- **Related-record lineage coupling (T06 review N3).** A holdout veteran can be the recorded, matched parent of a train row. Its own sparks and recorded parents then legitimately enter that train row's inheritance expectation and covariance (its lineage), while its own stats, skills, deck, train mode and date never enter the fit. This is lineage coupling, not target leakage: on the stored golden split there are 52 train→holdout matched-parent references from 50 train rows to 25 distinct holdout veterans (of 48), and perturbing every non-lineage holdout field leaves λ, β, Σ_N and θ bit-identical (T06 test). The holdout is therefore not fully independent of the train rows' lineage inputs. T15 should keep this in mind when reading holdout coverage on a real roster; no change to the estimator is made.

## 3. Decision B: skill acquisition (Q-124), exposure-aware likelihood

Reference implementation: `src/skills.ts`, `src/golden.ts` (`skillCells`).

**Estimand.** For each train mode m and skill s, θ_{m,s} = P(acquired | the skill was actually hinted or innate). This is the conditional rate, and the only rate 50 §5 multiplies by availability.

**Exposure per training cell.** For a train row i and a candidate skill s (deck hint/event ∪ outfit innate ∪ any recorded-lineage source, minus the outfit's unique skill):

- q_i = 1 if s is a deck hint/event skill or innate. This keeps the existing approximation that these sources are certainly available; it is an unverified game mechanic (Q-130).
- Otherwise q_i = `skillHintProb[s]` from the T05 closed form on the row's recorded lineage.
- Then y_i ~ Bernoulli(q_i·θ), independently across rows.

**Posterior.** The prior is θ ~ Beta(a0, b0), the mode's global prior. The rows reduce as follows:

- **q = 1 rows** are exactly conjugate: a += y, b += 1 − y.
- **q < 1 successes:** the likelihood q·θ ∝ θ, so a += 1. The factor q cancels; this is not "fractional success" counting.
- **q < 1 failures:** each contributes g_i(θ) = 1 − q_iθ. The posterior is Beta(A, B)·Π g_i(θ), which is **not** Beta.
- **q = 0, y = 0:** no opportunity, no information; dropped.
- **q = 0, y = 1:** acquired with no observable source. This is a _contradiction_ under the model. It is excluded from the likelihood, counted per skill and mode, and reported (T06 fit diagnostics). Typical causes are a missing master-data source, OCR error or an unknown mechanic (Q-131).

**Numerical integration (deterministic).**

- Integrate E[θ^k] = ∫θ^k Beta(A, B) G dθ / ∫Beta(A, B) G dθ (k = 1, 2) by tanh-sinh quadrature on θ ∈ (0, 1).
- θ and 1 − θ are computed separately from the abscissa (no cancellation near the boundaries), 1 − qθ is computed as (1 − q) + q(1 − θ), and everything is summed in log space with a max shift.
- Truncation: grow T from 4 until the end abscissae carry < 1e-20 of the mass. Past T = 12, throw `quadrature-nonconvergence`.
- Step: halve h from 0.5 until two successive levels agree to a relative error < 1e-10 in Z, E[θ] and E[θ²], with at least 2 halvings and at most 12, otherwise throw `quadrature-nonconvergence`.
- A non-positive variance or concentration throws `degenerate`. Invalid q/y/prior throws `bad-input`.
- The endpoints θ = 0 and θ = 1 are never evaluated.

**Storage (unchanged `{a, b}` shape).** Store the moment-matched Beta: ν = mean(1 − mean)/var − 1, a = mean·ν, b = (1 − mean)·ν.

- This preserves the first two posterior moments exactly.
- Prediction (50 §5 Bernoulli and the 50 §7 product) uses only the mean, which is exact up to quadrature tolerance.
- The Beta _shape_ is an approximation, used only if a consumer shows credible intervals.
- When every used row has q = 1, the stored (a, b) equals the conjugate update exactly.

**Rare and unseen skills.** A skill with no q > 0 row in a mode has no entry. Prediction falls back to `skillAcquire[mode]['*']`, the global prior. One lineage-only failure moves the mean only slightly: synthetic prior Beta(2,2) with q = 0.2 gives mean 0.4889, against 0.4 for a q = 1 failure (exact Beta(2,3)).

**Global prior per mode** (`'*'`), method of moments on train rows only, never holdout or oracle rates:

- Use skills with exposure E_s = Σq ≥ 1, with Y_s = Σy (contradictions excluded) and r_s = Y_s/E_s, which is unbiased for θ_s.
- m = Σ E_s r_s / Σ E_s.
- S = Σ E_s (r_s − m)² / Σ E_s.
- V = Σ E_s v_s / Σ E_s, with v_s = Σ_i q_i m(1 − q_i m)/E_s².
- τ² = S − V; ν = m(1 − m)/τ² − 1.
- Numerical guards (not tuned; none binds on the golden data):
  - m is clamped to [0.005, 0.995] and ν to [2, 1000];
  - τ² ≤ 0 gives ν = 1000;
  - fewer than 2 usable skills gives Beta(1, 1).
- This is an assumption, not a verified fact: θ across skills is treated as one Beta population per mode.

**Prediction (counts availability once).** For a planned child and skill S:

- 50 §5 Monte Carlo: `hinted` = S in deck hints/events ∪ innate, or S hinted by _this sample's_ `inh` activations. Then `acquired ~ Bernoulli(E[θ_{mode,S}])` only when hinted.
- 50 §7 fast pass: P(acquire S) = P(hinted S) · E[θ], where P(hinted S) = 1 for deck/innate, otherwise the closed-form `skillHintProb`.

### Alternatives considered

- **Literal 50 §4/§5** (naive conjugate on all candidate rows, then × P(hint) again): rejected; it double counts.
- **Adviser option "drop the extra Bernoulli"** (keep the naive rate, treat any potential lineage source as hinted at prediction): rejected. The naive rate is θ times a q _averaged over the training rows_. Transferring it to a candidate whose lineage hint probability differs has no justification. It also ignores the pair's actual hint probability, which is the quantity ranking needs.
- **Conservative** (fit θ on q = 1 rows only; lineage-only skills keep the prior): exact conjugate, but it discards evidence. On the golden train split it drops 1,867 of 11,663 cells and leaves 142 (independent) / 124 (manual) skills, whose only evidence is lineage, at the prior. It is retained as the fallback if the quadrature is ever judged too complex.

### Evidence (`results/q124-skills.json`)

**Synthetic** (labelled; prior Beta(2,2), θ = 0.6, q ~ U(0.1, 0.9)):

- 400 lineage-only rows:
  - exposure-aware mean 0.6208 (sd 0.042);
  - naive mean 0.3168;
  - child with q = 0.5: truth 0.30, exposure-aware 0.3104, naive × q again 0.1584, drop-activation 0.3168.
- Repeated sampling (200 seeded datasets each):
  - exposure-aware bias −0.003 (n = 400) / −0.004 (n = 40), |θ̂ − θ| ≤ z0.9·sd in 81% / 84% of datasets;
  - naive bias about −0.28 to −0.30, 0% within;
  - q = 1 only: exposure-aware = conjugate, bit-identical.
- Brute-force (unreduced likelihood, 2e5-point Simpson) agrees with the reduced quadrature to 1e-8 (test).

**Golden, observable inputs only.** Fit on the stored 192 train rows (11,663 cells; 1,867 lineage-only, mean q 0.263; 0 contradictions). Holdout: 2,847 cells.

| Estimator              | E/O, all    | E/O, lineage-only | z (O − E), all       | Brier, all |
| ---------------------- | ----------- | ----------------- | -------------------- | ---------- |
| exposure-aware         | 940.9 / 990 | 42.0 / 57         | 2.13                 | 0.1930     |
| conservative           | 941.2 / 990 | 42.6 / 57         | 2.11                 | 0.1931     |
| literal (double count) | 860.9 / 990 | 33.3 / 57         | 5.69                 | 0.1956     |
| drop activation        | 956.5 / 990 | 128.9 / 57        | 1.40 (lineage −7.81) | 0.2018     |

E/O = expected / observed acquisitions. ORACLE, labelled: the planted rates × q give 935.2 (all) and 42.9 (lineage-only) expected on the same cells, so the remaining +2σ excess is holdout sampling noise relative to the truth, not estimator bias.

**Golden feasibility** for `golden-cm-1` (fast pass over all 32,667 legal pairs with Σ_N from Decision A, then the seeded MC for the top 12):

|                             | exposure        | conservative    | literal         | drop activation |
| --------------------------- | --------------- | --------------- | --------------- | --------------- |
| planted best pair rank      | #1              | #1              | #1              | #1              |
| best-pair pMeet (fast / MC) | 0.2135 / 0.2115 | 0.1966 / 0.1910 | 0.1935 / 0.1885 | 0.2943 / 0.2900 |
| next best (fast)            | 0.0213          | 0.0196          | 0.0193          | 0.0294          |
| trap pair rank / pMeet      | 24178 / 0       | 24178 / 0       | 24178 / 0       | 24178 / 0       |

The golden best/trap test does **not** discriminate between the estimators: skill X has a single train cell (best1 itself, q = 0.314, acquired), and the trap has no source of X. The decision therefore rests on the synthetic identifiability results and on holdout reliability, not on the golden ranking.

**ORACLE** (planted rates, never an input): exposure-weighted mean |E[θ] − rate| is 0.0519 / 0.0612 (independent / manual) for exposure-aware, against 0.0527 / 0.0617 conservative and 0.0556 / 0.0714 literal.

### Limitations

- q = 1 for deck hint/event skills is an approximation. A deck hint is not guaranteed in game, so θ for deck-hinted skills is a "per deck exposure" rate (Q-130).
- q for lineage sources inherits every unverified constant in `rules.json`. If the true activation is higher than modelled, θ is overestimated for lineage-heavy skills. Refit after any rules change.
- θ is assumed independent of the hint level, the number of hint activations, the deck composition and other skills. Rows are assumed independent.
- The golden data cannot discriminate exposure-aware from conservative (the lineage cells are few and low-q). The advantage of exposure-aware is demonstrated only on synthetic data with known θ.

## 4. Snapshot versioning: `training-v2`

- The `ModelSnapshot.kind` enum is `['training-v1', 'training-v2']` (`packages/schema/src/model-snapshot.ts`, `MODEL_SNAPSHOT_KINDS`). The JSON Schema export is `enum`, and parity between zod and Ajv is tested.
- **`training-v2`** means the Decision A covariance and the Decision B skill posterior, **versioned together**. A snapshot with only one of the two new meanings is not v2.
- **`training-v1` is legacy.** Its meaning is unknown/pre-ADR, because no compliant producer ever existed and existing rows could not be inspected (no live DB access, by design).
  - It is still accepted, stored and returned verbatim by the API. Old rows are never relabelled or migrated.
  - Its numbers must never be reinterpreted as v2.
- **API** (`apps/api/src/routes/model-snapshots.ts`):
  - `Row.kind` is the schema-derived `ModelSnapshotKind`;
  - `?kind=` is validated by `ModelSnapshot.shape.kind` (the enum);
  - filtering and pruning (newest 20) are per kind, so v2 inserts never prune v1 rows, and vice versa;
  - D1 storage and migrations are unchanged (`kind` is plain TEXT).
- **Required T06 acceptance** (not implemented here):
  - `fitTrainingModel` emits only `training-v2`;
  - `predictChild` / `rankPairs` given a `training-v1` snapshot throw a typed refit-required error (e.g. `RefitRequiredError {kind}`) without a fallback interpretation;
  - S07 (T13) should present v1 rows as "legacy, refit required".

## 5. Consequences

- **T06** implements Decisions A and B in `packages/engine/src/` (Jacobi plus flooring in `src/linalg.ts`) and adds the 50 §9 acceptance tests listed in the errata. It reports Card recovery under the Q-122 estimand: the effective contribution β_id[card] + β_type[type(card)] per unit of (1 + lb/4), every planted card and stat within ±15%.
- **T15** calibration must refit the model after any applied rule multiplier. Its skill check (50 §8.3) compares observed skills with the _exposure-aware_ predictions.
- **UI label (T07/T13).** `bindings.md` maps the σ column to `perStat.sigma`. For v2 this column is the training σ _excluding_ inheritance. Changing the label is owned by T07/T13.
- **Unchanged:**
  - golden data, seeds, roster and targets;
  - the ±15% recovery, the 0.72–0.88 band and the best-pair/trap criteria;
  - master data, engine source and D1.
