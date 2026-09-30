# T04 review, round 1 (claude-opus-5-5, high)

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] apps/api/src/routes/veterans.ts:97-102, 126-159 + apps/api/src/db/veterans.ts:120-154. Ingest is not idempotent when two requests for the same fingerprint run at once. The handler looks up `id` by fingerprint outside the batch, then binds every child row, `capture_fields` row and `review_items` row to that JS-side `id`. The upsert is `ON CONFLICT(fingerprint) DO UPDATE` and keeps the existing `id`. So a second request that races the first writes its children under an `id` that has no `veterans` row. I reproduced it with a throwaway test (deleted afterwards) that sent two identical POSTs through `Promise.all`:
  - Both responses were `201 {created:true}`, with different `veteranId`s (`…0001` and `…0003`).
  - Only one veteran row existed (`…0001`).
  - `veteran_sparks` held 34 orphan rows under `…0003`.
  - An open review item under `…0003` showed up in `GET /review-items`. Resolving it can only 404, and nothing else can close it (there's no dismiss route).
  - The agent's outbox retries (30 §6) make this race realistic. It breaks 01 §3 ("idempotent on fingerprint"; `created:false` for the same fingerprint) and leaves the tables corrupted.
  - Required fix: make the batch key off the row that actually exists. For example, bind children and review items through `(SELECT id FROM veterans WHERE fingerprint = ?)`, or use `INSERT … ON CONFLICT … RETURNING id, (created_at = updated_at)` and resolve the id inside the batch. Return the id that was really stored, and decide `created` from the database, not from the pre-read.
  - Add a concurrency test that fires two identical POSTs in `Promise.all` and asserts: one veteran, no orphan child rows, and at most one `created:true`.
- [B2] apps/api/package.json, apps/api/vitest.config.ts, apps/api/env.d.ts, apps/api/scripts/fixture-fingerprint.ts (new) are outside the card's Owns (`apps/api/src/**`, `migrations/**`, `test/**`). They belong to the T02 skeleton, and `scripts/` isn't owned by anyone. The changelog's *Cross-task edits* (docs/changelog/T04-api-core.md:52-54) declares only `pnpm-lock.yaml`. The files appear in the "Modified" list, but they aren't declared as cross-task edits, and 85 §3.7 / AGENTS.md require that. Required fix: list each one under *Cross-task edits* with its reason, or move the fingerprint script under `apps/api/test/` (e.g. `test/helpers/`).

## Should fix
- [S1] apps/api/migrations/0001_init.sql:121-128. The roster ETag can serve a stale 304. The trigger sets the child's `updated_at` to `MAX(updated_at)+1ms`, which is ahead of the injected/real clock, and every further match change pushes it ahead again (a parent that matches K children moves max about K ms ahead). A later write whose `now` is at or below that max doesn't change `max(updated_at)`, so if the count is unchanged the ETag stays the same.
  - Reproduced: I ingested the child, then the matching parent, read the ETag, PATCHed the parent's `trainMode` at the same clock time, then sent `GET /roster` with `If-None-Match: <old etag>` and got **304**, even though the roster had changed.
  - Suggestion: every write sets `updated_at = max(now, (SELECT MAX(updated_at) FROM veterans) + 1ms)`. That covers the upsert, PATCH, resolve and the trigger. Alternatively, keep a monotonic roster counter in a one-row table, bump it from triggers, and hash that with the count.
- [S2] apps/api/src/routes/reviews.ts:129-134, 207-211. Resolve re-validates with `Veteran` and `checkMasterIds`, but it skips the extra ingest checks (duplicate `skillId`, routes/veterans.ts:48-55). A duplicate skill then fails on the `veteran_skills` primary key inside the batch. The catch-all `String(e).includes('UNIQUE')` turns that into `409 "The corrected veteran duplicates an existing one"` with no `veteranId`. Reproduced by resolving `/skills/2/skillId` to `skills[1].skillId`: 409 with a misleading message; the batch rolled back. Suggestion: share one `extraVeteranChecks(veteran)` between ingest and resolve (422), and only map a UNIQUE error on `veterans.fingerprint` to 409.
- [S3] apps/api/src/routes/veterans.ts:104-122, 143-144 + apps/api/src/routes/reviews.ts:34-36. Open review items go stale on re-ingest:
  - (a) If a re-capture reads a previously low-confidence path with `ok`, the open item stays open.
  - (b) If the path is gone from `fields`, `capture_fields` is deleted and re-inserted without it. The `INNER JOIN` in `SELECT_REVIEW` then hides the item permanently while it stays `open` in the table.
  - (c) Ingest accepts `low_confidence` paths that don't resolve in `veteran` (e.g. `/nope/deeper`, see test/review.test.ts:185-197). Those items can never be resolved or dismissed.

  Suggestion: in the ingest batch, set open items to `dismissed` when their path is no longer `low_confidence`. Validate at ingest that every field path resolves (or is the `/sparks/<owner>` pseudo-pointer) and return 422 otherwise.
- [S4] apps/api/src/auth.ts:33-34. `AUTH_DISABLED=*** switches auth off in any deployment where `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are both empty, and that's the shipped state until T12. So a stray secret or var in production would disable auth. 40 §3 requires this to be impossible to set in production. Suggestion: also require an explicit local marker that production can't have. For example, honour it only when the request host is `localhost` / `127.0.0.1`, or when a `DEV_MODE` binding is present that only `.dev.vars` and vitest define. Also record the residual risk in the changelog.

## Nits
- [N1] apps/api/src/routes/veterans.ts:62-67. `cropKey` is checked only for shape. It isn't tied to this capture's `captureId`, so a capture can reference another capture's crop, and `DELETE /veterans/:id` (veterans.ts:229-230) would then delete it from R2. Crops from an earlier capture of the same fingerprint are orphaned on re-ingest.
- [N2] apps/api/src/routes/model-snapshots.ts:43-69. If a snapshot older than the newest 20 is posted, it's pruned in the same batch but the endpoint still returns `201` with the body.
- [N3] apps/api/src/ulid.ts:11-13 + reviews.ts:54. ULIDs aren't monotonic within a millisecond, and every review item from one ingest shares `created_at`. The queue order inside one ingest is therefore random. Consider monotonic ULIDs or ordering by rowid.
- [N4] apps/api/src/routes/reviews.ts:117-121. Resolving `/sparks/<owner>` moves that owner's sparks to the end of the array. Any other open `/sparks/<n>/…` item on the same veteran then points at a different spark.
- [N5] Resolve changes the fingerprint (01 §9), so an agent retry of the original capture creates a second veteran. This is inherent to the contract, but worth an OPEN_QUESTIONS entry.
- [N6] apps/api/test/helpers/harness.ts:94. `ULID_A` is unused.
- [N7] apps/api/src/routes/crops.ts:33. Without `Content-Length` the whole body is buffered before the 60 KB check. That's fine at Worker limits, but a streamed cap would be cleaner.

## Checklist
1. Spec conformance: issues. Every 01 §3/§4/§8/§9 endpoint exists with the contract status codes (201/200/304/204/404/409/413/415/422, 401/503/500), problem+json, and zod from `@uma/schema`. All 40 §5 items are covered by tests. The 01 §7 schema matches, with declared extra indexes, a trigger and NOT NULLs. But 01 §3 idempotency is broken under concurrent ingest (B1), and the 40 §4 ETag can go stale (S1).
2. Correctness: issues (B1, S1, S2, S3, N4). Guest parents are never matched, unreadable parent sparks never match, an ambiguous match gives NULL, LB 0 / borrowed round-trip, and override preservation is correct.
3. Test quality: ok, with gaps. Tests assert real behaviour against real migrations, with an injected clock and IDs. The golden fixture's fingerprint recomputes correctly and its stats, aptitudes and races/wins match screenshots 01/05. The statement counter really counts batch items. Missing: concurrency, stale-ETag and stale-review-item cases. test/review.test.ts:185-197 accepts unresolvable paths at ingest (S3c). The changelog's verification output matches my re-run: 80/80; statements 14/14/6; benchmark sizes identical, timings within noise.
4. Fabrication check: ok. No game constants in production code. The fixture's invented IDs (`card:fixture-card-N`, parent outfits) are test-only and disclosed as follow-ups. The master fixture's `statCap: 1200` / `minRating` values sit only in the test fixture. The benchmark numbers are real and labelled as wall-clock, not CPU.
5. Security: issues (S4, N1). JWT is RS256-only, with iss/aud/exp/nbf checks, JWKS cached 1 h, fail-closed 503/500, and 401 on every non-health route (tested). SQL is parameterised; table names are interpolated from constants only. The JSON pointer is guarded against `__proto__`. The master version and crop keys are regex-checked. No secrets in the repo.
6. Free-tier constraints: issues, disclosed. Ingest uses 14 statements (≤ 15) and the roster 6 (≤ 6); no paid features. 2,000 veterans = 9.4 MB and about 230 ms wall-clock, so the 10 ms CPU budget is likely exceeded. This is honestly recorded as Q-4, which is non-blocking for the spec author.
7. Scope: issues (B2). `env.d.ts`, `package.json`, `vitest.config.ts` and `scripts/` aren't declared as cross-task edits. `docs/OPEN_QUESTIONS.md` (append Q-4) and `pnpm-lock.yaml` are fine.
8. Maintainability: ok. Clear route/db split, strict types, pinned `zod` 4.6.5 (same as schema), and no TODOs. Minor dead code (N6).

## Commands run
```
$ git diff --stat main...HEAD | tail -1
 42 files changed, 4483 insertions(+), 22 deletions(-)

$ pnpm -r lint ; echo exit $?
apps/web lint: Done
apps/api lint: Done
exit 0

$ pnpm -r typecheck ; echo exit $?
apps/web typecheck: Done
apps/api typecheck: Done
exit 0

$ pnpm -r test ; echo exit $?
packages/schema test:  Test Files  4 passed (4)
packages/schema test:       Tests  146 passed (146)
apps/web test:  Test Files  1 passed (1)
apps/web test:       Tests  5 passed (5)
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  80 passed (80)
exit 0

$ cd apps/api && pnpm exec vitest run --reporter=verbose | grep -E "statements:|benchmark:|roster 304|Tests "
statements: create=14 re-ingest=14 roster=6
roster benchmark: n=260 bytes=1226681 first-request=33.0ms first-parse=3.0ms warm-handler=31.0ms warm-parse=2.8ms
roster 304 (n=260): 1.0ms
roster benchmark: n=2000 bytes=9436001 first-request=233.0ms first-parse=20.0ms warm-handler=231.6ms warm-parse=22.4ms
roster 304 (n=2000): 1.0ms
      Tests  80 passed (80)

$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!

$ npx wrangler d1 migrations apply uma-spark-calc --local --persist-to <scratch>/t04-d1
│ 0001_init.sql │
🚣 19 commands executed successfully.
│ 0001_init.sql │ ✅     │

$ node <copy of fixture check>   # fingerprint + schema of test/fixtures/mcqueen.json
stored   53d102dede51127aef0524847d288ccf961f720e71c9c53b840e4450813de0ae
computed 53d102dede51127aef0524847d288ccf961f720e71c9c53b840e4450813de0ae
schema ok true

# Reviewer probes (temporary test files under apps/api/test/, deleted afterwards; git status clean)
$ pnpm exec vitest run test/zz-probe.test.ts -t "probe A"     # two identical POST /veterans in Promise.all
A responses [[201,{"veteranId":"01J8Z3K4M5N6P7Q8R900000001","created":true,"reviewItemIds":["…0002"]}],[201,{"veteranId":"01J8Z3K4M5N6P7Q8R900000003","created":true,"reviewItemIds":["…0004"]}]]
A veterans [{"id":"01J8Z3K4M5N6P7Q8R900000001"}]
A sparks by vet [{"veteran_id":"…0001","n":34},{"veteran_id":"…0003","n":34}]
A review items [{"id":"…0002","veteran_id":"…0001","status":"open"},{"id":"…0004","veteran_id":"…0003","status":"open"}]
A open items visible 2

$ pnpm exec vitest run test/zz-probe.test.ts -t "probe B"     # resolve /skills/2/skillId to a duplicate skill
B status=409 body={"type":"about:blank","title":"Conflict","status":409,"detail":"The corrected veteran duplicates an existing one"} skillsLeft={"n":14}

$ pnpm exec vitest run test/zz-probe2.test.ts                 # child, then matching parent, ETag, PATCH parent at same clock, conditional GET
C patch=200 conditional-roster-after-patch=304

$ git status --short
(empty)
```
