# T03 review, round 1 (claude-opus-5-5, high)

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] packages/master-data/src/build.ts:123, packages/master-data/src/art-crop.ts:10 — The card `artHashes` come from GameTora's `support_card_s_<id>.png`. That file is a 128×128 square face close-up, not the tile art, so it can't satisfy 20 §4 ("The hash must match the agent's tile crop"). I checked this on screenshot 13. I took the first tile (The Brightest Star in Japan!, Special Week) and hashed it with `CARD_ART_CROP`. It is Hamming 34 from the committed hash `44cecece16564c7a` and ranks 180th of 255, and the three crop placements I tried all gave rank 148–180. GameTora also serves the full portrait art at `https://gametora.com/images/umamusume/supports/tex_support_card_<id>.png` (450×600, HTTP 200), with the same framing as the in-game tile. With the same crop, its hash is Hamming 7 from the tile. Q-5 treats the framing difference as unavoidable, but a matching source exists. The art-crop.ts comment claiming the thumbnail shares the tile's layout is wrong. Required fix:
  - Hash `tex_support_card_<id>.png` (in memory, as now).
  - Record that URL in SOURCES.md.
  - Correct the art-crop.ts comment and Q-5.
  - Add a test that crops the first tile from `docs/reference/screenshots/13-support-card-list.png` and asserts the nearest `artHashes` entry is `card:the-brightest-star-in-japan-special-week`.
- [B2] packages/master-data/src/normalize.ts:201-235, :221, :258 — IDs are not stable across versions, which violates 01 §1 ("stable across versions"). IDs are allocated in gameId order, and only slugs that already collide are pinned in `overrides/ids.json`. So when a new Global entity with a lower gameId shares a slug with an existing one, it takes the base ID and the existing entity is renamed. I reproduced this on a copy of the worktree:
  - I marked JP-only skill 120461 "Forward March!" as released and rebuilt offline.
  - Result: `changed ids for existing skills: [(201682, 'skill:forward-march', 'skill:forward-march-2')]`.
  - Global routinely gets JP content with lower IDs, so the next rebuild (which the changelog plans) could silently re-point `veteran_skills.skill_id`, spark IDs and CM targets.

  Required fix:
  - Seed the allocator with the previous bundle's `gameId → id` map, or pin every allocated ID, so existing IDs are reserved before new ones are assigned.
  - Add a normaliser test: an existing pinned ID keeps its value when a lower-gameId entity with the same slug appears.

## Should fix
- [S1] packages/master-data/test/bundle.test.ts:262-264 — The test "the committed bundle contains no image bytes" only checks that `gaps.txt` is absent, so its name overstates what it checks. The real check is the `.json`-only test at :50. Remove it or make it assert something real, e.g. no PNG magic bytes and total size under a bound.
- [S2] packages/master-data/test/bundle.test.ts:92-103 — The test "every green spark has a real unique skill" builds `uniqueSkillIds` but never checks green targets against it; it only repeats the `skillIds` check. Assert that `uniqueSkillIds.has(s.target.skillId)` and that `s.gameId` matches an outfit's gameId. I checked this on the data by hand and it holds (0 mismatches out of 107), so it's the test that's weak, not the data.
- [S3] packages/master-data/SOURCES.md:48 — SOURCES.md says `characterId` is omitted for "the 5 cards of non-playable/JP-only characters". The bundle actually has 54 cards without `characterId`. Most are characters not yet playable on Global (Twin Turbo, Zenno Rob Roy, Sirius Symboli, Daitaku Helios…), not just guides like Tazuna. Fix the count and the description. "SOURCES.md is complete" is a Done-when item.
- [S4] apps/web/public/master/global-20260930/scenarios.json:73 — The scenario `name` is "Ura Finale" (GameTora's casing), but the game and the spec write "URA Finale" (20 §2.7, and the spark name in sparks.json). Names should be exactly as in game: use `name_en_full`/spark casing, or add a casing override.
- [S5] packages/master-data/src/build.ts:118, :114 — Portrait identification is fragile and untested. I cropped the Legacy 1 portrait (Special Week) from screenshot 05 and hashed it with `VETERAN_ICON_CROP`. Over 48 crop offsets, Special Week ranged from rank 0 (best) to a median of rank 10. The `chr_icon` hashes are a different pose and expression from the in-game portrait, which adds noise. Add a screenshot-05 test that at least checks top-k, and consider dropping `chr_icon` or weighting it lower.
- [S6] packages/master-data/fetch.sh — This is superseded dead code: it reads `.cache/man.json`, which `src/fetch.ts` rewrites. Delete it; the changelog already lists this as a follow-up.
- [S7] packages/master-data/src/build.ts:62-66 — Failed image fetches are cached as `null` in `.cache/hashes.json`, so later builds never retry a transient 404/5xx. Don't cache failures, or re-fetch them when online.
- [S8] packages/master-data/SOURCES.md:29, normalize.ts:532 — Every `rules.json` activation value cites `…/chunks/2464-2e90db37675bc47e.js`, which now returns HTTP 404 (the build hash rotated). The values do match the code I read from the cached copy. Record the fetch date and a stable citation (the page URL plus a quoted snippet), since the source isn't durable.

## Nits
- [N1] normalize.ts:482-487 — `vocab`/`cardVocab` sort with `localeCompare` (ICU/locale-dependent). Use code-point comparison, as `byId` in build.ts:47 does, for guaranteed determinism across machines.
- [N2] vocab.json has ambiguous same-kind texts: "Carnival Bonus" (2 skill IDs) and "Indomitable" (gold vs unique). This should be documented for T09's matcher.
- [N3] dhash.ts:91 — The cross-multiplied sums reach about 2e14 for 1080p crops, which is safe in JS doubles. The C# mirror must use `long`; say so in the header.
- [N4] `node src/build.ts` needs TypeScript type stripping (unflagged only from Node 22.18). `engines` says `>=22`, so note the minimum in the README.

## Checklist
1 Spec conformance: issues
  - Zod validation, dangling-reference tests, the 27 names, latest.json sha256, LF endings and sort order are all met and re-verified.
  - Types were committed first (843119c).
  - The cache is gitignored.
  - Declared deviations: vocab-cards.json and `inheritanceTurns: []` (Q-4).
  - The 20 §4 art-hash requirement fails (B1). The 01 §1 ID stability contract fails (B2).
  - SOURCES.md is inaccurate (S3). Scenario name casing is off (S4).
2 Correctness: issues
  - ID allocation is unstable across versions (B2). Failures are cached (S7).
  - Green spark → outfit unique skill: correct (107/107).
  - ◯/◎/× variants are separate skills; glyph canonicalisation is correct.
  - The rank ladder is an assumption, flagged Q-6.
3 Test quality: issues
  - There are two weak or tautological tests (S1, S2), and no test checks hashes against real screenshots (B1, S5).
  - The dHash vectors are real: the independent Python implementation regenerates all 11 of 11.
  - The changelog's verification output matches my re-run (77/124 tests, lint/typecheck clean, offline rebuild byte-identical).
4 Fabrication check: ok
  - Activation tables and `1 + affinity/100` match GameTora's calculator code.
  - Blue initial bonus 5/12/21 matches the legacies article, which I fetched and read.
  - Unknown values are 0 with an UNKNOWN note, and everything is `verified:false`.
  - No fixture answers are hard-coded in production code.
5 Security: ok. No secrets, polite fetch with a UA, no images committed (JSON only in the bundle), `.cache/` gitignored.
6 Free-tier constraints: ok. A static 884 KB bundle, no services.
7 Scope: ok. The diff touches only `packages/master-data/**`, `apps/web/public/master/**` and `docs/OPEN_QUESTIONS.md` (append only). `pnpm-lock.yaml` is a declared cross-task edit that only adds sharp.
8 Maintainability: issues. There is dead `fetch.sh` (S6) and a misleading art-crop.ts comment (B1). Otherwise the structure is clean: a pure normaliser, a strict TS config and pinned deps (`sharp` 0.35.5).

## Commands run
```
$ git diff --stat main...HEAD
 35 files changed, 45429 insertions(+)   (apps/web/public/master/**, docs/OPEN_QUESTIONS.md, docs/changelog/T03-master-data.md, packages/master-data/**, pnpm-lock.yaml)

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
packages/master-data test:       Tests  77 passed (77)

$ python3 (regenerate dhash vectors with scripts/dhash_ref.py, compare)
python regen matches committed vectors: 11 / 11

$ (copy of worktree) node src/build.ts --offline --date 20260930 && diff -r global-20260930 global-20260930-2
  vocab: 1580 / rules: 10 / vocab-cards: 510
gaps: 28 (see .cache/gaps.txt)
IDENTICAL
ids-same

$ (copy) mark JP skill 120461 "Forward March!" released; node src/build.ts --offline --no-images
changed ids for existing skills: [(201682, 'skill:forward-march', 'skill:forward-march-2')]
new: [(120461, 'skill:forward-march')]

$ node probe (screenshot 13 first tile, CARD_ART_CROP, vs committed artHashes)
target card:the-brightest-star-in-japan-special-week guts SSR [ '44cecece16564c7a' ]
[273,93,101,134] 434a2dc9b9b88ecd dist to target 34 rank 180
[271,91,105,138] 43caad89b9b98eed dist to target 33 rank 154
[276,96,95,128]  4b4a2d49b8389ece dist to target 33 rank 148
$ curl -w '%{http_code}' .../supports/tex_support_card_30001.png  -> 200 image/png (450x600)
$ node probe2
tile 434a2dc9b9b88ecd thumb 44cecece16564c7a d= 34 | tex 4b4a2d59b0388ecf d= 7

$ node probe4 (screenshot 05 Legacy 1 portrait, VETERAN_ICON_CROP, 48 crop offsets)
best [[0,14,294,726,112], ...] median rank 10 n 48

$ python3 (bundle checks)
green target != outfit unique: 0 []
cards without characterId: 54
ambiguous texts 2 [('Carnival Bonus', ...), ('Indomitable', ...)]

$ grep in cached .cache/js/2464-2e90db37675bc47e.js
... i=[.03,.06,.09];return"blue"===t?i=[.7,.8,.9]:"red"===t||"aptitude"===t?i=[.01,.03,.05]:"green"===t?i=[.05,.1,.15]:"race"===t&&(i=[.01,.02,.03]),Math.min(i[a-1]*l,1) ... l=1+(Number(r)||0)/100
$ curl -w '%{http_code}' https://gametora.com/_next/static/chunks/2464-2e90db37675bc47e.js
404
$ curl https://gametora.com/umamusume/legacies | text
... ☆ Stat bonus 1☆ +5 2☆ +12 3☆ +21 This bonus is additive for every legacy and sub-legacy ...

$ git status --short   (after all probes; probe files were placed in gitignored .cache/ and removed)
(clean)
```
