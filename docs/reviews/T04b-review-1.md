# T04b independent review — round 1

Requested reviewer: claude-opus-5-5 / anthropic, medium; profile fallback disabled. Session: 20260930_184837_cef8eb.

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] apps/api/test/review.test.ts:252-286: the card requires deterministic race tests for resolve/delete, resolve/ingest, resolve/PATCH and duplicate resolve. The branch adds one race test, resolve vs resolve on two different items, and its checks are weak.
  - What's missing: no test covers resolve racing DELETE (no resurrection, no orphans, 404), PATCH (override kept, 409, item still open, field not `corrected`), ingest (409, rating/fields/fingerprint consistent), or two resolves of the same item.
  - Why the one test is weak: `expect([spd, sta]).toContain(884)` only passes because microtask order lets the first request win every time. It never checks that the losing stat is unchanged, that the loser's field isn't `corrected`, that the fingerprint matches the stored row, or which item stays open.
  - The code itself behaved correctly in my probes (below). The gap is proof: without these tests a later regression in the trigger, the `updated_at` bump or the 409 mapping would pass CI.
  - Required fix: add hook-injected deterministic tests for each pair in the matrix. Each should assert:
    - response status;
    - veteran row count and zero orphans;
    - review item status;
    - capture field status/value;
    - `trainMode`/`modeSource`;
    - that the stored fingerprint equals `fingerprint(veteran)`;
    - that a retry after a 409 succeeds.
- [B2] docs/changelog/T04b-api-consistency.md:70 and :24: the changelog says the suite covers "spark-owner index remapping" and "stale-item preservation". No test exercises the remap.
  - The only owner-replacement test (apps/api/test/review.test.ts:308-335) uses an owner that was absent before, so `sparkMap` is the identity, `remapped` is false (apps/api/src/routes/reviews.ts:214) and `REMAP_REVIEW_PATHS_SQL` (reviews.ts:93-98) never runs.
  - The card requires "test length changes and stale review handling". The remap SQL (substr/instr index parsing, json_extract map, dismiss-to-owner-path) is the most error-prone code in the diff and has zero coverage.
  - My probe F (parent1 block 10→3 sparks, with open `/sparks/25/stars`, `/sparks/12/stars` and `/sparks/3/stars`) gave the right result:
    - 25→18, still targeting the same parent2 spark;
    - 12 dismissed;
    - 3 unchanged;
    - fields remapped or dropped;
    - resolving the remapped item edited the correct spark, and the fingerprint was consistent.
  - Required fix: add tests for a shrinking and a growing owner block that assert remapped open review paths and fields still target the same `sparkId`, items into the removed block are dismissed, and later items are untouched. Also correct the changelog claims.

## Should fix
- [S1] apps/api/src/routes/reviews.ts:93-98: `REMAP_REVIEW_PATHS_SQL` also rewrites resolved and dismissed items. It changes their `path` to the owner pseudo-path but keeps their `status` and `resolved_value_json`.
  - Probe G: a resolved `/sparks/12/stars` item with value `3` became `{path:"/sparks/parent1", status:"resolved", resolved_value_json:"3"}`. `GET /review-items?status=resolved` now joins it to the owner's spark-list field.
  - That's a corrupted audit trail: two resolved items on one path, and a scalar value against a list field.
  - Suggestion: remap only open items, or leave closed items' paths alone.
- [S2] apps/api/src/routes/reviews.ts:153, apps/api/src/checks.ts:94-97: other corrections can also change which spark an index points at, and they don't remap sibling index paths.
  - Cases: a low-confidence `/sparks` (whole array) or `/sparks/<n>` (whole object, including `owner`) correction.
  - Probe H: resolving `/sparks` with a shorter array left `/sparks/25/stars` open. It targeted `spark:standard-distance` before and `spark:unity-cup` after.
  - The card's wording is about owner replacements, but this is the same failure. Either reject such paths as non-correctable for `low_confidence`, or dismiss/remap sibling index items. Record it in Q-110.
- [S3] The card requires every invocation, not just ingest, to stay within the D1 statement budget. Resolve now uses 24 statements (probe J: 2 reads + 6-query detail batch + guard, upsert, deletes, inserts, fields, remap, resolve, match). That's within 50, but no test asserts it.
  - Suggestion: add a `countingEnv` assertion for resolve (worst case: owner replacement plus remap) and for PATCH (7).
- [S4] docs/changelog/T04b-api-consistency.md:5: `Agent / model: gpt-5.6-luna-900k` doesn't say what model was requested versus what the fallback actually selected, as the orchestrator asked. Record the requested model and the actual or uncertain fallback separately.

## Nits
- [N1] apps/api/src/checks.ts:67-70: the `isCorrectablePath` doc says "The pointer must still resolve", but the function only excludes `/trainMode`. Resolution is checked by callers.
- [N2] docs/OPEN_QUESTIONS.md:43: Q-110 breaks the numbering (the next free number after Q-7 is Q-8). It's inserted mid-list, before Q-70, rather than appended as the card's "append only" asks.
- [N3] apps/api/test/review.test.ts:280-285: state which item is expected to win (or assert both outcomes explicitly). As written, the test depends on the ordering implied by `release()`.
- [N4] Not re-checked here: whether ingest `ok` fields with unsafe pointers (`/__proto__`) are stored as provenance only. They're never applied (resolve uses `locate`, which rejects them), so this is fine, but Q-110 could state it explicitly.

## Checklist
1. Spec conformance: issues.
   - Met:
     - 409 on a stale correction, with the item left open (verified by probe).
     - No resurrection on delete (404, 0 orphans).
     - Override preserved.
     - `ok` provenance `/trainMode` accepted and `low_confidence` `/trainMode` rejected (tested).
     - Q-110 recorded; shared contracts untouched.
     - N1-N3 fixed.
     - Ingest still 15 statements.
   - Not met: the "Deterministic race tests demonstrate this" and "test length changes and stale review handling" items (B1, B2). S2 is a gap in the spark-path consistency item.
2. Correctness: issues (S1, S2).
   - The migration 0003 view/INSTEAD OF trigger works inside real D1 batches: `RAISE(ABORT)` rolled the whole batch back in probes B/C (spd, fields and item unchanged).
   - The `updated_at` bump is monotonic under a frozen clock.
   - A post-commit delete returns 404, not 500.
3. Test quality: issues (B1, B2, N3).
   - The changelog's command output matches my re-run: 88/88; statements 15/15/6; stable across 3 repeat runs.
   - The changelog's description of test coverage is not accurate (B2).
4. Fabrication check: issues. There's no invented game data and the command output is real, but the changelog claims coverage that doesn't exist (B2, line 70). The model attribution is ambiguous (S4).
5. Security: ok. SQL is parameterised; interpolated fragments are constants. Unsafe pointers are still rejected by `locate` on resolve and for `low_confidence` ingest fields. Auth is untouched.
6. Free-tier constraints: ok, but untested outside ingest. Ingest is at 15 (no headroom), PATCH 7, resolve worst case about 24 of 50 (S3). No deployment or production config edits.
7. Scope: ok. Only `apps/api/{src,test,migrations}`, `docs/OPEN_QUESTIONS.md` and the changelog are touched. The migration is additive (0003) and `DB_SCHEMA_VERSION` is set to 3.
8. Maintainability: ok with nits.
   - `writeVeteranStatements`' upsert/update modes are clear.
   - `internal` metadata is stripped from responses.
   - The remap logic is duplicated in JS (`remapSparkPath`) and SQL (`REMAP_REVIEW_PATHS_SQL`), which raises the need for tests (B2).
   - `ULID_A` is still unused (carried follow-up).

## Commands run
```
$ git diff --stat main...HEAD
 apps/api/migrations/0003_write_guard.sql | 19 ; apps/api/src/app.ts | 2 ; apps/api/src/checks.ts | 21
 apps/api/src/db/veterans.ts | 110 ; apps/api/src/routes/reviews.ts | 138 ; apps/api/src/routes/veterans.ts | 27
 apps/api/test/ingest.test.ts | 5 ; apps/api/test/review.test.ts | 75 ; docs/OPEN_QUESTIONS.md | 5
 docs/changelog/T04b-api-consistency.md | 87
 10 files changed, 413 insertions(+), 76 deletions(-)

$ pnpm install --frozen-lockfile ; echo $?
0
$ pnpm -r lint ; echo exit $?
apps/web lint: Done / packages/master-data lint: Done / apps/api lint: Done
exit 0
$ pnpm -r typecheck ; echo exit $?
packages/master-data typecheck: Done / apps/web typecheck: Done / apps/api typecheck: Done
exit 0
$ pnpm -r test ; echo exit $?
packages/schema test:       Tests  146 passed (146)
packages/master-data test:  Tests  82 passed (82)
apps/web test:              Tests  5 passed (5)
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  88 passed (88)
exit 0
$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!

$ cd apps/api && pnpm exec vitest run --reporter=verbose | grep -E "statements:|Tests "
statements: create=15 re-ingest=15 roster=6
      Tests  88 passed (88)
$ for i in 1 2 3; do pnpm exec vitest run test/review.test.ts test/ingest.test.ts | grep "Tests "; done
      Tests  31 passed (31)   (x3)

$ npx wrangler d1 migrations apply uma-spark-calc --local --persist-to $TMPDIR/t04b-rev-d1
│ 0001_init.sql ✅ │ 0002_roster_revision.sql ✅ │ 0003_write_guard.sql ✅ │

# Reviewer probes (temporary apps/api/test/zz-probe.test.ts: master() hook injects the competing
# request between the resolve's load and its batch; file deleted afterwards, git status clean)
$ pnpm exec vitest run test/zz-probe.test.ts --reporter=verbose
A delete 204 / A resolve 404 "The veteran of this review item no longer exists" / A vets [{"n":0}] orphans [{"n":0}]
B patch 200 / B resolve 409 "The veteran changed…" / B row [{"spd":894,"train_mode":"independent","mode_source":"override"}]
  field [{"status":"low_confidence","value_json":"894"}] item [{"status":"open"}]
B retry 200 independent override 884 fpOk true
C ingest 200 / C resolve 409 / C after spd=894 rating=13472 fpOk true [{"status":"open"}]
C2 ingest(clears low) 200 / C2 resolve 409 "Review item is already dismissed"
D inner 200 / D outer 409 "Review item is already resolved" / D state 700 fpOk true [resolved "700"] field [corrected "700"]
F resolve 200 (parent1 10→3 sparks)
F items [/sparks/parent1 resolved, /sparks/18/stars open (was 25), /sparks/parent1 dismissed (was 12), /sparks/3/stars open]
F spark18 {"owner":"parent2","sparkId":"spark:standard-distance",…} len 27   (same spark as old index 25)
F moved resolve 200 stars→3 fpOk true
G rows [{"path":"/sparks/parent1","status":"resolved",…list…},{"path":"/sparks/parent1","status":"resolved","resolved_value_json":"3"}]   # S1
H resolve(/sparks whole array, shorter) 200
H items [{"/sparks":"resolved"},{"/sparks/25/stars":"open"}] old25 spark:standard-distance new25 spark:unity-cup   # S2
I 200 Independent Learner manual override
J resolve 200 statements 24 / J patch statements 7

$ git status --short
(empty)
```
