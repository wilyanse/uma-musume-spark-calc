# T04b independent review — round 2

Reviewer session: 20261001_050514_e26aa2.

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] apps/api/src/checks.ts:59 and :82, docs/OPEN_QUESTIONS.md:89: the S2 fix now rejects a required capture path. `low_confidence` `/sparks/<n>/sparkId` fails ingest with 422, and an open item on that path can't be resolved.
  - Spark labels are OCR'd and matched against the vocab. A weak match becomes `low_confidence` with the top-3 candidates (30 §4). F04/S03 then fixes it in one click from those candidates (00 F04, 10 S03).
  - `main` accepted this path, so this is a regression. On `task/T09-agent-core`, `Parsing.cs:80` accepts `sparkId` as a correctable spark leaf and `Parsing.cs:106` reports unknown spark IDs at `/sparks/{i}/sparkId`. As things stand, one uncertain spark label makes the whole veteran capture fail with 422.
  - My probe P1 confirmed it: `/sparks/25/sparkId` gives 422; `/skills/2/skillId`, `/deck/0/cardId`, `/parents/0/characterId` and `/sparks/25/type` each give 201.
  - A `sparkId` leaf edit doesn't move the array or change its length. Sibling index items keep pointing at the same element, and duplicate `owner|sparkId` is already rejected by `extraVeteranChecks` (checks.ts:50). Treating it like an owner or array restructure is over-broad.
  - Required fix:
    - Keep `/sparks/<n>/sparkId` correctable at ingest and at resolve. Keep `/owner`, whole arrays and whole elements rejected.
    - Add a test that resolving a `sparkId` leaf recomputes the fingerprint, keeps other index items on their own sparks, and gives 422 on a duplicate.
    - Update Q-110 so T09 isn't told to reject a path it needs.

## Should fix
- [S1] apps/api/src/db/veterans.ts:477-478 and :448-449 (T04 behaviour, but the same class-wide hole the brief asked about): `/deck/<n>` and `/parents/<n>` review paths index the capture array, but these rows are stored and reloaded `ORDER BY slot`.
  - Probe Q1: a capture with `deck` in slot order 6..1 and a low-confidence `/deck/0/lb` (slot 6). Resolving it changed slot 1's LB (4→0), not slot 6's.
  - The schema doesn't require the deck or parents arrays to be in slot order.
  - Suggestion: require slot-ordered `deck` and `parents` at ingest (a 422, recorded in Q-110 for T09), or load them by insertion rowid.
- [S2] apps/api/src/routes/veterans.ts:101-124: the reorder retirement on re-ingest only covers `/sparks/<n>`. Skills aren't part of the fingerprint, so a same-fingerprint re-ingest can reorder `veteran.skills`, and closed `/skills/<n>/…` items then join another skill's field.
  - Probe Q2: after resolving `/skills/0/level`=4 and re-ingesting with the skills reversed, `GET ?status=resolved` showed that item with `field.value: null`. Index 0 is now `skill:groundwork`, level null.
  - Open items there happen to be re-evaluated only because the path is still low-confidence.
  - Suggestion: apply the same identity comparison to `skills` (by `skillId`), or record this in Q-110 as a known limitation for T09.
- [S3] docs/OPEN_QUESTIONS.md:89: leaving retired rows out of GET is an acceptable declared limitation, not a spec violation.
  - 01 §9 lists items "joined with field", and items whose field row is gone were already left out before this change.
  - The rows stay in D1 and are never shown with another spark's field; I checked this for resolved, dismissed and unfiltered GET (P3).
  - Gaps to fix:
    - It is silent to clients: `GET ?status=resolved` or `?status=dismissed` loses entries with no marker.
    - It isn't listed under the changelog's "Deviations from spec", only in the Review-round text and Q-110.
  - Suggestion: add it to Deviations so T13 knows the queue history can't be complete, and state that `?status=dismissed` omits removed-target dismissals.
- [S4] Worst-case budget: resolve is 24 statements, and it's flat, because the inserts are multi-row. My P6 run with 16 open items and 49 fields also counted 24, on both the stale-409 path and the success path.
  - The test (ingest.test.ts:410-458) asserts ≤50 for only one scenario. That's fine, but add the stale-409 path too: it adds a `staleResolveError` read.
  - The changelog makes no CPU claim. The new ingest `UPDATE` evaluates a window-function subquery per review item, up to 3 times per row, in D1. That cost is D1-side, not Worker CPU. Say so rather than leaving it unstated.

## Nits
- [N1] docs/changelog/T04b-api-consistency.md:14-24: the Files list doesn't include the new `test/review-races.test.ts`, `test/review-remap.test.ts`, the `barrierEnv` helper or the `retired` column in 0003.
- [N2] docs/changelog/T04b-api-consistency.md:127: "the API source/test formatting check is recorded separately below", but nothing follows it.
- [N3] apps/api/src/routes/veterans.ts:101-102 duplicates the `idx` SQL fragment from reviews.ts:101-102. Share one constant so the two parsers can't drift.
- [N4] apps/api/test/review-remap.test.ts:151: `const leaf = 'stars'` inside the loop is a leftover.

## Checklist
1. Spec conformance: issues (B1, S3).
   - Met:
     - Stale correction returns 409 and the item stays open.
     - Delete returns 404 with no resurrection.
     - The override is preserved.
     - `ok` provenance at `/trainMode` is accepted.
     - Owner shrink and grow remap index paths correctly.
     - Q-110 is kept and appended.
     - Shared contracts are untouched.
   - Not met: the new S2 restriction rejects the required `/sparks/<n>/sparkId` low-confidence path.
2. Correctness: issues (B1, S1, S2).
   - The guard trigger aborts real D1 batches.
   - Repeated remaps work: parent1 shrink then parent2 shrink (P3). Removed items were retired and never revived by re-ingest. Resolving a retired item gives 409. The fingerprint stayed consistent.
   - Owner resolve racing an index resolve: the loser gets 409; its retry lands on the moved path `/sparks/18/stars` and edits the same parent2 spark (P5).
   - Concurrent reorder re-ingests: both 200, 3 open items, each joined to its correct spark (P4).
   - Old open and closed items at unchanged indices are also retired and recreated. That's conservative, not corrupting.
3. Test quality: ok.
   - The barrier hooks really control the winner for each pair:
     - resolve vs DELETE (before and after commit);
     - resolve vs PATCH;
     - resolve vs ingest, both still-low and cleared;
     - resolve vs a different item, both directions;
     - resolve vs the same item.
   - The tests assert status, losing values, fields, item status, orphans, mode, fingerprint recomputation, and that a retry succeeds only for a still-open item.
   - Remap tests run the real SQL, including two-digit indices and a repeated run. The changelog's numbers match my re-run.
4. Fabrication check: ok. Real output matches: 104/146/82/5 tests and 15/15/6/24/7 statements. The r1 overclaim was corrected. Attribution is recorded as uncertain, not rewritten.
5. Security: ok. SQL is parameterised; interpolated fragments are constants. Unsafe pointers are still rejected by `locate` at resolve. `/__proto__/polluted` provenance is stored, never applied, and causes no prototype pollution (tested).
6. Free-tier constraints: ok with S4. Ingest 15, roster 6, resolve 24 (flat), PATCH 7. The window subquery cost is D1-side; no Worker CPU measurement was made or claimed.
7. Scope: ok. Only `apps/api/{src,test,migrations}`, `docs/OPEN_QUESTIONS.md` (Q-110 moved to the end, others unchanged) and the changelog are touched. 0003 is an additive, unpublished migration.
8. Maintainability: ok with N3/N4. `correctionTarget` replaces `isCorrectablePath` + `setAtPointer` cleanly.

## Commands run
```
$ git rev-parse HEAD ; git log --oneline main..HEAD
49ef430ce6e641a2455a096d6910d9cf37348826
49ef430 T04b: retire review targets on reordered re-ingest
79d2369 T04b: cover review races and preserve spark review targets
cd0da26 T04b: harden API review concurrency and consistency
$ git diff --stat cd0da26..HEAD
 11 files changed, 1187 insertions(+), 106 deletions(-)

$ pnpm install --frozen-lockfile ; echo install $?
install 0
$ pnpm -r lint | tail -3 ; pnpm -r typecheck | tail -3
apps/web lint: Done / packages/master-data lint: Done / apps/api lint: Done
packages/master-data typecheck: Done / apps/web typecheck: Done / apps/api typecheck: Done
$ pnpm -r test | grep -E "Tests |Test Files"
packages/schema test:       Tests  146 passed (146)
packages/master-data test:  Tests  82 passed (82)
apps/web test:              Tests  5 passed (5)
apps/api test:  Test Files  10 passed (10)
apps/api test:       Tests  104 passed (104)
exit 0
$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!
$ git diff --check main...HEAD ; echo $?
0
$ TMPDIR=~/.hermes/cache/scratch npx wrangler d1 migrations apply uma-spark-calc --local --persist-to $TMPDIR/t04b-r2/d1
│ 0001_init.sql ✅ │ 0002_roster_revision.sql ✅ │ 0003_write_guard.sql ✅ │

# Reviewer probes: temporary apps/api/test/zz-probe*.test.ts (deleted afterwards)
$ pnpm exec vitest run test/zz-probe.test.ts --reporter=verbose
P1 /sparks/25/sparkId 422 [{"path":"/fields/9/path","message":"a low_confidence field must point at a correctable part of the veteran"}]
P1 /skills/2/skillId 201 ; /deck/0/cardId 201 ; /parents/0/characterId 201 ; /sparks/25/type 201
P3 r12 200 / shrink parent1 200 / shrink parent2 200
P3 rows [/sparks/26/stars dismissed retired=1 (was 33), /sparks/12/stars resolved "2" retired=1, /sparks/parent1 resolved, /sparks/parent2 resolved, /sparks/5/stars open]
P3 sparks len 15 fp ok true ; retired resolve → 409, 409
P3 reingest 200 → new open /sparks/12/stars; retired rows unchanged (retired=1)
P3 GET open/unfiltered: /sparks/12/stars:open ; GET resolved: (empty) ; GET dismissed: (empty)
P4 fired=1 inner(reorder 20↔25)=200 outer(reorder 19↔25)=200 ; 3 open, each field.value == stars of the spark at its index ; fp ok true
P5 inner owner-resolve 200, outer /sparks/25/stars 409 (item open at /sparks/18/stars); retry 200
P5 spark18 {"owner":"parent2","sparkId":"spark:standard-distance","stars":1} orig25 {…"spark:standard-distance","stars":2}
P6 stale 409 statements 24 ; P6 ok 200 statements 24   (16 open items, 49 fields)
Tests  6 passed (6)
$ pnpm exec vitest run test/zz-probe2.test.ts --reporter=verbose
Q1 capture deck[0] {"slot":6,…"lb":0} ; stored deck[0] {"slot":1,…"lb":4}
Q1 resolve 200 changed slot [{"slot":1,"cardId":"card:fixture-card-1","lb":0,…}]
Q2 fp same true ; reingest 200
Q2 resolved [["/skills/0/level",4,null]] skill0 now {"skillId":"skill:groundwork","level":null}

$ git status --short
(empty)
```
Reviewed commit: 49ef430ce6e641a2455a096d6910d9cf37348826. Reviewer requested claude-opus-5-5, medium effort, unrelated fallback disabled. This session's actual serving model is not independently verified.
