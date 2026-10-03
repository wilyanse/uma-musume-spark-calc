# T06 — Independent review, round 1

- Reviewer: Opus 5.5 / anthropic, medium, fresh independent session `20261003_131232_3f45e9`.
- Candidate: `8e0a27aae4c8a83001dd8cf0eb9a71561721b953`.
- Report preserved verbatim below. Numerical probe claims are reviewer evidence; parent Gate A is separately documented in `T06-gate-A.md`.

## Verdict: CHANGES_REQUESTED

Candidate 8e0a27aae4c8a83001dd8cf0eb9a71561721b953 is on branch task/T06-training-prediction, merge-base a07f870, with a clean worktree before and after review. The statistical core is correct and well tested: the Σ_N estimator, the exposure-aware skill posterior, availability counted once, separate seeded streams, unrounded clipping, joint pMeet and the full ranking pipeline. All 50 §9 T06 and 70 F08/F09/F11 gates reproduce under Node 22.18. One correctness defect blocks the merge.

## Blocking

- [B1] `packages/engine/src/predict/index.ts:287-291`, `:362`, `:383`. The trainee's own unique skill is treated as never acquired.
  - **Problem:** `skillClosedForm` hard-codes `pHinted = 0` for `pc.uniqueSkillId`, and `simulate` marks it `never`, so the MC acquisition is always 0.
  - **Why it's wrong:** The roster data shows the opposite. All 260 of 260 golden veterans own their outfit's `uniqueSkillId` (01 §3 `level` exists only for unique skills). Fitting correctly drops the unique skill as a candidate, since there's no acquisition decision to learn. Prediction then wrongly turns that into "impossible".
  - **Effect:** A `CmTarget` whose `requiredSkills` contains the trainee's unique skill gives pMeet 0 for every pair, in both the fast pass and the MC, with no error or warning. Ranking then silently degrades to surplus order. Proof is in probe-edges2 U1: `mcPMeet 0, rankTopPMeet 0, rankTopFast 0`. The case is not documented in the changelog or OPEN_QUESTIONS. T13's S05 form can produce such a target.
  - **Required fix:** Handle the trainee's unique skill explicitly. Either:
    - treat it as acquired with certainty (pHinted 1, pAcquire 1, MC always 1) and record the assumption as a new Q-14x; or
    - reject such targets with a typed `ModelInputError` in `normalizeTarget`/`preparePlan`.

  In both cases add a predict/rank test, and leave the fit-side exclusion unchanged.

## Should fix

- [S1] `packages/engine/src/model/prepared.ts:27,66-70`. `prepareModel` accepts schema-valid v2 snapshots whose `residualCov` breaks the v2 contract, despite its docstring "Throws … for anything but valid v2". Probe-edges P1/N1 results:
  - **Negative diagonal (−50):** accepted. The Gaussian variance becomes −50 and sd is NaN, so `sd > 0` fails and the fast pass silently returns pass 1. The MC meanwhile clamps the eigenvalue to 0. The two passes give inconsistent answers with no error.
  - **Asymmetric or non-PSD off-diagonal entries:** accepted. Jacobi silently symmetrises them and `eigenFactor` clamps negative eigenvalues.
  - **`perStat.sigma` vs √diag:** never checked.

  Suggestion: reject these with `RefitRequiredError('malformed')` when:
  - the matrix is not exactly symmetric;
  - any diagonal entry is ≤ 0 or any eigenvalue is < 0 (beyond a tiny tolerance);
  - `sigma` is not √diag.
- [S2] `packages/engine/src/predict/index.ts:180-216`. `normalizeTarget` and `preparePlan` don't validate skill ids against `ctx.skills`, or the plan deck's `lb` (0–4) and duplicate cards.
  - An unknown required skill id silently scores pMeet 0, using the prior θ (P5).
  - A deck slot with `lb: 9` is accepted and inflates the card units (L1).

  Throw `UnknownIdError`/`ModelInputError` instead, as is already done for unknown outfits and cards.
- [S3] Benchmark margin under Node 22.18. My solo run on the dev Mac, with nothing else heavy running, measured:
  - rankPairs: mean 3896.2 ms, min 3673.7 ms, max 4568.5 ms;
  - fit+rank: mean 4080.4 ms, max 4399.6 ms.

  That passes, but the margin is about 430 ms, against the parent's 3433 ms max. Record this variance in the changelog so T13's Web Worker timing isn't assumed to have the parent's headroom.

## Nits

- [N1] `src/index.ts` exports a wide internal surface for T13: linalg, `estimateNonInheritanceCov`, `tanhSinhMoments`, `prepareModel`, `recordedParent`, among others. Consider marking it as an unstable or advanced API in the changelog.
- [N2] `RefitRequiredError` is also used for `malformed` and `unknown-kind`. Callers (S07) should distinguish "corrupt" from "legacy". The reason code is there; document it for T13.
- [N3] P4 diagnostic: 52 holdout rows are matched parents of train rows. Their sparks and parents legitimately feed train-row lineage (recorded lineage, not y). I perturbed holdout stats, skills, train mode, deck and dates together and the model stayed bit-identical, so there is no leakage. Note this coupling in the ADR limitations for T15.

## Checklist

1. **Spec conformance: issues (B1).** Everything else conforms:
   - Eligible rows, the matched/guest/unmatched/matched-missing lineage and Q-140 are coherent.
   - Feature, card and cell vocabulary come from train rows only; the recency clock is the newest train row.
   - CV folds are seeded and order-independent; the OOF residuals use each stat's chosen λ on the same folds.
   - S is uncentred, and C̄ is subtracted with the same weights.
   - Jacobi follows the ADR conventions; ε and σ = √diag are exact.
   - Only `training-v2` is emitted and v1 is rejected.
   - Q-141 states the caller's refit obligation without adding snapshot fields.
   - 50 §1 signature deviations are documented accurately for T13.
2. **Correctness: issues (B1, S1, S2).** Independent checks agreed with the implementation:
   - **Skill posterior vs brute-force integration (2e5 points):** relative error 6e-15 (mixed q), 6e-15 (prior 5/995, 200 failures) and 9e-8 (300 failures at q = 0.999). The q = 0 contradiction and no-opportunity cases return the prior, with contradictions counted.
   - **Clipped Gaussian surplus with a binding cap of 1150:** fast 49.4989 vs brute-force Gaussian 49.4998 vs engine MC 49.4944.
   - Public inputs (plan, target, roster, snapshot) are not mutated.
   - Ranking covers all legal pairs (32,667, matching an independent count). Guests are never candidates. Lock order and pair-key ties are deterministic, there are 100 precise pairs × 2000 draws and 50 results, and progress is reported every 1000 pairs.
3. **Test quality: ok.** The tests assert real behaviour:
   - joint pMeet vs product of marginals on anti-correlated samples;
   - stream independence by changing draw consumption in all three directions;
   - perturbing holdout y and dates leaves λ, β and Σ_N bit-identical;
   - a same-weighted 65 vs 50 fixture.

   The gaps are the B1, S1 and S2 cases. The changelog's numbers match my reruns exactly: card worst 5.05%, coverage80 0.8125, MC coverage 0.8125/0.8208, #1 pMeet 0.218.
4. **Fabrication: ok.** Production has no fixture ids, planted constants or top-12 shortcut. A grep of `src` for golden ids and `skill:restraint` finds only a doc comment. I regenerated the q124 evidence (no `--write`) and it reproduces the documented S3 numbers (`fastSecondPMeet` 0.0209/0.0189/0.0288/0.0192, `mcBestPMeet` 0.2115). No claim of real-game calibration is made.
5. **Security: ok.** Pure engine with no network or DOM. The ULID uses `crypto.getRandomValues`, and the runtime import graph test passes. Input validation gaps are covered in S1/S2.
6. **Free tier: ok.** No API, D1 or Worker changes; the engine runs in the browser.
7. **Scope: ok.** The `EngineContext.cards` edit and the index, package, tsconfig, vitest and bench wiring are all declared. The reference changes are limited to S1–S3/N1. Golden data, apps, master data and schema are unchanged (diff exit 0).
8. **Maintainability: ok, with N1.** Types are strict and the engine typecheck passes. The only bare dependency is zod. No dead code was found.

## Commands run

The Node 22.18.0 install in scratch had been pruned. I re-extracted the checksum-verified tarball into `/Users/willjose/.hermes/cache/scratch/t06-review/`; nothing global was changed.

```
$ git rev-parse HEAD; git status --short; git merge-base main HEAD
8e0a27aae4c8a83001dd8cf0eb9a71561721b953   (clean)   a07f8704448cec9e213a3e9ecb5d7cc974b0ee05
$ shasum -a 256 node-v22.18.0-darwin-arm64.tar.gz
2c12913c…dfc0 (matches SHASUMS256.txt) → v22.18.0
$ (packages/engine) node ../../node_modules/vitest/vitest.mjs run --reporter verbose   [Node 22.18]
[T06] card recovery: worst 5.05% over 22; max |zero card| 2.50
[T06] stored split Gaussian coverage80 0.8125 …; without inheritance 0.6833
[T06] stored split MC p10–p90 coverage: 0.8125, 0.8208
[T06] golden legal pairs evaluated: 32667
[T06] golden #1 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2 pMeet MC 0.218 (fast 0.2135), #2 MC 0.0225; trap in top 50: no
Test Files 15 passed (15)  Tests 215 passed (215)   exit 0
$ node ../../node_modules/vitest/vitest.mjs bench --run --reporter verbose   [Node 22.18, run alone]
[T06 bench] rankPairs legal pairs 32667 …; samples 5, mean 3896.2 ms, min 3673.7 ms, max 4568.5 ms; node v22.18.0 darwin/arm64
[T06 bench] fit+rank legal pairs 32667; samples 5, mean 4080.4 ms, min 3767.8 ms, max 4399.6 ms
Tests 2 passed (2)   exit 0
$ node ../../node_modules/typescript/bin/tsc -p tsconfig.json   → TSC_OK
$ node --test docs/reference/model-semantics/test/*.test.ts   → tests 23, pass 23, fail 0
$ node docs/reference/model-semantics/probes/q124-skills.ts   (no --write) → exit 0; fastSecondPMeet 0.0209, mcBestPMeet 0.2115, fastTrapRank 24178
$ node scratch/t06-review/probe-edges.ts
P1 negative-diag: prep accepted; gaussVar0 -50; rank fast pMeet 0 (target spd 900)
P2 clip surplus: fast 49.4989 / brute 49.4998 / MC 49.4944
P3 skill posteriors vs brute force: rel 6e-15, 6e-15, 9e-8; q=0 cases → prior, contra counted
P4 holdout mode/skills/deck/stats/date perturbation: identicalModel true; coverage 0.8125→0
P5 unknown required skill: pMeet 0, thetaFromPrior true
P6 inputs unmutated: true
$ node scratch/t06-review/probe-edges2.ts
U1 required trainee unique skill: mcPMeet 0, rankTopPMeet 0, rankTopFast 0
N1 negative diag: fast pMeet 1 for all (sd NaN path), MC 1
L1 lb=9 accepted: trainingMeanSpd 1134.41
$ node -e (golden veterans owning their own unique skill)   → 260 / 260
$ git diff --exit-code main...HEAD -- packages/engine/test/golden apps packages/master-data packages/schema → PROTECTED_UNCHANGED
$ git status --short   → (empty)
```

Everything is in `/Users/willjose/.hermes/cache/scratch/t06-review/`:
- probe source: `probe-edges.ts`, `probe-edges2.ts`
- probe output: `probe-edges.out.txt`, `probe-edges2.out.txt`
- test, bench and q124 logs: `engine-run.txt`, `bench.txt`, `q124.stdout.txt`

I did not run a recursive build, a master-data refresh, golden generation or any probe with `--write`.
