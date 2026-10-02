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
- `packages/engine/test/golden/t06-diagnostic.ts` (review round 1): a test-only 50 §4-style weighted grouped ridge with 5-fold CV and an 80% interval. It is not the T06 implementation. _(Superseded in round 2: moved to `packages/engine/scripts/golden-diagnostic.ts`, the test file was deleted.)_
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
- **Synthetic inheritance inputs (Q-120).** Published `blueStatGain` is 0/0/0 (UNKNOWN), which would make the ×1.3 variant identical to the base roster. The golden data therefore overrides it to 10/20/30 (`verified:false`, `source: SYNTHETIC …`). Published `inheritanceTurns` are `[]`, so `loadGoldenContext` registers a scenario plugin per scenario that returns the synthetic turns `[31, 55]` (two events, labelled synthetic). _(Superseded in round 2: four events `[19, 31, 43, 55]`.)_ All other rules are used verbatim; the list is in `truth.syntheticInheritance.rulesUsedVerbatim` and checked by a test.
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

- **Noise.** _(Superseded in round 2: sd [6, 5.4, 6, 5.4, 5.4].)_ MVN with sd [10, 9, 10, 9, 9] (round 1; it was [9, 8, 9, 7, 8]) and the correlation matrix in truth.json. The covariance is stored as corr·sd·sd and is checked positive-definite through Cholesky. Each draw is `L·z` from Box–Muller normals.
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

> **SUPERSEDED (review round 2 S1).** The table below does not reproduce from the committed dae3cc5 code (the reviewer measured e.g. λ 0.1/10 at 12.53%, not 7.5%). It came from an earlier iteration. The final λ table, captured from the frozen round-2 data and code, is in Review round 2.

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

> **SUPERSEDED (review round 2 B1).** The block below came from a 0.05-step grid on the round-1 data. On a 0.01 grid the round-1 ×1.3 argmin was 1.41, outside the band, so "argmin 1.40" was a grid artefact and not a finding. Final numbers are in Review round 2. Kept for history only.

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
- ~~T15: the holdout-MAE multiplier grid reaches its minimum at 1.40, the band edge; train-CV gives 1.30. T15 should use a robust criterion.~~ _Superseded (round 2 B1): this came from a coarse grid and was wrong (the 0.01-grid argmin was 1.41). After the round-2 retune the holdout-MAE argmin is 1.34 / 1.34 / 1.33; see Review round 2._
- S4: fixture serving (Vite) and a fixture-mode planner wired to `loadGoldenContext` are T13/T02 follow-ups.
- The golden data never exercises clipping (N2). T06 must test it separately.

## Review round 2

This round answers `docs/reviews/T08-review-2.md` (reviewed commit dae3cc5). Requested model: claude-opus-5-5 (anthropic), medium effort, with profile fallback disabled.

Two earlier attempts at this round stopped on HTTP 429: Opus session 20261002_074934_f73ab6, and the GPT-6.1 Sol fallback session 20261002_081134_24bcf0. They left uncommitted partial work, all inspected before any edit:

- the noise and turn retune in `golden.ts`;
- the extraction of the diagnostic to `scripts/golden-diagnostic.ts`;
- coverage variants;
- an actual-vs-recorded inheritance guard;
- draft files `calibration-diagnostic.ts`, `diagnostics.ts` and `root-cause.ts`;
- regenerated data.

That work was kept and finished, not restarted. The roster hashes this run generates are byte-identical to the partial run's roster files. Only `truth.json` changed, because its metadata is new. Round-1 B1 card recovery is kept: the same estimator and tests pass on the final data.

### B1 (blocking): fixed. Root cause measured first, then a synthetic retune

**Root-cause investigation.** Command: `node packages/engine/test/golden/root-cause.ts [--baseline] [--calibration]`.

- **Diagnosis-only tool.** It reads `truth.latent` / `truth.calibration.latent` to split the bias into its sources. No acceptance fit uses it.
- **Ablations.** Each ablation rebuilds every eligible row's stats from its latent parts and re-runs the same holdout-MAE scan used by the feasibility test.
- **`--baseline`** reads the immutable dae3cc5 git objects.

Results, as holdout-MAE argmin on the stored 50 §4 split at λ 0.1/0.1 (real output below):

| data                 | clean | + noise only | + activation only | combined | weighted vs unweighted | λ≈0 (1e-6)  |
| -------------------- | ----- | ------------ | ----------------- | -------- | ---------------------- | ----------- |
| dae3cc5 base (m=1.0) | 1.00  | 1.06         | 1.03              | 1.09     | 1.10 / 1.09            | 1.10 / 1.09 |
| dae3cc5 ×1.3 (m=1.3) | 1.30  | 1.36         | 1.34              | 1.41     | 1.41 / 1.41            | 1.41 / 1.41 |
| final base (m=1.0)   | 1.00  | 1.02         | 1.01              | 1.04     | 1.04 / 1.04            | 1.04 / 1.04 |
| final ×1.3 (m=1.3)   | 1.30  | 1.32         | 1.32              | 1.34     | 1.34 / 1.34            | 1.34 / 1.34 |

Conclusions, each backed by evidence:

- **Lineage completeness and actual-vs-expected inheritance are not the cause.**
  - `golden.ts` now asserts on every one of the 240 eligible rows that the generator's own plan expectation (`expectationFromPlan(plan)`, recorded while generating) equals the recorded-lineage expectation that `buildDesign` rebuilds from the roster. A mismatch makes generation throw.
  - Guest and unmatched parents carry null grandparents in both the generator plan and the design.
  - The reviewer's hypothesis (missing grandparents in E[inh]) is ruled out: the "clean" ablation, with no nuisance terms, gives exactly the planted 1.00 and 1.30.
- **Regularisation, recency weights and the estimator are not the cause.**
  - With the nuisance removed, the scan is unbiased.
  - With the nuisance present, the argmin is the same with recency weights or uniform weights, and at λ 0.1 or 1e-6.
- **The cause is finite-sample correlation between the nuisance draws and the blue-inheritance signal on the 48-row holdout.**
  - MVN noise alone shifted the dae3cc5 argmin by +0.06, and activation sampling deviation alone by +0.03 to +0.04. Together they gave +0.09 to +0.11.
  - On the dae3cc5 holdout, the per-stat sample correlations of the noise with the blue signal E[inh|m] − E[inh|0] are spd 0.203, sta 0.290, pow 0.102, gut 0.031, wit 0.185. Activation correlations reach 0.370 (gut), and 0.568 on the 39-row 50 §8 subset (sta).
  - These are independent in expectation (train rows: |corr| ≤ 0.18). It is a finite-sample effect of n = 48 / 39, not a generator bug.
  - Holdout MAE is a 48-row statistic. Its argmin moves with these correlations in proportion to nuisance sd ÷ blue-signal size.

**Retune.** Synthetic, deterministic, same seed. It is documented in `truth.trainingModel.synthetic.noise` and `truth.syntheticInheritance.inheritanceTurns.*.note`.

1. **Noise sd** went from [10, 9, 10, 9, 9] to [6, 5.4, 6, 5.4, 5.4]: a uniform ×0.6, with the same correlation matrix, seed and stream labels. The standard-normal draws are unchanged, so the covariance is exactly 0.36× the round-1 covariance. It is still a known MVN, stored and Cholesky-checked as before.
2. **Synthetic inheritance events** went from 2 (`[31, 55]`) to 4 (`[19, 31, 43, 55]`).
   - The expected blue gain grows linearly with the number of events, but the activation sampling sd grows only with its square root. So each row carries about √2× more identifiable blue signal relative to activation noise.
   - Activation rates and every other rule are the published rules, unchanged.
   - The extra events consume more of each `inh:<i>` stream, so activation realisations differ from round 1 even though no seed or label changed.

Not changed: seeds, holdout seed and split, eligibility, the 50 §8 population rule, the scan bounds, tolerances, the 12 planted cards, 260 rows, the 156/104 modes, the −120 intercept, and the best/trap pair veterans (same ids and characters as dae3cc5).

Alternatives probed with temporary scripts, deleted afterwards. These numbers do not reproduce from the committed code:

- 5 and 6 events at noise ×0.6, and 6 events at noise ×0.8: calibration was also inside the band, but the extra events let other best1 pairs reach medium A often enough to break the best-pair margin (`expected 0.37 > 0.48` and `0.44 > 0.72` in the ">10× runner-up" assertion).
- Noise ×1.0 with 4 events: ×1.3 argmin 1.37 / 1.38 / 1.35, too close to the edge.
- Noise ×0.8 with 4 events: 1.36 / 1.37 / 1.34.
- Noise ×0.5 with 4 events: the same argmins as ×0.6.

×0.6 with 4 events was kept. It is the partial run's choice and meets every check.

**Feasibility check (TEST-ONLY): `packages/engine/test/golden/calibration.test.ts`**, with helpers in `test/golden/calibration-diagnostic.ts`.

- **Criterion.** For each m on a 0.01 grid over [0.50, 2.00] (151 points; it contains the requested [1.0, 2.0]):
  - y_m = finalStat − E[inh | recorded lineage, blueStatGain × m];
  - fit the 50 §4 design (recency weights from the newest train row) with a per-stat weighted ridge at λ 0.1/0.1, the CV choice for 4 of the 5 stats;
  - criterion = Σ_k holdout MAE (50 §8 holdout MAE).
  - Inputs are roster rows, the stored split ids and `loadGoldenContext` from `truth.syntheticInheritance` only. No latent value, truth multiplier or planted parameter is used.
- **Exact fast path.**
  - E[inh] is affine in m: `blueStatGain` scales event gains, and `blueInitialBonus` is unchanged.
  - Ridge predictions are linear in y.
  - So two solves (m = 0, 1) give every grid point exactly. The test proves this against direct refits at m ∈ {0.5, 1, 1.2, 1.3, 1.34, 1.4, 2}, with |Δ| < 1e-8.
- **Documented populations** (asserted):
  - 50 §4 stored split: train 192 / holdout 48 (eligible, min confidence ≥ 0.9).
  - 50 §4 train / 50 §8 holdout: 192 / 39. Holdout rows whose two parents are each a guest or a matched roster veteran.
  - 50 §8 on both sides: 157 / 39.
  - The filter drops exactly the rows with an unmatched non-guest parent. It gives the same row set on both rosters.
- **Assertions on the ×1.3 roster:**
  - In each population the argmin lies in [1.23, 1.37], i.e. at least 0.03 inside both band edges.
  - MAE at 1.2 and at 1.4 is greater than at the argmin.
  - MAE at 1.0 is greater than at 1.2, and MAE at 2.0 is greater than at 1.4, so the minimum is interior.
  - The [1.0, 2.0] grid gives the same argmin.
  - The band also holds at fixed λ 0.1/1, 1/0.1 and 1/1.
- **Assertions on the base roster:** in each population |argmin − 1| ≤ 0.06, and the argmin is below 1.17.
- **Result.** ×1.3 argmin **1.34 / 1.34 / 1.33**: 0.06 to 0.07 inside the upper edge and 0.13 to 0.14 above the lower edge.
- **Measured base-roster bias** (source: the finite-sample nuisance correlation above): **+0.04 / +0.05 / +0.03** (argmin 1.04 / 1.05 / 1.03). On dae3cc5 it was +0.10.
- **Robustness** (`--splits`): over 40 alternative seeded 80/20 splits (not the stored split; informational, not tuned against):
  - ×1.3 argmin 1.31–1.38 (median 1.32), 40/40 in the band;
  - ×1.3 with the 50 §8 population on both sides: 1.29–1.36, 40/40;
  - base: 1.01–1.06 (median 1.02).
- The future T15 criterion is holdout MAE as 50 §8 says. Train CV is no longer offered as the evidence.

**Documentation corrected.**

- `truth.calibration.note` no longer says "calibration should suggest ×1.2–1.4". It states that the note is not a promise about production T15, and points to `calibration.test.ts` and this section. A test asserts that.
- The round-1 "argmin 1.40" block and the round-1 remaining-gap line are marked SUPERSEDED in place, with the reason. The history is kept.

### S1: fixed. λ table re-captured from the frozen final data and code

The round-1 table is marked SUPERSEDED in place. Exact output of `node packages/engine/test/golden/diagnostics.ts`, run after the last data/code change (the RECOVERY block):

```
CV λ per stat: spd 0.1/0.1, sta 0.1/0.1, pow 0.1/0.1, gut 0.1/0.1, wit 0.1/1
λ 0.1/0.1: worst 5.05% (run-my-way-gold-city.wit 40->37.98); fails(≥15%) 0; max |zero-card| 2.50
λ 0.1/1: worst 5.61% (tracen-reception-tazuna-hayakawa.pow 40->42.24); fails(≥15%) 0; max |zero-card| 2.69
λ 0.1/10: worst 13.78% (tracen-reception-tazuna-hayakawa.pow 40->45.51); fails(≥15%) 0; max |zero-card| 6.04
λ 1/0.1: worst 6.16% (run-my-way-gold-city.wit 40->37.53); fails(≥15%) 0; max |zero-card| 2.32
λ 1/1: worst 5.62% (run-my-way-gold-city.wit 40->37.75); fails(≥15%) 0; max |zero-card| 2.32
λ 1/10: worst 8.98% (tracen-reception-tazuna-hayakawa.pow 40->43.59); fails(≥15%) 0; max |zero-card| 5.09
λ 10/0.1: worst 16.96% (beyond-this-shining-moment-silence-suzuka.pow 40->33.22); fails(≥15%) 2; max |zero-card| 6.18
λ 10/1: worst 17.11% (beyond-this-shining-moment-silence-suzuka.pow 40->33.16); fails(≥15%) 1; max |zero-card| 5.89
λ 10/10: worst 17.70% (beyond-this-shining-moment-silence-suzuka.pow 40->32.92); fails(≥15%) 1; max |zero-card| 5.52
λ 100/0.1: worst 56.51% (beyond-this-shining-moment-silence-suzuka.pow 40->17.40); fails(≥15%) 21; max |zero-card| 21.99
λ 100/1: worst 56.62% (beyond-this-shining-moment-silence-suzuka.pow 40->17.35); fails(≥15%) 21; max |zero-card| 21.67
λ 100/10: worst 58.35% (beyond-this-shining-moment-silence-suzuka.pow 40->16.66); fails(≥15%) 22; max |zero-card| 19.43
λ CV: worst 4.65% (tracen-reception-tazuna-hayakawa.pow 40->41.86); fails(≥15%) 0; max |zero-card| 2.50
```

- The it.each margin test (worst < 10%, zero-card < 8) now covers λ 0.1/0.1, 0.1/1, 1/0.1, 1/1 and 1/10.
- **λ 0.1/10 is the documented thin-margin grid point:** worst 13.78%, about 1.2 points inside ±15%. A heavy base penalty shrinks the intercept and scenario columns, and the friend card Tazuna (+40 on all stats) absorbs part of that. Its own test asserts every effect within ±15% and zero-cards < 8, not the 10% margin bound.
- λ_id ≥ 10 fails, as in round 1.

### S2: fixed. No generator → test-code dependency; derived values labelled

- The diagnostic moved to `packages/engine/scripts/golden-diagnostic.ts`. Its runtime imports are `../src/index.ts` and `@uma/schema`.
- `test/golden/t06-diagnostic.ts` (the round-1 file) was deleted, after confirming nothing imports it.
- `golden.ts` and the tests import the scripts copy.
- New test `files.test.ts > review round 2 S2`:
  - no `scripts/golden*.ts` imports anything under `test/`;
  - `golden-diagnostic.ts`'s relative imports are exactly `['../src/index.ts']`;
  - its bare imports are exactly `['@uma/schema']`.
- The browser-safety walk of `golden-context.ts` now also asserts that `golden-diagnostic.ts` is not in its graph. There is no cycle: `golden-diagnostic.ts` imports neither `golden.ts` nor `golden-context.ts`.
- `truth.holdout.coverageDiagnostic.status` = `"DERIVED self-consistency metadata, not independent proof"`. Its definition and limitations say so too.
- In `planted.test.ts`, the S3 test asserts the band from its own recomputation first. A separate, commented block then checks that truth.json matches, as self-consistency only.

### S3: fixed. Coverage under every variance definition, recorded from the final data

Definitions are in `truth.holdout.coverageDiagnostic.variants.definition` and `scripts/golden-diagnostic.ts`:

- All variants: 80% normal interval around the train-only ridge prediction (CV λ), on 48 holdout rows × 5 stats = 240 cells.
- **sandwich (stored, unchanged):** σ̂² = Σw r² / Σw(1−h) from the train residuals, × (1 + sandwich factor).
- **literal 50 §4:** var_k = residualCov[k][k], where residualCov is the recency-weighted (holdout weights), centred covariance of the holdout residuals.
- **+Var[inh]:** residualCov[k][k] + the engine's Var[inh_k | row lineage]. This is 50 §4 + §5/§7 read literally, and it double counts.
- **+Var[inh] net:** residualCov[k][k] − holdout-weighted mean Var[inh_k] + the row's Var[inh_k].
- **train plug-in:** uncentred Σw e²/Σw over the train residuals, with no leverage or sandwich correction.

Exact output (COVERAGE block of `diagnostics.ts`; the same values are stored in truth.json and re-checked by the test):

```
sandwich (stored)  pooled 0.8417 (margins 0.1217 / 0.0383) per-stat 0.7917,0.8333,0.8542,0.8333,0.8958
literal 50§4       pooled 0.7917 (margins 0.0717 / 0.0883) per-stat 0.7708,0.7917,0.7917,0.8125,0.7917
+Var[inh]          pooled 0.9000 (margins 0.1800 / -0.0200) per-stat 0.8958,0.8958,0.8750,0.9375,0.8958
+Var[inh] net      pooled 0.7292 (margins 0.0092 / 0.1508) per-stat 0.7500,0.7292,0.7500,0.7708,0.6458
train plug-in      pooled 0.7208 (margins 0.0008 / 0.1592) per-stat 0.6875,0.6875,0.7292,0.7083,0.7917
residualCov diag 71.00,59.80,58.96,84.94,66.94; train plug-in var 48.22,43.64,50.34,56.11,67.46; mean holdout Var[inh] 32.32,39.02,35.65,67.00,47.29; sandwich sd 7.85,7.47,8.02,8.47,9.26
```

Margins are "above 0.72 / below 0.88". The sandwich and literal definitions are inside the band. The other three are not safely inside:

- residualCov + Var[inh] over-covers at 0.900, outside the band, because it double counts.
- The net variant sits 0.009 above the floor.
- The train plug-in sits 0.0008 above the floor.

Recorded as **Q-123** (T06 must choose its definition). Tests assert:

- the recorded variants equal the recomputation;
- literal is inside the band;
- +Var[inh] ≥ literal.

### N1: fixed

In `chooseLambda`, the recency weights (one train-only clock, the newest row of the fit set) and the 5 fold partitions with their weight vectors are now computed once, outside the λ grid and the fold loop. The values are identical, so the CV choice is unchanged: spd/sta/pow/gut 0.1/0.1, wit 0.1/1. No holdout row enters the clock.

### N2: fixed

A comment on `expect(c.lambdaId).toBeLessThanOrEqual(1)` says it encodes this synthetic dataset's tested recoverable region: λ_id ≥ 10 gives a worst error of 16.96–58.35% in the table above. It is not a universal rule for a 50 §4 estimator.

### N3: fixed

Q-122 has an update. The zero-effect cards' effective contribution β_id + β_type is the independent check on pooling bleed. Current output: max |zero-card| is 2.50 at the CV λ, 2.32–2.69 at 0.1/1, 1/0.1 and 1/1, 5.09 at 1/10 and 6.04 at 0.1/10, against a smallest planted effect of 40. The test asserts < 8.

### Best/trap pair after the retune

From a temporary `process.stderr.write` in the existing pMeet test, removed afterwards (`cmp` against the saved copy confirmed the restore):

```
BESTDBG 0.29329563730426295 0.027261076800623726 0.023445457918496913 ratio 10.758769341699386 trapRank 25724 blue 18 16 pairs 32667
```

- The best pair is #1 (pMeet 0.293).
- The trap ranks 25724 (0-based) and has the unique maximum of 18 blue stars against 16 for the next pair.
- **Thin margin:** the runner-up ratio is 10.76×, against the existing ">10×" assertion (it was about 34× at dae3cc5). Four events raise every best1 pair's medium-A probability. The assertion is unchanged and passes, but the margin is about 8%.

### Round 2 files

- Created:
  - `packages/engine/scripts/golden-diagnostic.ts` (moved from the test directory; plus coverage variants and the N1 hoist);
  - `packages/engine/test/golden/calibration.test.ts`;
  - `packages/engine/test/golden/calibration-diagnostic.ts`;
  - `packages/engine/test/golden/diagnostics.ts` (executable);
  - `packages/engine/test/golden/root-cause.ts` (executable, diagnosis only).
- Deleted: `packages/engine/test/golden/t06-diagnostic.ts`.
- Modified:
  - `packages/engine/scripts/golden.ts`;
  - `packages/engine/scripts/golden-context.ts` (types only);
  - `packages/engine/test/golden/{planted,files}.test.ts`;
  - the regenerated golden JSON files and the `apps/web/fixtures/*.json` copies;
  - `docs/OPEN_QUESTIONS.md` (Q-122 update, Q-123);
  - this changelog.
- Not touched: engine `src/`, specs, `packages/schema`, `apps/web` runtime/config, the published master bundle, `package.json`, the lockfile.

### Round 2 verification

Node v25.9.0, pnpm 11.22.0, run from the worktree root after the final data and code freeze.

Reproduce every feasibility claim in this section:

```
node packages/engine/test/golden/diagnostics.ts --splits     # calibration, λ table, coverage, alt splits
node packages/engine/test/golden/root-cause.ts               # base-roster attribution (final data)
node packages/engine/test/golden/root-cause.ts --calibration # ×1.3 attribution (final data)
node packages/engine/test/golden/root-cause.ts --baseline [--calibration]   # dae3cc5 attribution
```

CALIBRATION block (exact):

```
base | 50§4 split (train 192 / holdout 48 eligible rows) | n 192/48 | argmin 1.04 MAE 31.99 | MAE@1.0 33.30 @1.2 47.27 @1.3 65.28 @1.4 85.36 @2.0 215.90 | per-stat argmin 1.09,1.05,1.05,1.03,1.03
base | 50§4 train / 50§8 holdout (matched-or-guest holdout rows only) | n 192/39 | argmin 1.05 MAE 32.95 | MAE@1.0 34.37 @1.2 48.00 @1.3 66.47 @1.4 87.17 @2.0 221.87 | per-stat argmin 1.09,1.06,1.04,1.07,1.03
base | 50§8 train / 50§8 holdout (matched-or-guest rows on both sides) | n 157/39 | argmin 1.03 MAE 35.73 | MAE@1.0 36.24 @1.2 52.48 @1.3 72.55 @1.4 94.42 @2.0 236.82 | per-stat argmin 1.00,1.02,1.04,1.07,1.00
x1.3 | 50§4 split (train 192 / holdout 48 eligible rows) | n 192/48 | argmin 1.34 MAE 36.31 | MAE@1.0 81.93 @1.2 47.18 @1.3 37.85 @1.4 37.87 @2.0 149.09 | per-stat argmin 1.36,1.37,1.35,1.34,1.34
x1.3 | 50§4 train / 50§8 holdout (matched-or-guest holdout rows only) | n 192/39 | argmin 1.34 MAE 37.76 | MAE@1.0 85.02 @1.2 48.85 @1.3 39.38 @1.4 38.98 @2.0 152.82 | per-stat argmin 1.35,1.38,1.35,1.38,1.34
x1.3 | 50§8 train / 50§8 holdout (matched-or-guest rows on both sides) | n 157/39 | argmin 1.33 MAE 41.04 | MAE@1.0 89.03 @1.2 51.17 @1.3 41.64 @1.4 43.20 @2.0 164.58 | per-stat argmin 1.31,1.32,1.34,1.38,1.30
== CALIBRATION argmin vs fixed λ (stored split / 50§8 both sides)
λ 0.1/0.1: base 1.04 | base§8 1.03 | x1.3 1.34 | x1.3§8 1.33
λ 0.1/1: base 1.04 | base§8 1.03 | x1.3 1.35 | x1.3§8 1.33
λ 0.1/10: base 1.02 | base§8 1.03 | x1.3 1.32 | x1.3§8 1.32
λ 1/0.1: base 1.04 | base§8 1.02 | x1.3 1.34 | x1.3§8 1.32
λ 1/1: base 1.03 | base§8 1.02 | x1.3 1.34 | x1.3§8 1.33
λ 1/10: base 1.02 | base§8 1.02 | x1.3 1.32 | x1.3§8 1.31
λ 10/1: base 1.02 | base§8 0.99 | x1.3 1.33 | x1.3§8 1.29
== ROBUSTNESS: 40 alternative seeded 80/20 splits of the 240 eligible rows (not the stored split)
base   argmin min 1.01 median 1.02 max 1.06 mean 1.0203 in[1.2,1.4] 0/40
x13    argmin min 1.31 median 1.32 max 1.38 mean 1.3240 in[1.2,1.4] 40/40
base8  argmin min 1.00 median 1.02 max 1.05 mean 1.0173 in[1.2,1.4] 0/40
x138   argmin min 1.29 median 1.32 max 1.36 mean 1.3198 in[1.2,1.4] 40/40
```

Note on the ×1.3 50 §4 split: MAE at 1.40 (37.87) is only 0.02 above MAE at 1.30 (37.85). The minimum is at 1.34, but the criterion is flat between about 1.30 and 1.40.

ROOT-CAUSE (ablation lines; the CORR lines are quoted above; full output from the commands):

```
== root-cause                 ABLATION clean 1 / noise 1.02 / activation 1.01 / combined 1.04 ; WEIGHT/PENALTY 1.04 1.04 1.04 1.04
== root-cause --calibration   ABLATION clean 1.3 / noise 1.32 / activation 1.32 / combined 1.34 ; WEIGHT/PENALTY 1.34 1.34 1.34 1.34
== root-cause --baseline      ABLATION clean 1 / noise 1.06 / activation 1.03 / combined 1.09 ; WEIGHT/PENALTY 1.1 1.09 1.1 1.09
== root-cause --baseline --calibration  ABLATION clean 1.3 / noise 1.36 / activation 1.34 / combined 1.41 ; WEIGHT/PENALTY 1.41 1.41 1.41 1.41
```

Workspace and determinism (real output, trimmed):

```
$ pnpm install --frozen-lockfile
Scope: all 6 workspace projects
Already up to date
Done in 306ms using pnpm v11.22.0

$ pnpm --filter @uma/engine golden            # run 1
6a02f36050f92899f55ffc2a78ab355d12b545c0b41888e6b7e110619c707911  packages/engine/test/golden/roster.json  (1299631 bytes)
8982ab4aba43c4c770fc41260361a29255e2cccd57a5b3db70075c23f94f5434  packages/engine/test/golden/roster.calibration-x1.3.json  (1299636 bytes)
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  packages/engine/test/golden/targets.json  (432 bytes)
1ccf0d5a9c2b1fb6d9626126c22a0a2c4d9eb634af79457097a6dc68eceed0b2  packages/engine/test/golden/truth.json  (279858 bytes)
6a02f36050f92899f55ffc2a78ab355d12b545c0b41888e6b7e110619c707911  apps/web/fixtures/roster.json  (1299631 bytes)
3e3f864406d69474f1df622cb690c1b7d995e940adcaf4b772d003e9e1a60bcf  apps/web/fixtures/cm-targets.json  (432 bytes)
1ccf0d5a9c2b1fb6d9626126c22a0a2c4d9eb634af79457097a6dc68eceed0b2  apps/web/fixtures/golden-truth.json  (279858 bytes)
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
packages/engine test:  Test Files  8 passed (8)
packages/engine test:       Tests  135 passed (135)

$ cd packages/engine && npx vitest run test/golden
 Test Files  3 passed (3)
      Tests  61 passed (61)

$ npx prettier --check packages/engine/scripts packages/engine/test/golden apps/web/fixtures packages/engine/package.json docs/changelog/T08-golden-dataset.md
All matched files use Prettier code style!
$ npx prettier --check docs/OPEN_QUESTIONS.md
[warn] docs/OPEN_QUESTIONS.md        # pre-existing: `git show dae3cc5:docs/OPEN_QUESTIONS.md` warns identically
$ git diff --check && echo diffcheck-ok
diffcheck-ok
$ git status --short apps/web/public packages/engine/src docs/specs packages/schema
(empty)
```

### Remaining gaps (round 2)

- **Holdout-MAE flatness.** On the ×1.3 stored split, MAE at 1.30 and at 1.40 differ by only 0.02, although the argmin (1.34) is 0.06 inside the edge. T15 should report the curve and its margin, not only the argmin.
- **Base-roster bias.** It is +0.03 to +0.05 on the stored split, and +0.01 to +0.06 over 40 alternative splits. It comes from finite-sample nuisance correlation at n = 48 / 39. It is reduced, not removed.
- **Best-pair runner-up ratio.** It is now 10.76× against the ">10×" assertion (about 8% margin; it was about 34×). More than 4 synthetic events break it, which is why 4 were chosen.
- **λ 0.1/10.** Recovery passes ±15% with about 1.2 points of margin (13.78%). λ_id ≥ 10 still fails; recovery is only proven for λ_id ≤ 1.
- **Coverage depends on T06's variance definition (Q-123).** residualCov + Var[inh] gives 0.900, outside the band. The train plug-in is 0.0008 above the floor.
- **Not production code.** The calibration check is TEST-ONLY. It is not the production T15 and does not cover the aptitude and skill checks of 50 §8.
- **Unchanged follow-ups from round 1.** Clipping is not exercised (N2). S4 fixture serving remains a T13/T02 follow-up.
