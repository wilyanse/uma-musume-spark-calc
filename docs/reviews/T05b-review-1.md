# T05b — Independent implementation review, round 1

- Reviewed candidate: `5d21673a5c5c6ce3229f102401666c4375f6a31e`.
- Reviewer session: `20261003_040858_7fa6a0`, independent of the implementer.
- Started on Opus 5.5 medium; interrupted by `agent_close`. Opus resume could not find credentials. Completed on the approved GPT-6.1 Sol / openai-codex medium fallback.
- The report below is the reviewer’s verdict and evidence. Parent Gate A was separately run before dispatch. No merge or question-status transition is implied by this report.

## Verdict: PASS

Candidate: 5d21673a5c5c6ce3229f102401666c4375f6a31e
Branch: task/T05b-model-semantics
Implementation base: 432566551498f3a63eb57f1a5b1008e41b731f2d

Review continuation: GPT-6.1 Sol / openai-codex, approved medium fallback after the Opus resume failed. Prior Opus/worker evidence and Parent Gate A were treated as inherited evidence, not as my verification. The fallback independently reran the probes, recursive checks, focused compatibility/calibration tests, and additional numerical challenges.

No tracked files changed. Q-123/Q-124 remain proposed resolutions; this review does not transition them or dispatch T06.

## Blocking

None.

## Should fix

- [S1] docs/reference/model-semantics/test/covariance.test.ts:175–179 — The test named “the training stream is independent of inheritance” only compares two training draws with the same seed. It establishes repeatability, not stream isolation. Add a test that changes inheritance draw consumption while keeping training draws unchanged, and vice versa. The retained probe implementations visibly use separate streams, so this is a test-quality gap, not an observed covariance defect.

- [S2] docs/reference/model-semantics/test/skills.test.ts:125–128 — The “recovers a SYNTHETIC Beta(3,7) population” test actually generates an approximately uniform spread through a modular sequence. Its assertions validly check recovery of that sequence’s empirical moments, but the distribution claim is inaccurate. Rename the test/comment or generate a genuine seeded Beta population.

- [S3] docs/reference/model-semantics/probes/q124-skills.ts:373,414 — The ranking probe introduces a −0.5 continuity correction and rounds sampled stats, whereas 50 §5 specifies clipping train + inheritance without rounding. Align the reference calculation with the specified semantics, or explicitly label the rounding as a golden-observation approximation. My retained unrounded challenge preserved best rank #1, trap rank 24178/pMeet 0, and best MC pMeet 0.2115, so this discrepancy does not overturn the demonstrated feasibility.

## Nits

- [N1] docs/reference/model-semantics/src/skills.ts:167–168 — For θ = logistic(π sinh t), dθ/dt is π cosh(t) θ(1−θ), not (π/2) cosh(t) θ(1−θ). The missing constant factor cancels from normalized moments and successive-level convergence comparisons, so posterior estimates are unaffected. Correct the Jacobian expression/comment to avoid carrying an inaccurate absolute-integral formula into T06.

## Checklist 1–8

1. Spec conformance: PASS.

   The diff stays within T05b’s declared ownership. ADR-0002 and explicit errata define both new meanings together under training-v2; thresholds and committed golden/master data are unchanged.

   Exact T05b acceptance is supported:
   - Observable OOF training residuals, same-weighted inheritance subtraction and deterministic PSD handling are specified and executable.
   - Stored-split Gaussian coverage is 0.8292; five MC seeds give 0.8292–0.8417.
   - Card recovery’s worst relative error is 4.65%, with zero ±15% failures.
   - Exposure-aware skill likelihood includes sparse/prior-only behavior and contradictions.
   - Legacy/v2 schema, export, API round trips and kind isolation pass.
   - Recursive lint/typecheck/tests and retained evidence checks pass.
   - No production T06/T15, migration, capture, golden or master-data changes.

   T06’s producer/version guards, full top-100 precise pass and production benchmark remain future acceptance—not code missing from this task.

2. Correctness: PASS, with S3/N1.

   Q-123 uses one train-only recency clock and the CV fold assignment. OOF refits use the corresponding full-train weights; S is uncentred, and C̄ uses identical weights. Symmetrization, eigen ordering/sign conventions, flooring, zero-trace handling, typed non-convergence and sigma = √diag are implementable and exercised.

   I found no latent inheritance outcomes or planted regression/noise/skill parameters entering fitted quantities. Golden consumers do use the documented synthetic rules/turns to reconstruct the fixture context; that is distinct from using oracle outcomes.

   Q-124 correctly separates availability q from conditional acquisition θ. Success/failure likelihood reduction, numerical integration, moment matching, fallback and contradiction exclusion are coherent. An independent analytic one-failure comparison across 35 boundary/prior cases agreed within approximately 4.1e-14.

3. Test quality: PASS, with S1/S2.

   Both probes independently reproduced the committed result objects exactly without --write. The synthetic recovery, unreduced-likelihood integration check, heteroskedastic weighting, bias retention and flooring tests provide meaningful evidence beyond frozen JSON.

   Calibration feasibility remains supported by the unchanged 12-test suite. An additional direct scan reselected CV penalties and refitted OOF covariance at each examined multiplier: the base roster’s local minimum was 1.04, and the ×1.3 roster’s was 1.34, inside the required calibration band. This was a feasibility challenge, not implementation of T15 or a claim of a full production calibration result.

4. Fabrication check: PASS.

   Synthetic parameters and oracle comparisons are labelled. Real-game uncertainty remains explicit in Q-130/Q-131 and the ADR’s limitations.

   The golden ranking does not distinguish the skill estimators: all alternatives rank the planted pair first. The decision is instead supported by the synthetic recovery and reliability comparisons. The holdout excess also exists under planted rates: my oracle check found expected 935.2 versus observed 990 overall, and 42.9 versus 57 for lineage-only cells. That supports sampling variation as an explanation, but does not establish real-game calibration.

   “Untouched holdout” is valid for these fitting operations. It does not make the previously designed/retuned golden dataset an independent real-world validation set. Alternative splits are also diagnostics on the same dataset, not new independent datasets.

5. Security: PASS.

   Snapshot routes remain behind the existing Access middleware. Body/query validation and parameterized SQL are unchanged except for accepting the additional kind. No authentication bypass, credentials, secrets or new network behavior were introduced.

6. Free-tier constraints: PASS.

   GET remains one D1 statement; POST remains a two-statement batch. Pruning remains bounded per kind, now permitting up to 20 snapshots of each kind. Statistical fitting stays outside the Worker; this change adds no paid service or server-side numerical workload.

7. Scope: PASS.

   Reviewed main...HEAD against base 4325665. Only declared paths changed. Existing legacy records are not migrated or relabelled. No hidden production training/prediction implementation or master/golden mutation was found.

8. Maintainability: PASS, with the findings above.

   Strict typechecking and lint pass; no dependencies were added. The reference-code boundary and T06 handoff are explicit. The main statistical limitations—fold reuse, population-average parameter uncertainty, missing lineage, unverified availability/rules and empirical-Bayes assumptions—remain visible rather than being hidden by tuning.

## Commands run

Commands below ran from the task worktree unless an absolute scratch path is shown. Output is trimmed.

    $ git rev-parse HEAD
    5d21673a5c5c6ce3229f102401666c4375f6a31e

    $ git merge-base main HEAD
    432566551498f3a63eb57f1a5b1008e41b731f2d

    $ git diff --stat main...HEAD
    26 files changed, 3590 insertions(+), 20 deletions(-)

    $ pnpm -r lint
    exit 0

    $ pnpm -r typecheck
    exit 0

    $ pnpm -r test
    packages/schema:      149 passed
    packages/master-data: 82 passed
    apps/web:             5 passed
    apps/api:             111 passed
    packages/engine:      135 passed
    exit 0

    $ ./node_modules/.bin/tsc -p docs/reference/model-semantics/tsconfig.json
    exit 0

    $ ./node_modules/.bin/eslint docs/reference/model-semantics
    exit 0

    $ node --test 'docs/reference/model-semantics/test/*.test.ts'
    tests 22
    pass 22
    fail 0
    skipped 0

    $ pnpm --filter @uma/engine exec vitest run test/golden/calibration.test.ts
    Test Files 1 passed
    Tests 12 passed

    $ pnpm --filter @uma/schema exec vitest run test/json-schema.test.ts test/master.test.ts
    Test Files 2 passed
    Tests 60 passed

    $ pnpm --filter api exec vitest run test/other-endpoints.test.ts
    Test Files 1 passed
    Tests 15 passed

An initial @uma/api filter matched no project; it was corrected to api and actually executed as shown above.

    $ node docs/reference/model-semantics/probes/q123-covariance.ts --splits 40
    exit 0
    stored result exactly matches committed JSON: True
    robustness result exactly matches committed JSON: True
    Gaussian coverage: 0.8292
    MC coverage: [0.8375, 0.8417, 0.8417, 0.8292, 0.8375]
    recovery: worstRelErr 0.0465, failsAt15pct 0

    $ node docs/reference/model-semantics/probes/q124-skills.ts
    exit 0
    synthetic result exactly matches committed JSON: True
    golden result exactly matches committed JSON: True
    exposure: fastBestRank 1, mcTop12BestRank 1
    fastTrapRank 24178, fastTrapPMeet 0
    fastBestPMeet 0.2135, mcBestPMeet 0.2115

Additional challenge sources and outputs are retained under:
    /Users/willjose/.hermes/cache/scratch/t05b-review/

    $ node /Users/willjose/.hermes/cache/scratch/t05b-review/numeric-edges.mts
    cases: 35
    worstMeanAbsoluteError: 3.4083846855992306e-14
    worstVarianceAbsoluteError: 4.013456234019941e-14

    $ node /Users/willjose/.hermes/cache/scratch/t05b-review/q124-unrounded.mts
    fastBestRank 1
    fastTrapRank 24178
    fastTrapPMeet 0
    mcTop12BestRank 1
    mcBestPMeet 0.2115

    $ node /Users/willjose/.hermes/cache/scratch/t05b-review/calibration-cv.mts
    roster.json: best m 1.04, MAE 32.229386997707785
    roster.calibration-x1.3.json: best m 1.34, MAE 36.5471073889212

    $ git diff --check main...HEAD
    exit 0

    $ shasum -a 256 docs/reference/model-semantics/results/*.json
    3eaaf67d23f239962893c31b72a4822aac8dbcbdf57a71c6f94922631503d08b  q123-covariance.json
    86ddbaf0896374505fdf57e3f654238650c7679e1f7d23ed7645a40443785e95  q124-skills.json

    $ git status --short
    (no output; clean)
