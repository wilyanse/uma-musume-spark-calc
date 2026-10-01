# T04b independent review — round 3

Reviewer session: 20261001_182454_609f84. Reviewed commit: 025a469 (nits N1/N2 fixed afterwards in d784a50).

## Verdict: PASS

## Blocking
None.

## Should fix
- [S1] `docs/OPEN_QUESTIONS.md:89` and T09's `agent/src/Uma.Agent.Core/Parsing.cs:29-30` (read-only sibling at b518d7b): T09 checks slots only as a sorted set. The API now also requires `slot == index + 1`. No fixture or vector breaks:
  - `apps/api/test/fixtures/mcqueen.json` is deck [1..6], parents [1,2].
  - All 7 entries in `fingerprint.vectors.json` are in order.
  - T09 has no deck/parent builder yet that could emit a different order.
  - But a T09 capture that passes local validation can still get a 422 at upload.
  - Suggestion: when T09 is merged or reviewed, check that it adds the `slot == i+1` rule to `CaptureValidation` (or builds the arrays from slot order). Q-110 already declares the rule, so this is follow-up tracking, not a T04b defect.

## Nits
- [N1] `apps/api/src/routes/reviews.ts:166-167`: the comment still says "spark owner/ID leaves are refused". Since B1, only `/owner` is refused.
- [N2] `apps/api/src/checks.ts:98-105`: `/deck/<n>/slot` and `/parents/<n>/slot` can still be opened as low-confidence items. Any value other than the current one fails resolve with 422 (probe P2), so they are dead review items. T09's `CorrectablePath` already excludes `slot`. Refusing them in `correctionTarget` would keep the two in line.
- [N3] Already the case on main, now easier to reach because sparkId is correctable again: a sparkId correction doesn't check the master spark `type` against the element's `type` field. In P1, `spark:guts` (a blue ID) was accepted on a white `parent2` element. The fix is either a master-type check in `checkMasterIds` or a T13 UI hint. Cross-task follow-up.

## Checklist
1. Spec conformance: ok.
   - B1: `/sparks/<n>/sparkId` is accepted at ingest (201) and at resolve (200).
   - `/sparks/<n>/owner`, whole arrays/elements and `/trainMode` stay refused (review-remap.test.ts matrix).
   - The slot-order restriction and the hidden retired rows are declared under the changelog's Deviations and in Q-110.
   - 01 §3 404/409/422 semantics are unchanged.
2. Correctness: ok.
   - sparkId correction (probe P1):
     - Correcting to a duplicate `owner|sparkId` gives 422 and nothing changes.
     - An unknown master ID gives 422 "Unknown master-data IDs".
     - A non-string value or null gives 422.
     - The same ID under a different owner gives 200.
     - On success the fingerprint is recomputed and matches `fingerprint(detail)`.
     - The field becomes `corrected` and keeps its candidates.
     - The sibling item `/sparks/25/stars` stays on the same element: resolving it to 3 changed only spark 25.
     - Re-ingesting the corrected veteran keeps the closed items (no false retirement).
     - The self-spark duplicate rule still applies (green→medium gives 422).
   - Slot order (P2):
     - The reversed-deck and swapped-deck orders give 422 at `/veteran/deck/0/slot` and `/1/slot`.
     - Swapping the parents with their slots relabelled is accepted.
     - This lines up with the slot-ordered D1 reload (db/veterans.ts:477-478).
   - Skill retirement (P3):
     - With unchanged indices, nothing is retired: the open item stays open, the closed one stays closed, and an un-flagged index is dismissed but not retired.
     - Swapping skills 1↔2 retires and dismisses the old open `/skills/1/level` and opens a fresh one.
     - Shrinking the list retires the resolved `/skills/13/level`, because the new ID is NULL, which `IS NOT` the old one.
     - Index 0 (same ID) keeps its resolved item.
     - Duplicate skills give 422 before any write.
     - GET shows only non-retired items joined to the current field.
3. Test quality: ok.
   - The new tests assert real state:
     - review-identity checks spark contents, the fingerprint and sibling paths;
     - skill-reorder checks the D1 row, `retired=1`, and that the item is absent from GET;
     - slot-order checks the 422 paths;
     - the stale-409 budget test checks `barrier.fired()==1` and a lower bound of >15.
   - The N4 cleanup in review-remap is behaviour-neutral.
   - The changelog numbers match my re-run.
4. Fabrication check: ok. 146/82/5/108 tests and statement counts 15/15/6/24/7/24 reproduced exactly.
5. Security: ok.
   - New SQL interpolates only constants. `?5` is bound.
   - `locate` still refuses unsafe segments.
6. Free-tier constraints: ok.
   - Statement counts: create 15, re-ingest 15, roster 6, owner resolve 24, PATCH 7, stale resolve 24.
   - My worst case of 48 low-confidence fields gave create 15, skill-reversing re-ingest 15, and sparkId resolve 23.
   - The window subqueries run on the D1 side.
7. Scope: ok. Only `apps/api/src`, `apps/api/test`, `docs/OPEN_QUESTIONS.md` (Q-110) and the T04b changelog changed. Shared schema is untouched.
8. Maintainability: ok with N1. `ARRAY_INDEX_SQL` is shared and the "both prefixes are 8 characters" assumption is documented.

## Commands run
```
$ git rev-parse --short HEAD ; git status --short ; git log --oneline 49ef430..HEAD
025a469
025a469 T04b: address review round two consistency findings
$ git diff --stat 49ef430..HEAD
 10 files changed, 267 insertions(+), 30 deletions(-)

# T09 parity (read-only, b518d7b)
$ grep -n slot agent/src/Uma.Agent.Core/Parsing.cs
29: deck slots ... Order().SequenceEqual(1..6)   30: parent slots ... Order().SequenceEqual(1,2)
80: "sparks" => ... { "sparkId", "type", "stars" }   106: Check("sparks", $"/sparks/{i}/sparkId", …)
$ python3 (slot order of fixtures/vectors)
apps/api/test/fixtures/mcqueen.json [1, 2, 3, 4, 5, 6] [1, 2]
vectors 7 out-of-order 0

# Temporary probe apps/api/test/zz-r3-probe.test.ts (deleted afterwards)
$ pnpm exec vitest run test/zz-r3-probe.test.ts --reporter=verbose
P1 ingest 201
P1 resolve "spark:firm-conditions" 422 … "the same spark appears twice for one owner"
P1 resolve "spark:does-not-exist" 422 … "Unknown master-data IDs" /veteran/sparks/25/sparkId
P1 resolve 42 422 ; P1 resolve null 422
P1 other-owner id (blue id on white element) 200
P1 spark25 {"owner":"parent2","sparkId":"spark:guts","type":"white","stars":2} fp ok true
P1 field {"path":"/sparks/25/sparkId",…,"status":"corrected","candidates":[{"value":"spark:standard-distance","score":0.4}]}
P1 stars 200 {"owner":"parent2","sparkId":"spark:guts","type":"white","stars":3} fp ok true
P1 self green→medium(dup self pink id) 422
P1 reingest 200 ["/sparks/25/sparkId:resolved:0","/sparks/25/stars:resolved:0","/sparks/2/sparkId:dismissed:0","/sparks/1/stars:open:0"]
P2 ingest slot leaves 201
P2 resolve deck slot 2 422 … "deck slots must be exactly 1..6, each once"
P2 resolve parents slot same 200
P2 swapped parents relabelled slots (new fp) 201
P2 deck 2,1,3.. 422 … /veteran/deck/0/slot, /veteran/deck/1/slot "deck entries must be in slot order"
P3 same 200 ["/skills/0/level:resolved:0","/skills/1/level:open:0","/skills/13/level:resolved:0","/skills/5/skillId:dismissed:0"]
P3 shrink+swap 200 ["/skills/0/level:resolved:0","/skills/1/level:dismissed:1","/skills/13/level:resolved:1","/skills/5/skillId:dismissed:0","/skills/1/level:open:0"]
P3 dup 422
P3 GET [["/skills/1/level","open",null]]
P4 create 201 15 ; P4 reingest 200 15 ; P4 sparkId resolve 200 23
Tests  4 passed (4)
$ rm apps/api/test/zz-r3-probe.test.ts ; git status --short
(empty)

$ pnpm install --frozen-lockfile ; echo install $?
install 0
$ pnpm -r lint | tail -2 ; pnpm -r typecheck | tail -2
apps/api lint: Done / apps/api typecheck: Done
$ pnpm -r test | grep -E "Tests |Test Files"
packages/schema test: Tests 146 passed (146)
packages/master-data test: Tests 82 passed (82)
apps/web test: Tests 5 passed (5)
apps/api test: Test Files 13 passed (13); Tests 108 passed (108)
test 0
$ pnpm --filter api exec vitest run test/ingest.test.ts test/review-races.test.ts test/review-remap.test.ts --reporter=verbose | grep -E "statements:|Tests "
statements: create=15 re-ingest=15 roster=6
statements: resolve(owner+remap)=24 patch=7
statements: stale resolve=24
Tests  36 passed (36)
$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!
$ git diff --check 49ef430..HEAD ; echo $?
0
$ npx wrangler d1 migrations apply uma-spark-calc --local --persist-to ~/.hermes/cache/scratch/t04b-r3-d1   (dir removed afterwards)
0001_init.sql ✅ │ 0002_roster_revision.sql ✅ │ 0003_write_guard.sql ✅
$ git status --short ; git rev-parse HEAD
(empty)
025a4693a00185963650b2ab80e384ab2f32856b
```
Reviewed commit: 025a4693a00185963650b2ab80e384ab2f32856b. The requested model was claude-opus-5-5 at medium effort with unrelated fallback disabled; this session's actual serving model is not independently verified.
