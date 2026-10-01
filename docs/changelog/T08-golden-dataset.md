# T08 — Golden dataset

- **Status:** Done
- **Branch:** task/T08-golden-dataset
- **Agent / model:** requested claude-opus-5-5 (anthropic), medium effort, profile fallback disabled. A first run stopped on HTTP 429 and left an untracked `packages/engine/scripts/golden.ts`. This continuation run kept that file, inspected it, and fixed and extended it. It was not rewritten from scratch.
- **Date:** 2026-10-02

## Summary

`pnpm --filter @uma/engine golden` (plain `node scripts/golden.ts`) deterministically generates the 70 §2 golden dataset from the committed published bundle `apps/web/public/master/global-20260930/`, which it only reads. It writes:

- a 260-veteran `RosterVeteran[]` roster;
- a ×1.3 `blueStatGain` calibration variant;
- `truth.json`, which holds every planted parameter and the per-veteran latent components;
- `targets.json`, which holds `golden-cm-1`;
- byte-identical copies in `apps/web/fixtures/`.

Inheritance runs only through T05's public API (`loadContext`, `planInheritance`, `sampleInheritance`). Synthetic turns are added through a scenario plugin. Inheritance math is not re-implemented. 45 tests in `packages/engine/test/golden/` check every planted property independently of the generator: schema, fingerprint, determinism, legality, best/trap pair, card-effect recovery by a 50 §4-style fit that uses only T06-available data, holdout coverage, noise covariance, modes, skill rates and their observable estimand, the calibration variant, the fixture copies and the browser-safe context module. Review round 1 changes are listed at the end of this file.

## Files

Created:

- `packages/engine/scripts/golden.ts`: the generator (Node only). It exports `generateGolden` and `writeGolden`, and re-exports `loadGoldenContext` and the truth types.
- `packages/engine/scripts/golden-context.ts` (review round 1): a browser-safe module holding `loadGoldenContext(master, truth, multiplier)` and the complete `GoldenTruth` types. Its only runtime import is `../src/index.ts`. It is the single way T06/T15/T13 should rebuild the generator's engine context from `truth.json`.
- `packages/engine/test/golden/t06-diagnostic.ts` (review round 1): a test-only 50 §4-style weighted grouped ridge with 5-fold CV and an 80% interval. It is not the T06 implementation.
- `packages/engine/test/golden/roster.json`: 260 `RosterVeteran`s (1.29 MB).
- `packages/engine/test/golden/roster.calibration-x1.3.json`: the same roster with `blueStatGain` × 1.3.
- `packages/engine/test/golden/truth.json`: the planted parameters, roster composition, best/trap pair, holdout split and latent components (241 KB).
- `packages/engine/test/golden/targets.json`: `CmTarget[]` holding `golden-cm-1`.
- `packages/engine/test/golden/load.ts`: test loaders. `truth` is typed as the shared `GoldenTruth` (since round 1).
- `packages/engine/test/golden/files.test.ts`: schema, master IDs, fingerprints, ranks, target, determinism, sha256 records, fixture copies, sizes.
- `packages/engine/test/golden/planted.test.ts`: legality, lineage, skill X, best/trap pair, training model, 50 §4 recovery and coverage, noise, modes, skills and their estimand, synthetic inputs, calibration, realism, documentation fields.
- `apps/web/fixtures/roster.json`, `apps/web/fixtures/cm-targets.json`, `apps/web/fixtures/golden-truth.json`: copies, not symlinks.

Modified:

- `packages/engine/package.json`: added `"golden": "node scripts/golden.ts"` and the devDependency `prettier: 3.9.9`. The generator imports prettier to serialise JSON, and the version is pinned to the root's version.
- `pnpm-lock.yaml`: the matching importer entry (4 lines).
- `docs/OPEN_QUESTIONS.md`: added Q-120, Q-121 and Q-122 (round 1).
- `apps/web/fixtures/.gitkeep`: deleted, because the directory now has content.

## Decisions

- **Seed and time.** `GOLDEN_SEED = 20260929`. Every random stream is `mulberry32(seedFromString("20260929:<label>"))` from the engine's `src/rng.ts`, with one label per purpose (`vet:i`, `deck:i`, `inh:i`, `noise:i`, `skills:i`, `sparks:i`, `confidence:i`, `structure`, `modes`, `owned-cards`, `skill-rates:<mode>`). The injected "now" is `2026-09-29T00:00:00.000Z`. There is no `Date.now()`. Serialisation sorts keys recursively and then runs prettier with the repo config, so committed files are already prettier-clean.
- **Master-data IDs are real; every number is synthetic.** The synthetic values are the card effects, intercepts, noise, skill rates, turns, blueStatGain, card level caps and guest trainer names. `truth.meta.notice` and every relevant field say so.
- **Synthetic inheritance inputs (Q-120).** Published `blueStatGain` is 0/0/0 (UNKNOWN), which would make the ×1.3 variant identical to the base roster. The golden data therefore overrides it to 10/20/30 (`verified:false`, `source: SYNTHETIC …`). Published `inheritanceTurns` are `[]`, so `loadGoldenContext` registers a scenario plugin per scenario that returns the synthetic turns `[31, 55]` (two events, labelled synthetic). All other rules are used verbatim; the list is in `truth.syntheticInheritance.rulesUsedVerbatim` and checked by a test.
- **Target id (Q-121).** `CmTarget.id` must be a ULID (01 is authoritative), so it is `01KGQZ0000G01DENCM00000001` and `name` is `golden-cm-1`. `truth.golden.{targetId,targetName}` link them. The first run's id contained `L`, which is not Crockford base32, so the generator crashed; that is fixed here.
- **Plan.** The trainee is `outfit:stone-piercing-blue` (Grass Wonder: turf A, medium B, pace A). The plan is URA Finale, manual mode, and `truth.golden.planDeck`: six planted cards at LB4. The target is Medium/Turf/Pace with min spd 1100 and sta 800, minimum aptitudes turf/medium/pace A, and required skill X.
- **Skill X = `skill:restraint`** (normal, gameId 202161). It has exactly one spark (`spark:restraint`, white). No card hint/event list, outfit innate/unique skill or race-spark hint includes it, which a test checks against master data. In the roster only best1 carries it: self 3★ and guest parent 1 at 2★. Rates are manual 0.75 and independent 0.40.
- **Best pair:** best1 = `01KZ1CR7Q86T9BGV6696R6DWN2` (Mejiro Dober) and best2 = `01KTKQN62GP86FAQ1WPY0MX60J` (El Condor Pasa). These are the two characters with the highest `affinity2` to the trainee. best2 and both of its guest parents carry 3★ pink medium. Every other medium pink in the roster is 1★, so best2 is the only source of a likely medium A.
- **Trap pair:** `01KQHVG030D9VJ3GCNECRKJFXV` (Nakayama Festa) and `01M0MXJV1GDCSBPD81KNCE4PPW` (Smart Falcon). Each has self 3★ blue speed and two guest parents with 3★ blue speed, giving 18 combined blue stars. That is the unique maximum: general blue sparks are never 3★, so a general veteran has at most 6. The trap has no X source, no medium pink, and a higher expected speed than the best pair (by more than 50).
- **Training model.** `stat_k = round(clip(baseline + modeIntercept[mode] + scenarioIntercept[scenario] + 4·growth%_k + Σ_deck perUnit·(1+lb/4) + noise + inheritanceSample, 1, statCap[scenario]))`. The card feature is exactly the 50 §4 feature `indicator × (1 + lb/4)`, so `perUnit = atLb4 / 2`.
  - Baseline: spd 618, sta 452, pow 590, gut 300, wit 448 (lowered in round 1 to offset the larger effects).
  - Independent intercept: spd −30, sta −20, pow −30, gut −15, wit −25 (total −120). Manual is 0.
  - Scenario intercepts: URA 0; the others are in truth.json.
- **12 planted cards** (atLb4, after the round 1 retune; the lowest SSR gameIds of each type, excluding the trainee's character):

  | Card                                      | Type    | Effect at LB4         |
  | ----------------------------------------- | ------- | --------------------- |
  | beyond-this-shining-moment-silence-suzuka | speed   | spd +110, pow +80     |
  | dream-big-tokai-teio                      | speed   | spd +96               |
  | run-my-way-gold-city                      | speed   | spd +90, wit +80      |
  | breakaway-battleship-gold-ship            | stamina | sta +100, gut +80     |
  | foolproof-plan-seiun-sky                  | stamina | sta +90               |
  | wild-rider-vodka                          | power   | pow +100, sta +80     |
  | champion-s-passion-el-condor-pasa         | power   | pow +90               |
  | the-brightest-star-in-japan-special-week  | guts    | gut +96, pow +80      |
  | watch-my-star-fly-ines-fujin              | guts    | gut +90               |
  | wave-of-gratitude-fine-motion             | wit     | wit +96, spd +80      |
  | 7-more-centimeters-air-shakur             | wit     | wit +90               |
  | tracen-reception-tazuna-hayakawa          | friend  | +80 to all five stats |

  There are also 14 zero-effect SSR cards: 2 per type, including 2 friend and 2 group cards (round 1). Each deck takes a uniform 2–5 planted cards, then zero-effect cards. Characters in a deck are distinct and never the veteran's own. 70% of decks have one borrowed slot (LB4). Owned LB follows a seeded timeline: each card starts at LB0 or LB1 and reaches LB4 within the 90 days (round 1), so a card's LB rises over dateAcquired.

- **Noise.** MVN with sd [10, 9, 10, 9, 9] (round 1; it was [9, 8, 9, 7, 8]) and the correlation matrix in truth.json. The covariance is stored as corr·sd·sd and is checked positive-definite through Cholesky. Each draw is `L·z` from Box–Muller normals.
- **Skills.** `hinted` = deck hint/event skills ∪ outfit innate skills ∪ the veteran's sampled inheritance hints (`latent[id].inheritanceHints`), minus the unique skill. Each hinted skill is acquired with `rates[mode][skill]`. The rates are Beta draws per mode (independent Beta(3,7), manual Beta(5,5)) over all master skills and are listed exactly in truth.json. The unique skill is always acquired, with a synthetic level from 1 to 6.
- **Modes.** Exactly 156 independent and 104 manual (60/40). The 4 planted veterans are manual. Which general veterans are independent is decided by a seeded permutation. The epithet follows 01 §6, except for 9 rows with `modeSource:'override'`, which are listed in truth.json.
- **Realism for T06.**
  - 20 low-confidence rows (min confidence 0.60–0.89). 12 of them miss one parent's sparks, which are listed in `truth.roster.unreadParentSparks`.
  - Parent kinds: 277 matched, 194 guest and 49 unmatched non-guest. A matched parent is always an earlier, complete general veteran, so `legacyFromVeteran(matched roster record)` is exactly the lineage the generator used. Guests have no grandparents.
  - dateAcquired runs from 2026-06-25 to 2026-09-23, a 90-day span (round 1; it was 360 days). `capturedAt` is 0–20 days after dateAcquired.
  - All 4 scenarios are present. Ratings and ranks come from master `ranks`.
- **Holdout.** `HOLDOUT_SEED = 20260930`, fraction 0.2. The training-eligible ids (min confidence ≥ 0.9, 240 rows) are sorted, Fisher–Yates shuffled with `mulberry32(20260930)`, and the first ceil(20%) are held out: 48 holdout, 192 train. Both lists are stored sorted in `truth.holdout`.
- **Calibration variant.** It uses the same streams, so ids, decks, sparks, skills, aptitudes, noise and activation draws are identical. Only blue activation gains differ, and with them stats, rating, rank and fingerprint. Its latent components are in `truth.calibration.latent`, and its sha256 is in `truth.calibration.sha256`. Only the ×1.3 variant is generated.
- **Web fixture names.** The web client maps `/api/v1/<x>` to `/fixtures/<x>.json` (`apps/web/src/api/client.ts`), so the copies are `roster.json`, `cm-targets.json` and `golden-truth.json`. They are copies, not symlinks: a test checks `lstat().isSymbolicLink() === false` and byte equality. The 1.3 MB calibration roster is not copied to the web fixtures.
- **Independent checks in the tests.**
  - pMeet is computed independently with a Gaussian fast-pass. It uses the planted training mean and covariance, plus the engine's closed-form `aptitudeDist`, `skillHintProb`, `expectedStatGain` and `statGainCov`, over all 32,667 legal pairs.
  - Card effects are re-fitted by the test-only 50 §4 diagnostic. It uses the train split, E[inheritance] from the recorded lineage, recency weights, id + type pooling and grouped ridge. It never reads `truth.latent` (round 1; this replaces the leaky OLS).
  - Noise covariance is compared with a sampling tolerance.
  - Inheritance latents are compared with the engine expectation on each recorded lineage (a z-score on the sums).
  - The test does not re-run the generator's logic. The one exception is the determinism test, which calls `generateGolden` itself.

## Deviations from spec

- 70 §2 calls the target `golden-cm-1`, but `CmTarget.id` is a ULID because 01 wins. See Q-121.
- 70 §2 says `apps/web/fixtures/` holds `roster.json`, `truth.json` and `targets.json`. The copies are named `roster.json`, `cm-targets.json` and `golden-truth.json` to match the T02 fixture URL mapping.
- 70 §2 says the inheritance uses `rules.json` values. `blueStatGain` and the turns are synthetic overrides, because the published values are UNKNOWN placeholders or empty (Q-120). Everything else is verbatim.
- 70 §2: the trap pair is "the highest combined blue stars" counted over the pair's recorded sparks (self + parent1 + parent2 of both veterans). 50 §9 calls the trap "a high single stat": its expected speed is much higher than the best pair's.

## Cross-task edits

- `packages/engine/package.json`: the `golden` script, as declared in the task notes. Also the pinned devDependency `prettier: 3.9.9`, needed because the generator formats JSON through prettier and `pnpm --filter` resolution needs it in the package. The version equals the root's.
- `pnpm-lock.yaml`: 4 lines for that devDependency.
- `docs/OPEN_QUESTIONS.md`: Q-120 and Q-121, inside the reserved Q-120..Q-129 range. The file's existing prettier warning comes from main and was not touched.
- Engine `src/` (T05/T06) is not modified. `apps/web/public/master/` is read only: `git status` shows no change there, and no master-data build or `pnpm -r build` was run.

## Verification

All commands were run from the worktree root on Node v25.9.0 / pnpm 11.22.0. The generator only uses erasable TypeScript, as the T05 smoke script does.

Two generator runs, with the sha256 of every output file:

```
$ pnpm --filter @uma/engine golden
$ node scripts/golden.ts
8ca6fa7067663d97adbabdbb0ca57feba3916cd96ef62026fad19089549d44a0  packages/engine/test/golden/roster.json  (1291835 bytes)
ad3cb227d0df58ebb5fae54ac1385de71cd0d4ac8413c7de7a98040a00710edb  packages/engine/test/golden/roster.calibration-x1.3.json  (1291838 bytes)
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  packages/engine/test/golden/targets.json  (432 bytes)
c98373904f98f73bf5582590333cc18bad8cee1bfeebc661d70f54ead52f174d  packages/engine/test/golden/truth.json  (241083 bytes)
8ca6fa7067663d97adbabdbb0ca57feba3916cd96ef62026fad19089549d44a0  apps/web/fixtures/roster.json  (1291835 bytes)
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  apps/web/fixtures/cm-targets.json  (432 bytes)
c98373904f98f73bf5582590333cc18bad8cee1bfeebc661d70f54ead52f174d  apps/web/fixtures/golden-truth.json  (241083 bytes)

$ shasum -a 256 packages/engine/test/golden/*.json apps/web/fixtures/*.json > run1.sha
$ pnpm --filter @uma/engine golden >/dev/null
$ shasum -a 256 packages/engine/test/golden/*.json apps/web/fixtures/*.json > run2.sha
$ diff run1.sha run2.sha && echo IDENTICAL
IDENTICAL
ad3cb227d0df58ebb5fae54ac1385de71cd0d4ac8413c7de7a98040a00710edb  packages/engine/test/golden/roster.calibration-x1.3.json
8ca6fa7067663d97adbabdbb0ca57feba3916cd96ef62026fad19089549d44a0  packages/engine/test/golden/roster.json
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  packages/engine/test/golden/targets.json
c98373904f98f73bf5582590333cc18bad8cee1bfeebc661d70f54ead52f174d  packages/engine/test/golden/truth.json
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  apps/web/fixtures/cm-targets.json
c98373904f98f73bf5582590333cc18bad8cee1bfeebc661d70f54ead52f174d  apps/web/fixtures/golden-truth.json
8ca6fa7067663d97adbabdbb0ca57feba3916cd96ef62026fad19089549d44a0  apps/web/fixtures/roster.json
```

Full workspace:

```
$ pnpm install --frozen-lockfile
Already up to date
Done in 262ms using pnpm v11.22.0

$ pnpm -r lint
Scope: 5 of 6 workspace projects
packages/schema lint: Done
apps/web lint: Done
packages/master-data lint: Done
apps/api lint: Done
packages/engine lint: Done

$ pnpm -r typecheck
Scope: 5 of 6 workspace projects
packages/schema typecheck: Done
packages/master-data typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done
packages/engine typecheck: Done

$ pnpm -r test
Scope: 5 of 6 workspace projects
packages/schema test:  Test Files  4 passed (4)
packages/schema test:       Tests  146 passed (146)
apps/web test:  Test Files  1 passed (1)
apps/web test:       Tests  5 passed (5)
packages/master-data test:  Test Files  3 passed (3)
packages/master-data test:       Tests  82 passed (82)
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  86 passed (86)
packages/engine test:  Test Files  7 passed (7)
packages/engine test:       Tests  108 passed (108)
```

Golden tests (`cd packages/engine && npx vitest run test/golden --reporter=verbose`, durations trimmed):

```
✓ files.test.ts > golden roster: schema and master data > roster.json has 260 schema-valid RosterVeterans with real master IDs
✓ files.test.ts > … > roster.calibration-x1.3.json has 260 schema-valid RosterVeterans with real master IDs
✓ files.test.ts > … > every fingerprint equals the shared @uma/schema fingerprint function
✓ files.test.ts > … > rank is the highest master rank whose minRating the rating reaches
✓ files.test.ts > … > truth.json names the master version and seed it was generated with
✓ files.test.ts > golden target golden-cm-1 > targets.json is a valid CmTarget[] with the 70 §2 requirements
✓ planted.test.ts > legality and lineage > parents are distinct characters, never the veteran itself; decks are legal
✓ planted.test.ts > … > matched parents are earlier roster veterans whose record matches the parent block
✓ planted.test.ts > … > planted veterans have guest parents only and are nobody's parent
✓ planted.test.ts > … > unread parent sparks only occur on low-confidence rows
✓ planted.test.ts > skill X has no source except the planted best parent > master data: one spark, no card / outfit / race-spark source
✓ planted.test.ts > … > roster: only best1 (self 3★, parent1 2★) carries the X spark, and only best1 has X
✓ planted.test.ts > … > target skill rates are planted per mode
✓ planted.test.ts > planted best pair and trap pair for golden-cm-1 > every legal pair is scored (260 veterans minus trainee-character conflicts)
✓ planted.test.ts > … > the best pair is the unique #1 by a wide margin
✓ planted.test.ts > … > only pairs containing best1 can meet the target (X hint), and best2 is needed for medium A
✓ planted.test.ts > … > the trap pair has the unique highest combined blue stars, no X source, and is not top 10
✓ planted.test.ts > training model: truth.json explains every roster stat > stats = round(clip(training + noise + inheritance)) for both rosters
✓ planted.test.ts > … > latent training = the documented linear formula of the truth parameters
✓ planted.test.ts > … > 12 planted cards with exact LB scaling; zero-effect cards are disjoint; all real SSRs
✓ planted.test.ts > … > OLS on the roster recovers every planted card effect within ±15% (identifiable)
✓ planted.test.ts > … > residual noise sample covariance matches the planted MVN covariance
✓ planted.test.ts > … > latent inheritance is consistent with the engine expectation on each recorded lineage
✓ planted.test.ts > modes and skill acquisition > exactly 60% independent / 40% manual; independent intercept −120 in total
✓ planted.test.ts > … > epithet follows the 01 §6 rule unless modeSource is override
✓ planted.test.ts > … > acquired skills ⊆ hinted; acquisition counts match the per-mode planted rates
✓ planted.test.ts > synthetic inheritance inputs and the ×1.3 calibration variant > turns are synthetic and labelled; published turns are still []
✓ planted.test.ts > … > every other rule is used verbatim from rules.json
✓ planted.test.ts > … > the ×1.3 roster differs only through blue activation gains
✓ planted.test.ts > training-row realism (50 §4 inputs) > confidence, recency, holdout
✓ files.test.ts > determinism > generating twice in-process gives byte-identical output equal to the committed files
✓ files.test.ts > … > truth.json records the sha256 of the files it describes
✓ files.test.ts > apps/web/fixtures copies > are regular files (not symlinks), byte-identical to the golden files
✓ files.test.ts > … > file sizes stay reasonable for the repo and fixture mode
 Test Files  2 passed (2)
      Tests  34 passed (34)
```

Values observed while building the tests. These are the outputs of the independent checks, printed once in a temporary debug run that has since been removed:

```
pMeet (Gaussian, golden-cm-1, 32,667 legal pairs):
  #1 [best2, best1] 0.1093   #2 [01KD5K51…, best1] 0.00312   #3 0.0000656
  top combined blue stars: trap pair 18, next 16; trap pMeet 0 (no X hint)
OLS recovered perUnit (planted → fitted), e.g.
  spd suzuka 40 → 39.31, teio 32 → 31.23, gold-city 28 → 27.20, fine-motion 20 → 18.31, tazuna 20 → 17.74
  gut special-week 32 → 29.89, ines-fujin 25 → 24.51; wit air-shakur 25 → 25.21 (all within ±15%)
```

Formatting and scope:

```
$ npx prettier --check packages/engine/scripts/golden.ts packages/engine/test/golden apps/web/fixtures packages/engine/package.json
Checking formatting...
All matched files use Prettier code style!
$ git status --short apps/web/public
(empty: the published bundle is untouched)
```

## Open questions / follow-ups

- Q-120: synthetic `blueStatGain` 10/20/30 and synthetic inheritance turns `[31, 55]` in the golden data. Regenerate once Q-3/Q-5 are answered.
- Q-121: `CmTarget.id` is a ULID and `golden-cm-1` is its name.
- Follow-up (T06): rebuild the generator's context with `loadGoldenContext(master, truth)` from `scripts/golden.ts`. Use `truth.holdout` for the 80/20 split, and look up the target by `name === 'golden-cm-1'`. The best pair's Gaussian pMeet is about 0.11 and the runner-up's about 0.003, so the "#1" margin is large but the absolute pMeet is modest by design: X is acquired at 0.75 and its hint probability comes from the white-spark activation rates in `rules.json`.
- Follow-up (T15): the calibration roster is `roster.calibration-x1.3.json`. With the published zero `blueStatGain` replaced by the synthetic 10/20/30, the multiplier acts on event gains only; the career-start `blueInitialBonus` is unchanged.
- Follow-up: the web fixture mode currently gets `roster.json` and `cm-targets.json`. Other endpoints (owned cards, review items) have no golden fixtures; that is outside 70 §2.

## Review round 1

This round answers `docs/reviews/T08-review-1.md` (reviewed commit 84c64be). The existing implementation is kept and was extended, not rewritten. Model: claude-opus-5-5, medium effort, with profile fallback disabled.

### B1 (blocking) — fixed: the dataset is retuned, and recoverability is now proven with T06-available information only

The old OLS test was removed. It had subtracted `truth.latent[id].inheritance`, fitted on all 260 rows and used unweighted OLS.

New test-only estimator: `packages/engine/test/golden/t06-diagnostic.ts`, used by `planted.test.ts > 50 §4 recoverability …`.

- **Rows.** It fits only on `truth.holdout.trainIds` (192 eligible rows). Low-confidence rows are never in the design, and the 48 holdout rows are used only for the S3 coverage check.
- **Response.** y = finalStat − E[inheritance stat gain | recorded lineage]. The expectation is T05's `planInheritance` + `expectationFromPlan` on the lineage recorded on the veteran: a matched parent goes through `legacyFromVeteran(roster record)`; any other parent uses its recorded sparks with null grandparents.
  - The context is rebuilt by `loadGoldenContext` from `truth.syntheticInheritance` alone.
  - `truth.latent` is never read by the fit. Planted truth is used only as the expected answer.
- **Features (50 §4).** Intercept; one-hot scenario × trainMode; outfit growth % (5); card id × (1 + lb/4); 7 card-type pools × (1 + lb/4); scenario `deckFeatures` (empty for the default plugin).
- **Weights.** 0.5^(age/60), where age is measured from the newest train row.
- **Fit.** Weighted ridge per stat. λ_id applies to the card-id columns and λ_base to everything else, including the intercept. λ is chosen per stat by seeded 5-fold CV on {0.1, 1, 10, 100} × {0.1, 1, 10}, using a dense Cholesky solve.

Structural ambiguity, recorded as Q-122:

- Each type feature is exactly the sum of that type's id features (a test asserts this per row), so β_id and β_type are not separately identified.
- The smallest defensible estimand is the effective contribution β_id[card] + β_type[type]. That is the quantity every prediction uses.
- The generator plants no type effect, so the planted `perUnit` is the true effective contribution. No oracle adjustment is applied and the ±15% tolerance is unchanged.
- Recorded in `truth.trainingModel.cardEffectEstimand`. `01-data-contracts.md` and the 50/70 specs are unchanged.

Retune (all values synthetic; recorded in `truth.trainingModel.synthetic`). In a probe run with the old dataset, this estimator reproduced the reviewer's failure: worst error 34%, 8 effects outside ±15%. Then:

1. dateAcquired span cut from 360 to 90 days. Recency ESS went from 90.2 to 176.3 of 192.
2. Effects raised so the minimum is 40 per unit (80 at LB4). Baseline lowered to compensate.
3. friend and group types now have 2 zero-effect cards each, so no type pool equals a single card id.
4. Owned-card LB timeline: every card starts at LB0 or LB1 and reaches LB4 within the 90 days. This was decisive. Under the old timeline, many cards had nearly constant LB, so card-id columns were close to collinear with the type pools and the intercept. Probe: worst error went from 12.1% to 4.0% at fixed noise.
5. Noise sd set to [10, 9, 10, 9, 9], so holdout coverage is realistic rather than inflated by near-zero noise.

Unchanged: 260 rows, exactly 156/104 modes, independent intercept −120, the 12 planted cards (same cards, same `perUnit = atLb4/2` feature), the MVN covariance (corr·sd·sd, positive-definite) and the other acceptance tests.

Actual output (temporary report test, since deleted; the CV λ is identical in truth.json):

```
train 192 holdout 48 ESS 176.3
CV λ per stat spd 0.1/0.1, sta 0.1/0.1, pow 0.1/0.1, gut 0.1/0.1, wit 0.1/1
λ 0.1/0.1: worst 6.8% (card:wave-of-gratitude-fine-motion.spd 40->37.29); max |zero-card| 5.01
λ 0.1/1:   worst 6.8% (card:wave-of-gratitude-fine-motion.spd 40->37.28); max |zero-card| 5.37
λ 0.1/10:  worst 7.5% (card:champion-s-passion-el-condor-pasa.pow 45->48.39); max |zero-card| 6.83
λ 1/0.1:   worst 7.4% (card:wave-of-gratitude-fine-motion.spd 40->37.02); max |zero-card| 4.31
λ 1/1:     worst 7.9% (card:wave-of-gratitude-fine-motion.spd 40->36.86); max |zero-card| 4.86
λ 1/10:    worst 8.7% (card:wave-of-gratitude-fine-motion.spd 40->36.52); max |zero-card| 7.14
λ 10/0.1:  worst 19.6% (card:beyond-this-shining-moment-silence-suzuka.pow 40->32.16)
λ 10/1:    worst 20.2%   λ 10/10: worst 24.8%   λ 100/*: worst 59–65%
CV-chosen: worst 6.8% (card:wave-of-gratitude-fine-motion.spd 40->37.29); max |zero-card| 5.01
perUnit planted -> fitted (CV λ, β_id + β_type):
  beyond-this-shining-moment-silence-suzuka spd 55->55.41 pow 40->39.35
  dream-big-tokai-teio spd 48->45.91
  run-my-way-gold-city spd 45->43.91 wit 40->39.15
  breakaway-battleship-gold-ship sta 50->50.34 gut 40->41.44
  foolproof-plan-seiun-sky sta 45->45.23
  wild-rider-vodka sta 40->40.03 pow 50->49.73
  champion-s-passion-el-condor-pasa pow 45->46.76
  the-brightest-star-in-japan-special-week pow 40->38.39 gut 48->46.93
  watch-my-star-fly-ines-fujin gut 45->46.13
  wave-of-gratitude-fine-motion spd 40->37.29 wit 48->45.42
  7-more-centimeters-air-shakur wit 45->43.55
  tracen-reception-tazuna-hayakawa spd 40->40.19 sta 40->40.71 pow 40->41.11 gut 40->40.35 wit 40->39.21
```

The tests cover the reviewer's minimum λ (0.1/0.1) and also 0.1/1, 1/0.1 and 1/1. Each requires no planted effect outside ±15%, a worst error below 10% as margin, and every zero-effect card within ±8 (the smallest planted effect is 40). A separate test runs the full 5-fold CV over the stated grid (12 points per stat) and requires the chosen λ to recover every effect with the same margin.

Limitation: λ_id ≥ 10 over-shrinks and fails. The data is only guaranteed to be recoverable for λ_id ≤ 1, which is what the 50 §4 CV picks here. If T06 used a different CV loss, folds or weighting and picked λ_id ≥ 10, it would fail. That would be a T06 estimator issue, not a data issue.

Best/trap properties after regeneration (from a temporary debug print of the existing Gaussian pMeet test):

```
#1 best2+best1 0.1075 | #2 01KY7FDD…+best1 0.003123 | #3 0.00009385 ; trap rank 25723 (0-based) ; blue stars trap 18 vs next 16 ; pairs 32667
best 01M379DKQ86T9BGV6696R6DWN2 (mejiro-dober) + 01M1RX152GP86FAQ1WPY0MX60J (el-condor-pasa)
trap 01M0J80G30D9VJ3GCNECRKJFXV (nakayama-festa) + 01M2N9GT1GDCSBPD81KNCE4PPW (smart-falcon)
```

The IDs changed because capturedAt moved with the new date span; the characters are the same.

T15 feasibility re-check (temporary probe, not committed). Holdout-MAE grid of the same diagnostic fit on `roster.calibration-x1.3.json`, sum over the 5 stats:

```
calib-holdout argmin 1.40  1.20:48.74 1.25:46.50 1.30:44.87 1.35:43.74 1.40:43.27 1.45:43.46 1.50:44.47
base-holdout  argmin 1.10  1.00:42.15 1.05:41.11 1.10:40.81 1.15:41.40
calib-trainCV argmin 1.30  1.25:49.92 1.30:49.34 1.35:49.47 1.40:50.23
```

Recorded as a follow-up for T15, not as a guarantee. The 48-row holdout MAE curve is flat near its minimum and lands at the [1.2, 1.4] band edge: on the base roster it picks 1.10, not 1.0, so the holdout criterion alone has a bias of about +0.1. 5-fold CV on the train rows picks 1.30. T15 should use a multi-row criterion (e.g. CV MAE) or a finer grid, and report the margin.

### S1 — fixed: browser-safe context module

- `packages/engine/scripts/golden-context.ts` holds `loadGoldenContext` and the complete `GoldenTruth` type set (`GoldenMeta`, `GoldenTrainingModel`, `GoldenSkills`, `GoldenRosterInfo`, `GoldenInfo`, `GoldenHoldout`, `GoldenCalibration`, `GoldenLatent`, `PlantedCard`, …).
  - Runtime imports: `../src/index.ts` only (its transitive bare import is `zod`).
  - Type-only imports from `@uma/schema` and `@uma/master-data`.
- `golden.ts` imports and re-exports it.
- New test `files.test.ts > golden-context.ts is browser-safe (S1)` walks the runtime import graph, resolving relative imports and `@uma/schema` to source. It asserts:
  - no `node:*` and no `prettier` import anywhere in the graph;
  - no `scripts/golden|published-bundle|smoke.ts` and no test file;
  - the only bare package is `zod`.
- Negative check: a temporary `import { loadPublishedBundle } from './published-bundle.ts'` added to golden-context.ts made the test fail (`expected '…' not to match /…(golden|published-bundle|smoke)\.ts$/`). The file was restored and `git diff` is empty for that change.
- The generator is still plain Node erasable TS (`node scripts/golden.ts`). It now also imports `test/golden/t06-diagnostic.ts` to record the S3 coverage in truth.json.

### S2 — fixed: documented, with a regression check

- `truth.skills.hintedDefinition` is now labelled LATENT.
- New field `truth.skills.observableEstimand`:
  - `rates[mode][skill]` is P(acquired | actually hinted).
  - Under the 50 §4 observable definition, a lineage-only skill is acquired with probability rates × P(hint | recorded lineage) (T05 `skillHintProb`).
  - T06's per-mode Beta means estimate a mixture of the two and must not be compared with `rates`.
- New test `skill estimand: observable … vs latent …`, over the 240 eligible rows:
  - the observable hinted set contains every latent hinted skill and is strictly larger;
  - observed acquisitions are within 4 sd of Σ rates × P(hint);
  - Σ rates over the observable set exceeds the observed count by more than 6 sd.

  Numbers: observable hinted 14,537 vs latent 12,566; acquired 4,496; Σ rates × P(hint) = 4,475.3; Σ rates = 5,215.3.

### S3 — fixed: coverage measured on the stored split with the same non-leaky estimator

`truth.holdout.coverageDiagnostic` records the following, and the test `S3: holdout 80% interval coverage …` re-computes it and asserts it matches truth.json and lies within [0.72, 0.88].

- **Definition.** Pooled over the 5 stats: the share of the 240 (holdout row, stat) cells where y lies inside prediction ± z₀.₉ · sqrt(σ̂²_k (1 + v)).
  - Fit: per stat on the 192 train rows, with CV λ 0.1/0.1 for spd, sta, pow and gut, and 0.1/1 for wit.
  - σ̂²_k = Σw r² / Σw(1 − h), from the weighted train residuals with leverage correction.
  - v is the sandwich variance factor of the ridge prediction.
- **Output.**
  - Pooled: 0.841667.
  - Per stat: spd 0.854167, sta 0.833333, pow 0.854167, gut 0.8125, wit 0.854167.
- **Margin.** 0.122 above 0.72 and 0.038 below 0.88. The binomial sd at 240 cells is about 0.026, and higher in practice because a row's 5 stats are correlated. At n = 48, the per-stat sd is about 0.058.
- **Limitations** (also in truth.json):
  - A per-stat 0.72–0.88 check is not robust at n = 48. T06 should report the pooled figure.
  - The diagnostic uses one homoscedastic σ̂² per stat, which absorbs the inheritance-sampling deviation.
  - Read literally, 50 §4 (`residualCov` from holdout residuals) plus 50 §7 (adding Var[inh]) would double count the inheritance variance and calibrate on the holdout. T06's coverage may therefore differ.
  - The planted covariance is not used. The fit is only 0.038 from the upper bound, which is the tightest margin in this round.

### S4 — follow-up recorded (T13/T02); no web runtime/config change in T08

- `apps/web/fixtures/` is outside Vite `publicDir`, and `vite.config.ts` does not serve it, so fixture mode currently gets 404s for `/fixtures/*.json`. Follow-up for T13 (or T02): serve or copy the directory.
- A fixture-mode planner must build its engine context with `loadGoldenContext(master, truth)` from `packages/engine/scripts/golden-context.ts`. It must not use the published rules (blueStatGain 0, `inheritanceTurns: []`), because those do not reproduce the golden best pair.
- Also recorded in `truth.webFixtures.note`.

### N1 — fixed

- Every truth section has a named interface in `golden-context.ts`, and the generator builds `GoldenTruth` against them (no `Record<string, unknown>` sections remain).
- `test/golden/load.ts` no longer restates a `Truth` view. It types `truth` as the shared `GoldenTruth` and re-exports `Truth` and `Latent` as aliases.

### N2 — fixed (documented and tested)

- `truth.trainingModel.clipping`:
  - `exercised: false`;
  - `observedStatRange: [280, 1085]`;
  - unclipped sums 279.50..1084.99, with 0 clipped cells in either roster, against statCap 2000.
- Clipping must be tested separately (F09, T06). A test asserts these fields against the roster.

### N3 — documented

`golden-truth.json` is kept in `apps/web/fixtures/`. Its purpose is documented in `truth.webFixtures.note` and the test `web fixture copies are documented as future fixture-planner metadata`: it is intended metadata for a future fixture-mode planner, carrying the synthetic inheritance inputs that `loadGoldenContext` needs. The web client does not consume it today.

### Round 1 files

- Created:
  - `packages/engine/scripts/golden-context.ts` (the declared minimal cross-task path extension);
  - `packages/engine/test/golden/t06-diagnostic.ts`.
- Modified:
  - `packages/engine/scripts/golden.ts`;
  - `packages/engine/test/golden/{load.ts,planted.test.ts,files.test.ts}`;
  - the regenerated golden JSON files and the `apps/web/fixtures/*.json` copies;
  - `docs/OPEN_QUESTIONS.md` (Q-122);
  - this changelog.
- Not touched: engine `src/`, `01-data-contracts.md`, the specs, `apps/web` runtime/config, the published master bundle, `package.json` and the lockfile.

### Round 1 verification

Node v25.9.0, pnpm 11.22.0, from the worktree root.

```
$ pnpm install --frozen-lockfile
Scope: all 6 workspace projects
Already up to date
Done in 254ms using pnpm v11.22.0

$ pnpm --filter @uma/engine golden            # run 1 (output trimmed)
462483ad67b7c4bfccb748ccf88317e8f1423e157ad9f0f2e0e7a43848f55f15  packages/engine/test/golden/roster.json  (1293916 bytes)
7011594e24159b081b84d8251ec8367fa69e2a9047f56cb4b5d570bebe3b2657  packages/engine/test/golden/roster.calibration-x1.3.json  (1293918 bytes)
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  packages/engine/test/golden/targets.json  (432 bytes)
b442fd4884ca4f75a54566983d4549493b46ca6ef424fd1f9e2a8540ff968bba  packages/engine/test/golden/truth.json  (249009 bytes)
462483ad67b7c4bfccb748ccf88317e8f1423e157ad9f0f2e0e7a43848f55f15  apps/web/fixtures/roster.json  (1293916 bytes)
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  apps/web/fixtures/cm-targets.json  (432 bytes)
b442fd4884ca4f75a54566983d4549493b46ca6ef424fd1f9e2a8540ff968bba  apps/web/fixtures/golden-truth.json  (249009 bytes)
$ shasum -a 256 packages/engine/test/golden/*.json apps/web/fixtures/*.json > run1.sha
$ pnpm --filter @uma/engine golden >/dev/null  # run 2
$ shasum -a 256 packages/engine/test/golden/*.json apps/web/fixtures/*.json > run2.sha
$ diff run1.sha run2.sha && echo IDENTICAL
IDENTICAL

$ pnpm -r lint
packages/schema lint: Done / apps/web lint: Done / packages/master-data lint: Done / apps/api lint: Done / packages/engine lint: Done
$ pnpm -r typecheck
packages/schema typecheck: Done / packages/master-data typecheck: Done / apps/web typecheck: Done / apps/api typecheck: Done / packages/engine typecheck: Done
$ pnpm -r test
packages/schema test:       Tests  146 passed (146)
packages/master-data test:  Tests  82 passed (82)
apps/web test:              Tests  5 passed (5)
apps/api test:              Tests  86 passed (86)
packages/engine test:  Test Files  7 passed (7)
packages/engine test:       Tests  119 passed (119)

$ cd packages/engine && npx vitest run test/golden --reporter=verbose   (new/changed tests; all 45 pass)
✓ planted.test.ts > 50 §4 recoverability … > uses only eligible train rows; the stored split is disjoint from the fit
✓ … > the type feature is the sum of its id features: only β_id + β_type is identified (Q-122)
✓ … > λ_id=0.1 λ_base=0.1 recovers all 12 planted effects within ±15% with margin
✓ … > λ_id=0.1 λ_base=1 recovers all 12 planted effects within ±15% with margin
✓ … > λ_id=1 λ_base=0.1 recovers all 12 planted effects within ±15% with margin
✓ … > λ_id=1 λ_base=1 recovers all 12 planted effects within ±15% with margin
✓ … > the 5-fold CV grid {0.1,1,10,100}×{0.1,1,10} picks λ that recovers every effect
✓ … > S3: holdout 80% interval coverage (pooled) is inside 0.72–0.88 and matches truth.json
✓ planted.test.ts > skill estimand: observable (50 §4) hinted vs latent … > lineage-hinted rows are acquired at rates × P(hint), not at rates
✓ planted.test.ts > documentation fields (N2, S4/N3) > clipping is recorded as not exercised, consistent with the roster
✓ planted.test.ts > documentation fields (N2, S4/N3) > web fixture copies are documented as future fixture-planner metadata
✓ planted.test.ts > training-row realism (50 §4 inputs) > confidence, recency, holdout
✓ files.test.ts > golden-context.ts is browser-safe (S1) > its runtime import graph has no node:*, prettier, published-bundle or generator I/O
✓ files.test.ts > determinism > generating twice in-process gives byte-identical output equal to the committed files
 Test Files  2 passed (2)
      Tests  45 passed (45)
```

The formatting and `git diff --check` output is appended below.

```
$ npx prettier --check packages/engine/scripts packages/engine/test/golden apps/web/fixtures packages/engine/package.json docs/changelog/T08-golden-dataset.md
Checking formatting...
All matched files use Prettier code style!
$ npx prettier --check docs/OPEN_QUESTIONS.md
[warn] docs/OPEN_QUESTIONS.md        # pre-existing: `git show HEAD:docs/OPEN_QUESTIONS.md` warns identically; Q-122 follows the file's existing style
$ git diff --check && echo diffcheck-ok
diffcheck-ok
$ git status --short apps/web/public packages/engine/src docs/specs
(empty)
```

### Remaining gaps (round 1)

- Recovery holds for λ_id ≤ 1. With λ_id ≥ 10, the shrinkage puts the worst error above 15%. The stated 5-fold CV picks λ_id = 0.1 for every stat.
- The S3 coverage margin to the 0.88 upper bound is 0.038 (pooled), and the per-stat check is noisy at n = 48. T06's own residualCov definition may give different coverage.
- T15: the holdout-MAE multiplier grid reaches its minimum at 1.40, the band edge; train-CV gives 1.30. T15 should use a robust criterion.
- S4: fixture serving (Vite) and a fixture-mode planner wired to `loadGoldenContext` are T13/T02 follow-ups.
- The golden data never exercises clipping (N2). T06 must test it separately.
