Verdict: CHANGES_REQUESTED, with one blocker.

The core statistics check out under fresh probes. The grid gives the same results as full refits, holdout data never reaches the train fit, the golden ×1.3 case lands at 1.33, there's no hardcoded 1.3 in production, and repeat runs are deterministic. The blocker is the aptitude log-likelihood: it reports a finite 0 (which reads as a perfect fit) when the model gives probability 0 to 87 observed cells.

Reviewed: claude-opus-5-5 (Opus 5.5 medium, primary), read-only, in T15-rules-calibration.
- Branch task/T15-rules-calibration, HEAD 1a484d6032faa6f697b6c43e83db1ee39867c2be, base 9e62727.
- HEAD was clean at the start and still clean with the same SHA at the end.
- No tracked edits, commits, pushes, delegation or model CLI.
- Everything I wrote is under /Users/willjose/.hermes/cache/scratch/t15-review-r1/.

Blocking

B1. packages/engine/src/calibrate/aptitude.ts:39-42, 99-117, 128-147, and the per-aptitude `logLik` at :131. The aggregate `logLik` field (and `meanLogLik`) sums only the possible cells. With the published context, probe P1 gave:
- `status: 'ok'`, `logLik: 0`, `meanLogLik: 0`
- impossible 87 (all `aboveMax`), degenerate 1960 of 1960, 0 reliability events
- every per-aptitude `logLik` is 0 while its impossible count is 2–20

The true log-likelihood is −∞, and the check carried no information at all. The evidence runner prints "apt ll 0.00 imp 87", and a later browser consumer would show 0.00 as a perfect fit. Changelog Q-158 calls this "honest", but the field name and type say otherwise.

Fix requested:
- Set the full `logLik`/`meanLogLik` to null whenever impossible > 0. Use null rather than −Infinity so the JSON stays safe. Add an explicit flag such as `fullLikelihood: 'zero-probability-observed'`.
- Move the current sum into a separately named `conditionalLogLik` over `possibleCells`, and expose that denominator.
- Do the same per aptitude.
- When every cell is degenerate, give the check a non-`ok` status (e.g. 'uninformative'), so it no longer counts towards `complete` at index.ts:626-635.
- Add tests that pin these cases on the published context.

Should fix

S1. index.ts:445 and 462. A one-point grid returns `suggested` with no search. With `{1.3,1.3}` probe P2 gave status suggested, a 1.3 suggestion and a bootstrap of 1.3/1.3/1.3. The cause is `atBoundary = ms.length > 1 && …`. Require at least 3 grid points for `suggested`, otherwise return insufficient-data or boundary. The default grid is unaffected, but an option shouldn't be able to plant a value.

S2. index.ts:473-502 and 607, 623. A tiny holdout yields a confident-looking result. With 5 train rows and 1 holdout row (probe P5), the report was `complete/suggested` at 1.42 while the train-CV argmin was 1.97. The bootstrap gave 1.42/1.42/1.42, so `containsCurrent` is false and the suggestion carries `consistentWithCurrent: false`. The only caution is the "noisy" warning. Fix: set bootstrap to null with a reason below a minimum holdout size, and add a warning when the holdout and train-CV selections disagree beyond the interval.

S3. aptitude.ts:102-104. The impossible-cell classification is `below ? belowBase : aboveMax`, so an unreachable grade between reachable ones is mislabelled `above-max`. With `pinkGradeGain` 2/2/2 (probe P7), the engine counted aboveMax 34, while my independent classification found below 0, above 0, gap 34. Published pink gain is 1, so its support is contiguous and current output isn't affected. Rules are swappable, so add an `unreachable` class and keep the docs accurate.

S4. skills.ts:58, 132, 142. With zero scored cells, `brier`, `logLik` and the guaranteed/lineage-only summaries return a finite 0 rather than null. This is the same misleading-finite pattern as B1 on a smaller scale (`meanLogLik` and `z` already return null correctly). Also, `skills.status` (index.ts:576) is `ok` even when `cells` is 0.

Nits

- N1. index.ts:144 `unbiasedHoldoutMae`: the name overclaims slightly, given the lineage coupling the note itself discloses. Something like `holdoutMaeOfTrainCvSelection` would be more exact. The semantics are correct: probe P4 confirmed the train-CV argmin never sees holdout targets.
- N2. index.ts:408 `sensitive` includes holdout rows. If only holdout rows depended on `blueStatGain`, the train fit would be flat across m. That's an edge case; computing it on train rows would be stricter.

Checklist

1. HEAD and diff. `git rev-parse HEAD` gave 1a484d6. `git status --porcelain` was empty at start and end. `git diff --check 9e62727..HEAD` passed. The diff touches 13 files (+2390/−4). The only cross-task edit is visibility-only: `export` added to `PreparedRow`, `prepareRow`, `seededSplit` and `recency` in fit.ts, and none of these are re-exported from index.ts. No schema, fixture, master or golden files changed.

2. Gates, run fresh. `pnpm install --frozen-lockfile --offline && pnpm -r lint && pnpm -r typecheck && pnpm -r test` exited 0:

       schema 149, master-data 82, api 111, engine 292, web 124

   No recursive build. Node v25.9.0, pnpm 11.22.0.

3. Fixed-up-front rule changes, exact relationship and refit equivalence (probe P3). I used a context with blueStatGain 7/19/41, blueInitialBonus 3/11/29, grandparent weight 0.37 and race stat gain 2/5/9:
   - E[inh] is exactly affine in m over 260 rows (260 depend on the multiplier); max error 1.1e-13 at m = 0.37, 1.73 and 3.9.
   - On a seeded split ('rev-a') and a 0.2–3 grid with step 0.07, grid MAE matches the full `fitTrainingModelDetailed` refit to 2.3e-13 at 5 points, with identical λ and no fast-path warning.

4. Holdout used for evaluation only (probe P4). Seeded split 'rev-b'. I perturbed holdout stats (×1.4 + 33), skills and train mode:
   - every train-CV MAE and λ was identical; the train-CV argmin stayed at 1.34;
   - the ×1 candidate fingerprint was unchanged;
   - the holdout argmin moved from 1.29 to 0.69. That is expected: the spec selects on the holdout, and the report discloses it.

   The candidate fingerprint at ×1.29 and the existing per-candidate test cover train-only targets.

5. Edge cases.
   - P6: Infinity and NaN stats were excluded as non-finite-stat (2 rows), NaN confidence as low-confidence, the bad date as bad-date. Bad grid, bootstrap and Infinity inputs threw typed `ModelInputError`.
   - P9: a zero table with turns, and a nonzero table with no turns, are each nonidentifiable with the right reason and no suggestion.
   - P10: a narrow 1.25–1.4 grid with 400 bootstraps still gave 1.33, interval 1.31–1.37.
   - Problems found are listed as B1, S1–S4.

6. No mutation and JSON safety. P8 checked that the roster and context rules/tables were byte-identical after a run. P5 checked that the report round-trips through JSON. Suggestions always carry `applied: false`. Production has no matches for truth, latent, Date.now or Math.random, and no hardcoded 1.3. The test helper's golden overlay is used only as test input.

7. Evidence re-run. I ran `node packages/engine/test/calibrate/golden-report.ts --variants --out <scratch>/run{A,B}.json` twice:
   - both exited 0, and the JSON is identical once the *Ms timing fields are stripped;
   - x1.3: 1.33 (40.939), train-CV 1.31, unbiased 41.020, bootstrap 1.31/1.33/1.37;
   - published: partial/nonidentifiable, apt ll 0.00, imp 87;
   - grid 0..4: 1.33.

   The `shasum -a 256` of roster, roster.calibration-x1.3, truth and published rules.json match the changelog.

8. Performance, measured in Node (P8): a default calibrateRules takes 1347 and 1465 ms (grid 1194/1301 ms for 151 points, 2 candidate fits about 115 ms, bootstrap 11/38 ms). The 401-point grid takes 3381 ms. The result is identical apart from runtime. This says nothing about browser CPU.

False starts (scratch only):
- My first probe file failed typecheck as a non-module .ts; I renamed it to .mts.
- P3 first crashed because I looked up multipliers that weren't on the 0.07-step grid; I switched to grid indices.
- My default-options sanity check showed the defaults use the global clock and a random ULID, as documented.

Fresh results vs self-report: all numbers above come from my own runs. The worker's mutation checks and TDD-first ordering I accepted from the commit order (tests in d50c61c, implementation in 8e0ddc2) and did not rerun.

Limitations that stay open regardless of these fixes: no real-roster run (waits for H4), no meaningful real `blueStatGain` value until Q-3/Q-5, no native/Windows test, and no browser consumer or apply-and-refit flow (Q-141/Q-155). I did not merge anything.

Probe scripts and outputs are in /Users/willjose/.hermes/cache/scratch/t15-review-r1/:
- probe.mts, run from packages/engine with `node <path>/probe.mts`
- probe-out.json
- gates.log
- runA.json, runB.json, runA.log, runB.log
