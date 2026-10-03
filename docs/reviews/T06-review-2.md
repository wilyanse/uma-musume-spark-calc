## Verdict
PASS

Candidate aa4a47d1ccc5a167818d56ec76c37748b7f3b2ff is HEAD of task/T06-training-prediction, and the worktree was clean at the start and end. The only commit in 8e0a27a..HEAD is aa4a47d. It resolves B1, S1, S2 and N3 correctly, and documents S3, N1 and N2 accurately. I found no regression in the paths around the fixes. One should-fix and some nits remain, none blocking.

## Blocking
None.

## Should fix
- [S1-r2] `packages/engine/src/predict/index.ts:516-518` and `:535-537` (`scoreSamples`, reached through stable `scoreTarget` at `:657-658`).
  - Problem: B1/S2 validation covers `predictChild`, `rankPairs*` and the advanced helpers, but not re-scoring kept samples against a new target. Take a target that requires the trainee's own unique skill (or an unknown id), scored against `predictChild(..., {keepSamples: true})`. It throws `ScoreRequiresSamplesError: required skill … was not simulated`, not `own-unique-skill` / `UnknownIdError`. Probe output: `"B1 scoreTarget own (kept samples)": {"err":"ScoreRequiresSamplesError:", "msg":"required skill skill:where-there-s-a-will-there-s-a-way was not simulated"}`.
  - Impact: nothing fails silently, since the error is typed. But it is misleading for T13: the caller did keep samples, and the error says to keep samples. This is the "re-score after a target edit" path.
  - Suggestion: record the trainee's `uniqueSkillId` (or the outfit id) on `ChildPrediction`/`PredictionSamples` and run the same own-unique / unknown checks in `scoreTarget`. Alternatively, state this mapping in Q-142 or the N1/N2 notes for T13. This can go to follow-ups.

## Nits
- [N1-r2] `packages/engine/src/model/prepared.ts:58-71`, S1 tolerance numeric limits.
  - (a) Overflow. If ‖Σ‖_F overflows to Infinity, `tol` becomes Infinity, and Jacobi also stops at once (its own tol is infinite). A schema-valid, grossly indefinite matrix (diag 1e150, off-diagonal 1e200) is then accepted. Probe: `hugeOverflowIndefinite: lamMin 1e+150, accepted`. Fix: reject when `!Number.isFinite(fro)`.
  - (b) Absolute floor. Because of `max(1, ‖Σ‖_F)`, the tolerance becomes an absolute 1e-9 for very small matrices. Probe: `tinyIndefinite`, all entries ~1e-12, λ_min = −4.9e-11 (about −24% of λ_max), accepted. This matches Jacobi's own convention, and a real fit has λ ≥ ε ≥ 1e-6, so it does not matter in practice.
  - Neither case can come from `fitTrainingModel`. Optional hardening.
- [N2-r2] `predict/index.ts:302-306`: for `lb: "4"`, the message says `got 4`, which hides that it was a string. Using `JSON.stringify(lb)` would be clearer.
- [N3-r2] Changelog red/green count: the red run is "17 of 24" and the green run is "25/25". I confirmed the red log says `Tests 17 failed | 7 passed (24)`. One test was evidently added after the red run; say which one.
- [N4-r2] Stale changelog statements, for documentation cleanup:
  - `docs/changelog/T06-training-prediction.md:318`: "The runtime is Node v25.9.0 … no Node 22 install is present on this Mac."
  - `:477`: "The benchmark ran under Node 25.9, not Node 22 (none is installed)." This contradicts Gate A, review 1, the round-1 section (`:393-395`, `:427`) and this run.
  - `:175` and `:194` (Node 25.9 only, 215 tests) are historical sections; label them "original submission".
  - `:3`: the Status line should be updated after this verdict.

Independent resolution of each item:

B1 (resolved)
- `validateSkillRequest` (`:326-335`) runs in `predictPlanned` for both `PredictOptions.skills` and target skills (`:573-574`). It also runs in `rankPairsDetailed` (`rank/index.ts:122`), before roster, lock and pair enumeration.
- The empty-roster case, the locked trainee-character veteran with no legal pair, and the ordinary lock are all tested (`validation.test.ts`).
- `skillClosedForm` (`:356`) throws, so `gaussianScore` does too. `simulate` (`:424-426`) throws.
- Default prediction does not reject itself: the candidate set filters the unique skill (`:580`), and `sure.delete` runs at `:269`. Probe: `ownInDefaultSkills false`, 60 skills, and default rank returns 2.
- Another outfit's unique skill (`skill:all-charged-it-s-go-time`) is accepted as required, optional and explicit (probe, and tested). Rejection is by identity, not by rarity.
- The fit-side exclusion is unchanged: `fit.ts`/`skills.ts` are not in the diff.
- The error is actionable: code `own-unique-skill`, and the message names the skill and outfit and gives the reason plus Q-142.
- Q-142 explicitly declines to assert possession or impossibility, cites Q-120 synthetic data, and tells T13 what to do.

S1 (resolved)
- The checks are: exact symmetry, diagonal > 0, σ within 4ε relative of √diag, and λ_min ≥ −1e-9·max(1, ‖Σ‖_F).
- The 1e-9 is justified: Jacobi's off(A) stop is 1e-12·max(1, ‖A‖_F), the Weyl bound gives the eigenvalue error, so 1e-9 leaves 1000× headroom.
- Accepted as valid: the fitted matrix, its JSON round trip (predictions identical), ×1e6 and ×1e-6 rescalings with consistent σ, and the floored rank-1 and all-zero inputs.
- Rejected: −50 diagonal, zero diagonal, |ρ| = 2, ρ = 1 + 1e-6, and σ off by 1e-6.
- The Gaussian and MC passes can no longer diverge silently on a contract-valid input, apart from the N1-r2 pathologies.
- There is exactly one `jacobiEigen` per `prepareModel` (`prepared.ts:68`, reused through `factorFromEigen`), and `rankPairsDetailed` calls `prepareModel` once (`rank/index.ts:117`). `prepareModel` costs ≈0.37 ms per call.

S2 (resolved)
- Unknown skills raise `UnknownIdError` in predict (`PredictOptions.skills` and target) and in rank, including an empty roster and a lock with no legal pair.
- Deck checks run in `preparePlan`, before features, and are shared by predict and rank:
  - `unknown-card`;
  - `deck-slot` for lb outside the integers 0..4 (9, −1, 2.5, NaN, "4");
  - `duplicate-card`.
- The lb rule matches `@uma/schema` `DeckSlot.lb` (int 0..4) and 01 §3. The duplicate check is correctly labelled a planner guard, not a game rule. All golden decks are distinct (probe: `true`).
- Validation order:
  - rank: model → deck → target normalisation → skill ids → topK/topN/samples → roster/lock;
  - predict: model → deck → pair legality → samples → skills → target.
- Valid empty-roster rank still returns `evaluatedPairs 0`.

S3 (resolved)
- The bench, package and vitest config are unchanged in the diff. The 5000 ms budget, 1 warmup + 5 iterations, all 32667 legal pairs, and top-100 × 2000 → top-50 are all as before.
- My solo Node 22.18 run: rankPairs mean 3745.5 / max 3786.4 ms; fit+rank mean 3928.2 / max 4056.9 ms. Both pass.
- Browser timing is still unverified, and the changelog says so.

N1/N2 (resolved)
- The stable vs advanced/internal split matches `src/index.ts`. `preparePlan`/`simulate`/`validateSkillRequest` are not exported from the index, as stated.
- The `RefitRequiredError.reason` union (`errors.ts:11`) matches the four documented branches. The S1 checks report `malformed`, kept distinct from `legacy-kind`.

N3 (confirmed independently)
- The stored split has 48 holdout and 192 train rows. There are 52 train→holdout matched-parent references, from 50 train rows, to 25 distinct holdout veterans. The worker's correction is right.
- The extended test changes holdout stats, dates, mode, skills and deck while keeping recorded lineage. The fitted model stays bit-identical, and the test asserts the coupling exists.
- The ADR bullet correctly separates lineage coupling from target leakage.

## Checklist
1. Spec conformance: ok. 50 §1 signatures are unchanged. The `DeckSlot.lb` contract is enforced. ADR-0002 §3 exclusion is preserved. ADR-0002 got a single limitations bullet, authorised in the fix prompt (`T06.fix-1.prompt.md:15`). Specs are unchanged.
2. Correctness: ok, with S1-r2 and N1-r2. All acceptance numbers are identical to before (card worst 5.05%, coverage 0.8125, MC 0.8125/0.8208, 32667 pairs, #1 pMeet 0.218, trap not in top 50).
3. Test quality: ok. The 25 new tests assert real behaviour: typed error codes and reasons, acceptance of valid floored matrices with a bit-identical factor, ulp vs material σ, and the empty/lock rank paths. Two pre-existing fixtures were legitimately made contract-valid: σ doubled exactly, and fabricated skill ids replaced with real ones. The changelog numbers match my reruns, apart from N3-r2 and the stale statements in N4-r2.
4. Fabrication: ok. No fixture ids or constants are in `src`; the only grep hit is the error code string. Q-142 invents no game fact.
5. Security: ok. Input validation is stronger. Pure engine, no I/O added.
6. Free tier: ok. No API/D1/Worker changes. The covariance check is per model, not per pair.
7. Scope: ok. Golden data, apps, master-data and schema are unchanged against main. Reference, bench, package config and specs are unchanged in the fix diff. The OPEN_QUESTIONS/ADR edits are authorised.
8. Maintainability: ok. `factorFromEigen` is a clean split, and the tolerance constants are exported and documented. The stale changelog lines need cleanup (N4-r2).

## Commands run
```
$ git rev-parse HEAD; git status --porcelain=v1 -uall; git branch --show-current
aa4a47d1ccc5a167818d56ec76c37748b7f3b2ff   (clean)   task/T06-training-prediction
$ git log --oneline 8e0a27a..HEAD; git diff --stat 8e0a27a..HEAD
aa4a47d T06: review round 1 fixes (...)
10 files changed, 642 insertions(+), 16 deletions(-)
$ git diff --exit-code --stat main...HEAD -- packages/engine/test/golden apps packages/master-data packages/schema
PROTECTED_UNCHANGED
$ git diff --exit-code --stat 8e0a27a..HEAD -- docs/reference packages/engine/bench packages/engine/package.json packages/engine/vitest.config.ts docs/specs
REF_BENCH_SPECS_UNCHANGED
$ git diff --check 8e0a27a..HEAD   → DIFFCHECK_OK
$ grep -E "Tests" ~/.hermes/cache/scratch/t06-fix1-red.txt
Tests  17 failed | 7 passed (24)
# Node 22.18 (scratch runtime), packages/engine:
$ node -v → v22.18.0
$ node ../../node_modules/typescript/bin/tsc -p tsconfig.json → TSC_OK
$ node ../../node_modules/vitest/vitest.mjs run --reporter verbose   → exit 0
[T06] card recovery: worst 5.05% over 22; max |zero card| 2.50
[T06] stored split Gaussian coverage80 0.8125 …; without inheritance 0.6833
[T06] lineage coupling: 52 train→holdout matched-parent references to 25 distinct holdout veterans (of 48)
[T06] stored split MC p10–p90 coverage: 0.8125, 0.8208
[T06] golden legal pairs evaluated: 32667
[T06] golden #1 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2 pMeet MC 0.218 (fast 0.2135), #2 MC 0.0225; trap in top 50: no
Test Files 16 passed (16)   Tests 240 passed (240)
$ node ../../node_modules/vitest/vitest.mjs bench --run --reporter verbose   [run alone] → exit 0
(getter-overhead warning, as before)
[T06 bench] rankPairs legal pairs 32667, #1 01M1RX…|01M379…; samples 5, mean 3745.5 ms, min 3703.0 ms, max 3786.4 ms; node v22.18.0 darwin/arm64
[T06 bench] fit+rank legal pairs 32667; samples 5, mean 3928.2 ms, min 3854.9 ms, max 4056.9 ms
Tests 2 passed (2)
$ node ~/.hermes/cache/scratch/t06-review2/probe-r2.ts   → exit 0 (trimmed)
N3: holdout 48, train 192, references 52, trainRows 50, distinctHoldout 25
B1 other unique skill:all-charged-it-s-go-time: predict ok (pHinted 0, theta 0.452), rank 2
B1 defaults: ownInDefaultSkills false, nSkills 60, defRank 2; sure has own: false
B1 msg: ModelInputError:own-unique-skill "target requests skill:where-there-s-a-will-there-s-a-way, the unique skill of trainee outfit outfit:stone-piercing-blue; the training model ha…"
B1 scoreTarget own (kept samples): ScoreRequiresSamplesError "required skill … was not simulated"
S2: dupPredict/dupRankEmpty duplicate-card; lbRankEmpty deck-slot; unkCardRank unknown-card;
    orderDeckVsSkill deck-slot; orderSkillVsOpts UnknownIdError; orderOwnFirst(['skill:nope',own]) UnknownIdError;
    unkOptionalRankLockNoPair UnknownIdError; validEmptyRank 0; lbString deck-slot "got 4"; golden decks distinct true
S1: valid/jsonRoundTrip accepted (λmin 17.49); scaled1e6 / scaled1e-6 accepted;
    negEig ρ=1+1e-6 malformed; corr1exact malformed;
    hugeOverflowIndefinite (diag 1e150, off 1e200) ACCEPTED; tinyIndefinite (λmin −4.9e-11) ACCEPTED;
    roundTripIdentical true; prepareModel ms each 0.372
$ git status --porcelain=v1 -uall   → (empty)   HEAD aa4a47d1ccc5a167818d56ec76c37748b7f3b2ff
```

Everything is in `/Users/willjose/.hermes/cache/scratch/t06-review2/`:
- probe source and output: `probe-r2.ts`, `probe-r2.out.txt`
- test and bench logs: `engine-run.txt`, `bench.txt`

I did not run the workspace-wide `pnpm -r` lint/typecheck/test or the web build; I rely on your rerun for those. I did not run `pnpm -r build`, a master-data refresh/build, golden generation or any `--write` probe. No tracked edits were made. A PASS here does not merge or dispatch anything.

session_id: 20261003_222555_1b9811
