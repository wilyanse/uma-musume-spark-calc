# T08 independent review — round 1

Reviewer session: 20261002_071128_d816b6. Reviewed commit: 84c64be.

## Verdict: CHANGES_REQUESTED

## Blocking

- [B1] packages/engine/test/golden/planted.test.ts:345-379 and packages/engine/scripts/golden.ts:180-193, 640-641, 660 — The test that claims card effects are "identifiable" relies on data T06 will never have:
  - It subtracts the true sampled inheritance, `truth.latent[id].inheritance` (line 367), instead of the expectation computed from the recorded lineage.
  - It fits on all 260 rows (line 354), including the 48 holdout rows and the 20 low-confidence rows.
  - It uses unweighted OLS with no type-pool features.

  50 §4 requires the 192-row train split, recency weights `0.5^(age/60)`, card-id plus card-type features, and ridge with λ chosen from {0.1, 1, 10, 100} × {0.1, 1, 10}. I refit this read-only, with no latent data: E[inh] came from `planInheritance` on the recorded lineages, using `loadGoldenContext`. Results:
  - Plain OLS on the train split: 2 of 60 effects are outside ±15% (Tazuna spd 20→16.4, wit 20→16.9; worst error 17.8%).
  - Adding the mandated recency weights: 7 outside, worst 33%.
  - Ridge at the smallest grid λ (0.1/0.1) with type pooling: 7 outside, worst 35%. λ=1 gives 15 outside; larger λ is worse.

  The dates span 360 days, so the 60-day half-life leaves an effective sample of about 90 of the 192 train rows. The smallest planted effects are 20 per unit, and the only friend card is Tazuna. As generated, the 50 §9 T06 acceptance (±15%) is very likely unsatisfiable with the 50 §4 estimator.

  Required fix:
  - Retune the dataset so that a 50 §4-conformant fit recovers all 12 planted effects within ±15% with margin. Options: compress the dateAcquired span to roughly 60–90 days, raise the smallest per-unit effects (≥ 30), cut the inheritance or noise variance, and give the friend/group types more than one card each so the type-pool features are not collinear with a single card id.
  - Replace or extend the OLS test so it uses only data T06 has: `truth.holdout.trainIds`, inheritance expectation from the recorded lineage (no `truth.latent`), recency weights, type-pool features, and the smallest λ in the grid.

## Should fix

- [S1] packages/engine/scripts/golden.ts:25-29, 53, 451-481 — `loadGoldenContext` is the documented consumer entry point for T06/T15, but its module imports `node:crypto`, `node:fs`, `prettier` and `published-bundle.ts` (fs) at the top level. The T06/T15 Node tests can live with that. Any web-worker or browser consumer (a T13 fixture-mode planner) cannot. Move `loadGoldenContext` and the truth types into a side-effect-free module, for example `scripts/golden-context.ts`, that imports only `../src/index.ts`.
- [S2] packages/engine/scripts/golden.ts:425, 854 — The meaning of "hinted" differs between generator and estimator:
  - The generator hints a skill only when a spark actually activated (latent `inheritanceHints`).
  - 50 §4 tells T06 a skill is hinted when it appears in any parent/grandparent white or green spark. Across the 240 eligible rows that gives 13,410 hinted skills, versus 12,737 under the truth definition.

  T06's per-mode Beta estimates will therefore not equal `truth.skills.rates` for spark-only hints. Document the estimand T06 should expect in truth.json and the changelog, so nobody writes a T06 test that compares the Beta means against `rates`.
- [S3] Holdout size for the 0.72–0.88 coverage band — 48 holdout rows, with only 3 manual rows in three of the four scenarios. My crude interval check gave coverage of 0.83–0.87, close to the 0.88 upper bound, and the sampling standard deviation at n=48 is about 0.06 per stat. Either add a test that checks coverage with a 50 §4-style fit on the stored split, or record the expected coverage and its margin in truth.json so T06 is not left with a coin-flip acceptance.
- [S4] apps/web/fixtures — The copies are correct for `dataUrl` (`roster`, `cm-targets`). However, `apps/web/fixtures/` sits outside Vite's `publicDir`, and vite.config.ts doesn't serve it, so fixture mode would get 404 today. This was not introduced by T08, but the changelog should list it as a follow-up for T13 or T02. The changelog should also note that the web build uses the published rules (blueStatGain 0, turns `[]`), so fixture-mode rankings will not reproduce the golden best pair unless they go through `loadGoldenContext`.

## Nits

- [N1] packages/engine/scripts/golden.ts:120-173 — `meta`, `sparks`, `deckModel`, `roster`, `golden`, `holdout` and `calibration` are typed `Record<string, unknown>`, so a test-side `Truth` view (test/golden/load.ts:26) has to restate them by hand. Export one typed interface from the generator.
- [N2] Observed stats range from 361 to 1103 against a statCap of 2000, so clipping never applies to the golden data. That is harmless for identifiability, but say in truth.json that clipping is not exercised.
- [N3] apps/web/fixtures/golden-truth.json (241 KB) is not consumed by the web client. Consider not copying it, or document its purpose.

## Checklist

1. Spec conformance: issues (B1). Verified correct:
   - 260 veterans, schema-valid.
   - Exactly 156/104 modes; independent intercept −30/−20/−30/−15/−25, total −120.
   - 12 planted SSR cards with perUnit = atLb4/2 on the `(1+lb/4)` feature.
   - Noise is MVN with corr·sd·sd covariance, checked positive-definite.
   - Per-mode skill rates, X manual 0.75 / independent 0.40.
   - Target is a valid ULID with name `golden-cm-1`, Medium/Turf/Pace, spd 1100, sta 800, X required.
   - Best pair is unique #1 (pMeet 0.11 vs 0.003); trap has the unique 18 blue stars, no X source, outside the top 10.
   - Skill X has no other source: one white spark, no card, outfit or race hint.
2. Correctness: ok for the generator.
   - Matched-parent lineages equal `legacyFromVeteran` of the matched record. My E[inh] from recorded lineages gave consistent fits.
   - Guest grandparents are null on both the generator and the consumer side.
   - Calibration variant: a holdout-MAE grid on the ×1.3 roster is minimised at m=1.3 (sum 38.7, vs 40.6 at 1.2 and 39.0 at 1.4), so T15's [1.2, 1.4] looks feasible.
3. Test quality: issues (B1, the leaked OLS test). The other tests check independently (Gaussian pMeet over 32,667 pairs, the lineage z-test, rates and counts). The changelog's verification output matches my runs.
4. Fabrication: ok.
   - Master IDs are real.
   - Synthetic blueStatGain 10/20/30 and turns [31, 55] are labelled SYNTHETIC with `verified:false` in truth.json and Q-120; the published bundle is untouched.
   - Level caps and guest trainer names are labelled synthetic.
   - No fixture answers are hard-coded in engine `src`.
5. Security: ok. No secrets.
6. Free tier: n/a. Total size is about 4.4 MB across the repo and fixtures.
7. Scope: ok. The package script, pinned `prettier` 3.9.9 (same as the root) with its 4-line lockfile entry, and Q-120/Q-121 are all declared cross-task edits. Engine `src` is unchanged.
8. Maintainability: S1, N1.

## Commands run

```
$ git rev-parse --short HEAD; git status --short; git merge-base main HEAD
84c64be
(clean)
4220190067f7ee74ccea92c790abe8b11947e186

$ node probe2.ts   # scratch: generateGolden ×2 in-process vs disk vs web copies
ad3cb227…0edb roster.calibration-x1.3.json run2 true disk true
8ca6fa70…44a0 roster.json run2 true disk true
3e3f8644…bcf  targets.json run2 true disk true
c9837390…174d truth.json run2 true disk true
web/roster.json, web/cm-targets.json, web/golden-truth.json equal their sources: true
stat range 361 1103
hinted per 50§4 spec def (parent sparks) total 13410  truth def 12737

$ python3 (independent fingerprint, sha256 of canonical JSON per 01 §5)
fingerprints match (python independent): 260 / 260
modes Counter({'independent': 156, 'manual': 104})
dates 2025-10-02 2026-09-25
train n 192 recency ESS 90.2

$ node probe.ts   # scratch: refit using T06-available data only (E[inh] from recorded lineage)
train 192 holdout 48
OLS cell+growth+id, no latent, train only: worst 0.178 nFail 2 [tazuna.spd 20->16.4, tazuna.wit 20->16.9] cover80 0.833
OLS + recency weights: worst 0.331 nFail 7
ridge+type λid=0.1 λbase=0.1 recency: worst 0.349 nFail 7 cover80 0.846
ridge+type λid=1 λbase=1 recency: worst 0.457 nFail 15
ridge+type λid=10 λbase=1: worst 0.83 nFail 22
calibration roster grid (holdout MAE per stat): m=1.2 [9.38,7.31,9.46,7.98,7.02]  m=1.3 [8.99,6.25,9.37,7.6,6.46]  m=1.4 [9.01,5.93,9.54,7.89,6.61]

$ cd packages/engine && npx vitest run test/golden
Test Files  2 passed (2)
     Tests  34 passed (34)

$ npx prettier --check packages/engine/scripts/golden.ts packages/engine/test/golden apps/web/fixtures packages/engine/package.json
All matched files use Prettier code style!

$ git diff --check 4220190 HEAD && echo diffcheck-ok
diffcheck-ok

$ rm -rf ~/.hermes/cache/scratch/t08probe; git status --short | wc -l
0
```

Reviewed commit: 84c64be (task/T08-golden-dataset, base 4220190)
