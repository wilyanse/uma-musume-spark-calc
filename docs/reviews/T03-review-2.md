# T03 review, round 2 (claude-opus-5-5, high)

## Verdict: PASS

## Blocking
(none)

Both round-1 Blocking items are fixed, and I checked each one myself rather than relying on the changelog:
- B1: `packages/master-data/src/build.ts:126` now hashes `tex_support_card_<id>.png`, and the comment in `src/art-crop.ts` has been corrected. SOURCES.md:26 and Q-5 were updated, and a screenshot-13 test is at `test/bundle.test.ts:290`. I checked the whole grid on screenshot 13 (20 tiles): the first tile matches its own card at Hamming 7 with a 12-bit gap to the runner-up. Every tile I could name by eye (Dream Big Tokai Teio, Seiun Sky ×2, Grass Wonder, Mejiro McQueen, Vodka, Daiwa Scarlet) is nearest its own card.
- B2: `src/normalize.ts:210-238` reserves every pinned ID up front, looks up pins before slugs, rejects duplicate pins (:218) and keeps retired pins (:236). `overrides/ids.json` has 1704 pins, no duplicate values, and every character, outfit, skill, spark, card, scenario and epithet ID in the bundle is pinned. I repeated my round-1 repro on a scratch copy (marked JP skill 120461 "Forward March!" as released and rebuilt offline). Existing IDs changed: none in skills, sparks, outfits, cards or characters. The new skill got `skill:forward-march-2`. I also compared gameId→id between the round-1 bundle (1c7d331) and HEAD: 0 IDs changed in any file.

## Should fix
- [S1] `packages/master-data/test/bundle.test.ts:290-298`: only one tile at one exact offset is checked, and the card-art match is sensitive to where the crop sits. On tile 1, shifting x by −3 px gave the wrong nearest card in all three y positions (e.g. `tracen-academy-ines-fujin`, d21, gap 1). Shifting x by +3 px was fine. Across the grid, 5 of 20 tiles have a gap of ≤3 bits between the nearest and second-nearest card (e.g. row 4 col 4 gives d18, gap 1). Recommendation: put the grid positions and this offset sensitivity into Q-5 so T09/T15 know the crop must be aligned to within a few pixels. Optionally add 2–3 more named tiles to the test.
- [S2] `packages/master-data/src/build.ts:86`: `--replace` rewrites a published `global-<date>` folder in place, so a version's files and sha256 values can change under the same version string. That breaks the contract that a version identifies its content, which clients caching by version rely on. It is fine this time because the bundle was never merged. Recommendation: say in the README that `--replace` is only for versions not yet merged or published (the README currently says "use for fixes within a version"), or refuse `--replace` when the folder is already committed.
- [S3] `docs/changelog/T03-master-data.md:17`: the Files list still says `fetch.sh` was created and "kept because it was in-progress work", which contradicts :76 and :90 (deleted). Also, the Summary (:9) still says 1580 vocab entries, but the rebuilt bundle has 1579 (the duplicate "Ura Finale" scenario text was dropped by the S4 fix). Update both.

## Nits
- [N1] `packages/master-data/src/normalize.ts:537`: the source string repeats "spark copy-rate table spark copy-rate table", and the doubled text is copied into all 7 source strings in `rules.json`.
- [N2] `packages/master-data/test/bundle.test.ts:300-310`: the portrait test only asserts top-3. The measured rank is 1st, so `toBeLessThan(2)` would still leave slack while catching more regressions. This is optional.
- [N3] `packages/master-data/test/bundle.test.ts:297`: the margin assertion (≥5) sits close to what I measured under ±3 px jitter (gaps of 4–7 on the offsets that stayed correct). It passes at the exact box and is fine as a regression guard, but it will be brittle if the crop box is ever retuned.

## Checklist
1 Spec conformance: ok
  - 20 §5: zod validation, the dangling-reference tests, all 27 names and SOURCES.md (URLs, fetch date, gaps, per-field sources for rules.json) are all present.
  - 20 §4: the art hash now matches the agent's tile crop (B1 fixed).
  - 01 §1: IDs are stable across versions (B2 fixed, and my repro confirms it).
  - The S4 casing fix gives "URA Finale" and keeps `scenario:ura-finale`.
  - The output JSON is committed and `.cache/` is gitignored (`.gitignore:18`).
  - The declared deviations (Q-4 `vocab-cards.json`, `inheritanceTurns: []`) are unchanged.
2 Correctness: ok
  - Pins cannot drift: duplicates throw, and a rebuild reproduces `ids.json` exactly.
  - S7 is fixed: only successful fetches are cached (`build.ts:58-64`).
  - The green-spark and outfit links are intact.
  - The only vocab content change since round 1 is removing the "Ura Finale" text.
3 Test quality: ok
  - The S1/S2 test weaknesses from round 1 are fixed: the PNG-magic check, the size bound, and the green target being checked against outfit unique skills and outfit gameIds.
  - The new B2 tests include a guard that reproduces the old bug when no pins are given.
  - The screenshot tests use real images; there is a crop-sensitivity caveat (S1).
  - The changelog numbers match my re-run (124/124 and 82/82 tests; lint and typecheck clean).
4 Fabrication check: ok
  - Every `rules.json` value is still `verified:false`.
  - The citation now names the page, the fetch date and a quoted snippet (S8).
  - No fixture answers are hard-coded in `src/`.
5 Security: ok
  - No secrets, and no image bytes in the bundle (checked by test).
  - Images are hashed in memory only; the cache is gitignored.
6 Free-tier constraints: ok
  - The bundle is static JSON (under 3 MB, asserted in a test), with no services.
7 Scope: ok
  - The diff touches only `packages/master-data/**`, `apps/web/public/master/**`, `docs/OPEN_QUESTIONS.md` and the changelog.
  - The OPEN_QUESTIONS.md changes against main are additions only (0 removed lines); Q-5 was reworded within T03's own appended entry.
  - `pnpm-lock.yaml` is the declared cross-task edit (it only adds sharp).
8 Maintainability: ok
  - `fetch.sh` has been removed and the misleading `art-crop.ts` comment corrected.
  - `localeCompare` is gone from `src/`.
  - The C# `long` note (N3) and the Node ≥ 22.18 requirement (N4) are documented.
  - Remaining items: a stale changelog line (S3) and a doubled source string (N1).

## Commands run
```
$ git log --oneline main..HEAD
85d828d T03: changelog wording
35e7d1f T03: fix review round 1 (portrait card hashes, stable IDs, S1-S8, N1-N4)
1c7d331 T03: master data build, Global bundle, SOURCES, tests, changelog
81ee830 T03: dHash definition, art crops, cross-checked test vectors
fb974b5 T03: add sharp dependency and exploratory fetch.sh helper
843119c T03: master-data package skeleton with schema-derived types

$ git diff --stat main...HEAD
 34 files changed, 47088 insertions(+)  (apps/web/public/master/**, docs/OPEN_QUESTIONS.md, docs/changelog/T03-master-data.md, packages/master-data/**, pnpm-lock.yaml)

$ node --version
v25.9.0
$ pnpm -r lint
packages/schema lint: Done
packages/master-data lint$ eslint src test vitest.config.ts
packages/master-data lint: Done
$ pnpm -r typecheck
packages/schema typecheck: Done
packages/master-data typecheck: Done
$ pnpm -r test
packages/schema test:  Test Files  4 passed (4)
packages/schema test:       Tests  124 passed (124)
packages/master-data test:  Test Files  3 passed (3)
packages/master-data test:       Tests  82 passed (82)

$ python3 (ids.json + bundle pin coverage)
pins 1704 dupvals []
Counter({'skill': 623, 'spark': 395, 'card': 255, 'epithet': 252, 'outfit': 107, 'character': 68, 'scenario': 4})
characters 68 unpinned 0 / outfits 107 unpinned 0 / skills 623 unpinned 0 / sparks 395 unpinned 0 / cards 255 unpinned 0 / scenarios 4 unpinned 0 / epithet 252 unpinned 0

$ python3 (gameId->id, 1c7d331 vs HEAD)
characters 68 68 changed 0 / outfits 107 107 changed 0 / skills 623 623 changed 0 / sparks 395 395 changed 0 / cards 255 255 changed 0
arthash changed 255 empty 0
vocab - {('scenario', 'scenario:ura-finale', 'Ura Finale')} + set()

$ (scratch copy) node src/build.ts --offline --replace --date 20260930 ; diff -r apps/web/public/master <worktree> ; diff overrides/ids.json <worktree>
  vocab: 1579 / rules: 10 / vocab-cards: 510
gaps: 28 (see .cache/gaps.txt)
OFFLINE_REBUILD_IDENTICAL_INCL_IDS

$ (scratch copy) un-mark skill 120461 unreleased, set name_en; node src/build.ts --offline --replace --no-images --date 20260930
{'id': 201682, 'name_en': 'Forward, March!', ...}  {'id': 120461, 'enname': 'Forward March!', 'unreleased': ['en'], ...}
gaps: 29 (see .cache/gaps.txt)
skills changed [] new [(120461, 'skill:forward-march-2')]
sparks changed [] new [] / outfits changed [] new [] / cards changed [] new [] / characters changed [] new []

$ (scratch) node .cache/probe.ts   (screenshot 13, 5x4 grid, CARD_ART_CROP, nearest id / distance / gap to runner-up)
the-brightest-star-in-japan-special d7 m12 | passing-the-dream-on-team-sirius d16 m3 | take-hold-of-our-dreams-special-wee d14 m2 | tracen-academy-sweep-tosho d16 m2 | searching-for-unseen-sights-silence d10 m9
dream-big-tokai-teio d6 m13 | teio-oo-oo-tokai-teio d6 m15 | sentimental-flare-maruzensky d11 m7 | get-lots-of-hugs-for-me-oguri-cap d17 m3 | that-time-i-became-the-strongest-go d15 m5
wild-rider-vodka d8 m9 | mini-vacation-daiwa-scarlet d10 m9 | fairest-fleur-grass-wonder d8 m12 | your-team-ace-mejiro-mcqueen d14 m9 | two-pieces-narita-brian d17 m3
foolproof-plan-seiun-sky d2 m19 | paint-the-sky-red-seiun-sky d10 m11 | wave-of-gratitude-fine-motion d17 m4 | tracen-academy-nakayama-festa d18 m1 | party-formation-mayano-top-gun d14 m5
-3,-3:card:tracen-academy-ines-fujin d21 m1  -3,0:card:pal-assisted-training-mihono-bourbon d17 m2  -3,3:card:it-s-all-mine-sweep-tosho d18 m1  0,-3:OK d15 m4  0,0:OK d7 m12  0,3:OK d13 m7  3,-3:OK d14 m4  3,0:OK d4 m14  3,3:OK d15 m6
distinct arthashes 255 of 255

$ git diff main...HEAD -- docs/OPEN_QUESTIONS.md | grep -E '^-[^-]' | wc -l
0
$ git check-ignore -v packages/master-data/.cache
.gitignore:18:packages/master-data/.cache/	packages/master-data/.cache
$ git status --short   (worktree, after all probes; probes ran in a scratch copy, since deleted)
(clean)
```
