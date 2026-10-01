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

Inheritance runs only through T05's public API (`loadContext`, `planInheritance`, `sampleInheritance`). Synthetic turns are added through a scenario plugin. Inheritance math is not re-implemented. 34 tests in `packages/engine/test/golden/` check every planted property independently of the generator: schema, fingerprint, determinism, legality, best/trap pair, OLS card-effect recovery, noise covariance, modes, skill rates, the calibration variant and the fixture copies.

## Files

Created:

- `packages/engine/scripts/golden.ts`: the generator. It exports `generateGolden`, `writeGolden` and `loadGoldenContext(master, truth, multiplier)`. `loadGoldenContext` is the single way T06/T15 should rebuild the generator's engine context from `truth.json`.
- `packages/engine/test/golden/roster.json`: 260 `RosterVeteran`s (1.29 MB).
- `packages/engine/test/golden/roster.calibration-x1.3.json`: the same roster with `blueStatGain` × 1.3.
- `packages/engine/test/golden/truth.json`: the planted parameters, roster composition, best/trap pair, holdout split and latent components (241 KB).
- `packages/engine/test/golden/targets.json`: `CmTarget[]` holding `golden-cm-1`.
- `packages/engine/test/golden/load.ts`: test loaders and the typed `Truth` view.
- `packages/engine/test/golden/files.test.ts`: schema, master IDs, fingerprints, ranks, target, determinism, sha256 records, fixture copies, sizes.
- `packages/engine/test/golden/planted.test.ts`: legality, lineage, skill X, best/trap pair, training model, OLS recovery, noise, modes, skills, synthetic inputs, calibration, realism.
- `apps/web/fixtures/roster.json`, `apps/web/fixtures/cm-targets.json`, `apps/web/fixtures/golden-truth.json`: copies, not symlinks.

Modified:

- `packages/engine/package.json`: added `"golden": "node scripts/golden.ts"` and the devDependency `prettier: 3.9.9`. The generator imports prettier to serialise JSON, and the version is pinned to the root's version.
- `pnpm-lock.yaml`: the matching importer entry (4 lines).
- `docs/OPEN_QUESTIONS.md`: added Q-120 and Q-121.
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
  - Baseline: spd 760, sta 560, pow 700, gut 380, wit 520.
  - Independent intercept: spd −30, sta −20, pow −30, gut −15, wit −25 (total −120). Manual is 0.
  - Scenario intercepts: URA 0; the others are in truth.json.
- **12 planted cards** (atLb4; the lowest SSR gameIds of each type, excluding the trainee's character):

  | Card                                      | Type    | Effect at LB4         |
  | ----------------------------------------- | ------- | --------------------- |
  | beyond-this-shining-moment-silence-suzuka | speed   | spd +80, pow +40      |
  | dream-big-tokai-teio                      | speed   | spd +64               |
  | run-my-way-gold-city                      | speed   | spd +56, wit +40      |
  | breakaway-battleship-gold-ship            | stamina | sta +72, gut +40      |
  | foolproof-plan-seiun-sky                  | stamina | sta +60               |
  | wild-rider-vodka                          | power   | pow +70, sta +40      |
  | champion-s-passion-el-condor-pasa         | power   | pow +56               |
  | the-brightest-star-in-japan-special-week  | guts    | gut +64, pow +40      |
  | watch-my-star-fly-ines-fujin              | guts    | gut +50               |
  | wave-of-gratitude-fine-motion             | wit     | wit +64, spd +40      |
  | 7-more-centimeters-air-shakur             | wit     | wit +50               |
  | tracen-reception-tazuna-hayakawa          | friend  | +40 to all five stats |

  There are also 12 zero-effect SSR cards. Each deck takes a uniform 2–5 planted cards, then zero-effect cards. Characters in a deck are distinct and never the veteran's own. 70% of decks have one borrowed slot (LB4). Owned LB follows a seeded timeline, so a card's LB rises over dateAcquired.

- **Noise.** MVN with sd [9, 8, 9, 7, 8] and the correlation matrix in truth.json. The covariance is stored as corr·sd·sd and is checked positive-definite through Cholesky. Each draw is `L·z` from Box–Muller normals.
- **Skills.** `hinted` = deck hint/event skills ∪ outfit innate skills ∪ the veteran's sampled inheritance hints (`latent[id].inheritanceHints`), minus the unique skill. Each hinted skill is acquired with `rates[mode][skill]`. The rates are Beta draws per mode (independent Beta(3,7), manual Beta(5,5)) over all master skills and are listed exactly in truth.json. The unique skill is always acquired, with a synthetic level from 1 to 6.
- **Modes.** Exactly 156 independent and 104 manual (60/40). The 4 planted veterans are manual. Which general veterans are independent is decided by a seeded permutation. The epithet follows 01 §6, except for 9 rows with `modeSource:'override'`, which are listed in truth.json.
- **Realism for T06.**
  - 20 low-confidence rows (min confidence 0.60–0.89). 12 of them miss one parent's sparks, which are listed in `truth.roster.unreadParentSparks`.
  - Parent kinds: 277 matched, 194 guest and 49 unmatched non-guest. A matched parent is always an earlier, complete general veteran, so `legacyFromVeteran(matched roster record)` is exactly the lineage the generator used. Guests have no grandparents.
  - dateAcquired runs from 2025-10-02 to 2026-09-25. `capturedAt` is 0–20 days after dateAcquired.
  - All 4 scenarios are present. Ratings and ranks come from master `ranks`.
- **Holdout.** `HOLDOUT_SEED = 20260930`, fraction 0.2. The training-eligible ids (min confidence ≥ 0.9, 240 rows) are sorted, Fisher–Yates shuffled with `mulberry32(20260930)`, and the first ceil(20%) are held out: 48 holdout, 192 train. Both lists are stored sorted in `truth.holdout`.
- **Calibration variant.** It uses the same streams, so ids, decks, sparks, skills, aptitudes, noise and activation draws are identical. Only blue activation gains differ, and with them stats, rating, rank and fingerprint. Its latent components are in `truth.calibration.latent`, and its sha256 is in `truth.calibration.sha256`. Only the ×1.3 variant is generated.
- **Web fixture names.** The web client maps `/api/v1/<x>` to `/fixtures/<x>.json` (`apps/web/src/api/client.ts`), so the copies are `roster.json`, `cm-targets.json` and `golden-truth.json`. They are copies, not symlinks: a test checks `lstat().isSymbolicLink() === false` and byte equality. The 1.3 MB calibration roster is not copied to the web fixtures.
- **Independent checks in the tests.**
  - pMeet is computed independently with a Gaussian fast-pass. It uses the planted training mean and covariance, plus the engine's closed-form `aptitudeDist`, `skillHintProb`, `expectedStatGain` and `statGainCov`, over all 32,667 legal pairs.
  - Card effects are re-fitted by OLS (normal equations plus Gauss–Jordan, written in the test).
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
