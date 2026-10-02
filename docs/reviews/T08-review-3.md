# T08 independent review — round 3

Reviewer session: 20261003_001209_52b2b0. Reviewed commit: 01612d7.

## Verdict: PASS

Reviewed commit 01612d7 on task/T08-golden-dataset (focus diff dae3cc5..01612d7). The worktree was clean before and after the review; my probes in ~/.hermes/cache/scratch/t08r3 are deleted. The existing `scratch/t08` directory was already there and I left it alone.

The B1 retune holds up when I re-derive it independently. One spec issue needs an orchestrator decision before T06 is dispatched (S1 below), but it doesn't block T08.

## Blocking
None.

## Should fix
- [S1] docs/OPEN_QUESTIONS.md:106-109 (Q-123); docs/changelog/T08-golden-dataset.md:643, 652, 660, 814; packages/engine/scripts/golden.ts:1144 — the coverage band now depends on a definition the spec leaves open. Q-123 should not be "Blocking: no" for T06.
  - **What I re-derived.** My own numpy design and solver give exactly sandwich 0.8417, literal 0.7917, +Var[inh] 0.9000, net 0.7292, plug-in 0.7208.
  - **Why it's a spec problem.** 50 §4 builds residualCov from residuals of y = stat − E[inh], so it already contains the inheritance-sampling variance. 50 §5 then samples inheritance on top of MVN(xβ, residualCov), and 50 §7 adds Var[inh]. That double count is a real defect in the spec text, not something T08 caused.
  - **Is T08 feasible under the authoritative acceptance?** Yes. 50 §4 says to report holdout coverage at fit time, and with residualCov as written that gives 0.7917, inside the band. The non-self-referential sandwich interval gives 0.8417, also inside. So T08 is not blocked.
  - **Caveats.**
    - The literal interval is close to self-calibrating, because the holdout sets its own width, so it is weak evidence.
    - If T06 scores coverage through the §5/§7 predictive path, it gets 0.900 and fails.
  - **The retune caused this, and the changelog doesn't say so.**
    - At dae3cc5 the +Var[inh] coverage was 0.829, inside the band.
    - Noise ×0.6 plus 4 events made Var[inh] the larger part of the variance: mean 32–67 against noise variance 29–36.
    - Line 660 blames the over-coverage only on the double count.
    - My oracle check with noise variance + per-row Var[inh] gives 0.783, so a non-double-counted predictive form works.
  - **Required action:**
    1. Orchestrator: resolve Q-123 with an explicit decision or a spec errata before T06. Either residualCov is computed after removing Var[inh], or the §5/§7 predictive doesn't add it again.
    2. Disclose in the changelog that the retune moved +Var[inh] from 0.829 to 0.900.
  - Don't change the specs silently from inside T08.
- [S2] docs/changelog/T08-golden-dataset.md:537-541 — the causal claims go a bit further than the evidence.
  - **What holds up.**
    - The zero-noise expected-stat scan lands exactly on the true multiplier: 1.00 and 1.30, both populations.
    - The generator asserts that its plan expectations equal the recorded-lineage expectations on all 240 eligible rows, and a mismatch throws.
    - The realised holdout correlations reproduce: gut activation 0.370 / 0.376, sta 0.568 on the 50 §8 subset.
  - **What doesn't.**
    - "Independent in expectation" isn't strictly true. I ran a Monte Carlo of 300 fresh noise and activation redraws on the current lineage and design. The activation-only argmin carries a small systematic bias: +0.005 (se 0.0005–0.0008) on the base roster, +0.006 on ×1.3.
    - The realised correlations are diagnostics consistent with a finite-sample effect, not proof of the mechanism.
  - **What the Monte Carlo does support.** dae3cc5's 1.41 was about +2.9σ under its own design: 2 events and noise ×1.0 give argmin mean 1.31, sd 0.035, p95 1.37.
  - **Suggested fix:** reword to "consistent with a finite-sample tail (Monte Carlo sd 0.035 at round 1, 0.017 now) plus a small ≈+0.005 systematic MAE-criterion bias".

## Nits
- [N1] docs/changelog/T08-golden-dataset.md:556-560 — the retune was picked partly by looking at stored-split argmins: noise ×1.0 and ×0.8 were rejected because they gave 1.37 / 1.38. That is a mild selection effect, worth disclosing as such.
  - My Monte Carlo shows the chosen design is in band regardless of the realisation, so this is not cherry-picking in effect.
    - ×1.3 argmin mean 1.305, sd 0.017–0.019, p5 1.27, p95 1.34, 100% in band, across all three populations.
    - Base: mean 1.005.
  - The stored 1.34 sits about +2σ high within that spread.
  - Ablation: 2 events at noise ×0.6 gives sd 0.025, 4 events gives 0.017, so both parts of the retune contribute.
- [N2] packages/engine/test/golden/planted.test.ts:251 — the >10× best/runner-up assertion now has an 8% margin (10.76×). 50 §9 only requires a unique #1. I confirmed it independently:
  - best pair is #1 with pMeet 0.2933; runner-up 0.0273;
  - 39 pairs have p > 0, and all contain best1;
  - the trap is at 0-based rank 25724 with the unique maximum of 18 blue stars (next is 16), out of 32667 pairs.
- [N3] packages/engine/test/golden/calibration.test.ts:101 — the base-roster tolerance (≤0.06) sits right at the observed maximum over the 40 alternative splits (1.06). That's fine, but any regenerated realisation may need slack.

## Checklist
1. Spec conformance: ok.
   - 240 eligible rows and the 48/192 split re-derive from the seed with my own mulberry32 and Fisher–Yates.
   - 50 §8 population: 192/39 and 157/39. Adding the 17 low-confidence matched rows (56 holdout) still gives 1.02 / 1.32.
   - 70 §3 F12 holds with margin.
   - Coverage feasibility under the literal §4 reading: yes (see S1 for the T06 caveat).
2. Correctness: ok.
   - E[inh] is affine in m to 5.7e-14, so the two-solve shortcut is exact. I ran full refits for every m on a 0.01 grid over [0.5, 2] and got the same argmins, the same MAEs, and the same [1, 2] argmins.
   - No leakage. Fit inputs are roster rows plus `syntheticInheritance` only; `truth.latent` is read only by root-cause.ts and diagnostics. The recency clock uses train rows only.
   - Lineage, decks and noise are identical across the two rosters, and the latent parts reconstruct the stats with 0 mismatches.
3. Test quality: ok.
   - `vitest test/golden`: 61/61.
   - The round-2 diagnostics output reproduces exactly.
   - The S3 truth match is labelled as self-consistency.
4. Fabrication: ok.
   - S1 λ table: every line matches my independent refit, including λ 0.1/10 at 13.78% (Tazuna pow 40→45.51, zero-card 6.04).
   - CALIBRATION block: argmins and MAEs match to two decimals.
   - 40 alternative splits: claim reproduces. My own 200 random splits give ×1.3 1.28–1.36 and 50 §8 1.27–1.36, all in [1.23, 1.37]; base 0.99–1.05.
5. Security: ok.
6. Free tier: n/a.
7. Scope: ok. `src`, specs, schema and web config are untouched; Q-123 is append-only.
8. Maintainability: ok.
   - `scripts/golden-diagnostic.ts` imports only `../src/index.ts` and `@uma/schema`, and no file in `scripts/` imports `test/`.
   - N1 is fixed: weights and folds are hoisted, and the CV choice is unchanged (0.1/0.1 ×4, 0.1/1).
   - N2 and N3 are fixed: Q-122 zero-card values match my refit (2.50 / 2.32–2.69 / 5.09 / 6.04).

## Commands run
```
$ git rev-parse HEAD; git branch --show-current; git status --short
01612d79ab52a8e9db8e3674a93dc98b7e5725b6 / task/T08-golden-dataset / (clean)
$ node scratch/dump.ts   # roster + engine E[inh] at m=0,1,1.3 via loadGoldenContext(syntheticInheritance only)
$ python3 a.py           # independent numpy design/ridge
eligible 240 True | split 48 192 True True | affine max dev 5.7e-14 | lineage same True
$ python3 b.py           # full refits, 0.01 grid [0.5,2] and [1,2]
base 192/48 1.04 (31.99) | 192/39 1.05 | 157/39 1.03
x13  192/48 1.34 (36.31; @1.3 37.85 @1.4 37.87) | 192/39 1.34 | 157/39 1.33 ; [1,2] same
$ python3 c.py           # zero-noise expected-stat scan (diagnosis only)
clean base 1.0 / 1.0 ; clean x13 1.3 / 1.3 ; latent reconstruct mismatches 0 0
$ python3 d.py           # 300 MC redraws of noise/activation on current design
x13 mean 1.3052 sd 0.017 p5 1.28 p95 1.33 inband 1.000 (all pops) ; base 1.0047
act-only bias base +0.0046 se 0.0005 ; noise-only 0.9990
$ python3 f.py           # 2-event design counterfactual
2ev noise x1.0: x13 mean 1.3095 sd 0.035 p95 1.37 ; 2ev noise x0.6: sd 0.025
$ python3 e.py           # 200 random 80/20 splits
x 1.28–1.36 inband 1.0 ; x8 1.27–1.36 ; base 0.99–1.05
$ python3 g.py           # λ table
0.1/0.1 5.05% z2.50 | 0.1/10 13.78% (tazuna.pow 40->45.51) z6.04 | 1/10 8.98% | 10/0.1 16.96% fails 2 | 100/10 58.35% fails 22
$ python3 h.py           # coverage variants
sandwich 0.8417 literal 0.7917 plusInh 0.9000 net 0.7292 plugin 0.7208 ; oracle noise+rowVar[inh] 0.7833
$ python3 i.py           # include low-conf matched rows: base 1.02 x13 1.32
$ node scratch/bt.ts     # planted.test pMeet code copied verbatim
pairs 32667 best true 0.2933/0.0273 ratio 10.7588 trapRank 25724 blue 18 16
$ cd packages/engine && npx vitest run test/golden
Test Files 3 passed (3)  Tests 61 passed (61)
$ node packages/engine/test/golden/diagnostics.ts --splits   # matches changelog incl. 40/40 bands
$ node packages/engine/test/golden/root-cause.ts [--baseline] [--calibration]
final x1.3 ABLATION clean 1.3 noise 1.32 act 1.32 combined 1.34 ; dae3cc5 x1.3 1.3/1.36/1.34/1.41
$ shasum -a 256 ...  # 7 hashes match changelog (6a02f360…, 8982ab4a…, 3e3f8644…, 1ccf0d5a…)
$ git diff --check dae3cc5..01612d7 && echo ok   → ok
$ rm -rf ~/.hermes/cache/scratch/t08r3; git status --short | wc -l   → 0
```
I did not re-run the frozen install, the recursive lint/typecheck/test, or the generator. The parent's gate evidence for those was taken as given.

Reviewed commit: 01612d7
