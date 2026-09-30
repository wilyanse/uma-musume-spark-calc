# T04b — API review consistency hardening

- **Status:** Done
- **Branch:** task/T04b-api-consistency
- **Agent / model:** gpt-5.6-luna-900k
- **Date:** 2026-09-30

## Summary
Optimistic concurrency now guards review corrections in the D1 transaction with a monotonic `updated_at` token and an open-item check. Stale corrections return 409 without resolving the item; deleted veterans are never resurrected by resolve.

Resolve now rewrites fields consistently, remaps index-based spark review paths when owner-block length changes, and preserves override semantics. Ingest accepts `ok` provenance for `/trainMode` while retaining low-confidence correctability and pointer-safety restrictions.

## Files
Created:
- `apps/api/migrations/0003_write_guard.sql` — transactional optimistic-write guard view/trigger.

Modified:
- `apps/api/src/app.ts` — schema version 3.
- `apps/api/src/checks.ts` — low-confidence-only correctability checks and explicit safe-path helper.
- `apps/api/src/db/veterans.ts` — monotonic timestamps, guarded updates, internal concurrency metadata.
- `apps/api/src/routes/reviews.ts` — guarded resolve, stale 409 handling, field/path consistency and spark-index remapping.
- `apps/api/src/routes/veterans.ts` — accurate statement-budget comment, monotonic PATCH timestamps, upsert mode naming.
- `apps/api/test/ingest.test.ts` — non-tautological concurrent response assertions.
- `apps/api/test/review.test.ts` — coordinated resolve race, provenance-path coverage, and corrected spark-owner assertions.
- `docs/OPEN_QUESTIONS.md` — Q-110 API/schema validation parity gap for T09.

## Decisions
- Use an actual D1 view trigger as the optimistic-concurrency gate rather than a process-local mutex. The trigger is the first statement in the same batch as the winning mutation, so stale resolve/PATCH/ingest/delete races cannot partially write children or review status.
- Treat `updated_at` as a per-row monotonic revision by advancing it by 1 ms when the injected clock has not advanced. This preserves idempotent ingest and makes the loaded revision a reliable guard token.
- A resolve updates the existing veteran by `id` and never uses an upsert. A missing/deleted veteran therefore cannot be recreated.
- Apply correctability/path restrictions only to `low_confidence` fields. `ok` and `corrected` fields are provenance and may use valid pointers such as `/trainMode`; `/trainMode` remains non-correctable through review resolution.
- When replacing an owner spark block, retain the block location when present, append it when absent, remap surviving index-based review paths, and dismiss open paths into removed sparks. This keeps review targets aligned after length changes without changing the shared contract.
- The API/schema gap is recorded as Q-110; shared contracts were not changed.

## Deviations from spec
- 01 §3's shared pointer schema remains syntactic; API correctability is intentionally enforced at ingest only for low-confidence fields, as required by the review finding and recorded in Q-110.

## Cross-task edits
- None.

## Verification
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test
Scope: 4 of 5 workspace projects
packages/schema lint: Done
apps/api lint: Done
packages/master-data lint: Done
apps/web lint: Done
packages/schema typecheck: Done
apps/api typecheck: Done
packages/master-data typecheck: Done
apps/web typecheck: Done
packages/schema test: Tests 146 passed (146)
packages/master-data test: Tests 82 passed (82)
apps/web test: Tests 5 passed (5)
apps/api test: Test Files 8 passed (8); Tests 88 passed (88)

$ pnpm exec prettier --check apps/api
Checking formatting...
All matched files use Prettier code style!

$ npx wrangler d1 migrations apply uma-spark-calc --local --persist-to "$TMPDIR/t04b-d1"
Migrations to be applied: 0001_init.sql, 0002_roster_revision.sql, 0003_write_guard.sql
0001_init.sql ✅
0002_roster_revision.sql ✅
0003_write_guard.sql ✅
19 commands executed successfully; 8 commands executed successfully; 3 commands executed successfully.
```

The API test suite includes the deterministic coordinated-resolve race, stale-item preservation, `/trainMode` provenance acceptance/restriction, and spark-owner index remapping. Existing statement-budget coverage remains green at the prior 15-statement ingest limit and 6-query roster limit.

## Open questions / follow-ups
- Q-110: T09 must mirror the API/schema parity gap for low-confidence correctability and valid provenance pointers; shared contracts remain unchanged.
- T04 review r2 S1: fixed with D1 optimistic concurrency and 409 handling.
- T04 review r2 S2: fixed by limiting resolvability restrictions to low-confidence fields.
- T04 review r2 N1: fixed; statement-budget comment now states the actual 15-statement composition and no headroom.
- T04 review r2 N2: fixed; concurrent response test now checks valid statuses and `created`/201 consistency.
- T04 review r2 N3: fixed; the spark-owner test now asserts the previously absent block's actual appended placement and length.
- T04 review r2 N4: prior merge conflict in `docs/OPEN_QUESTIONS.md` remains an orchestrator merge concern; this branch appends Q-110 only.
- T04 review r2 N5: remaining prior round-1 follow-ups are carried below.
- T04 review r1 N1: crop-key ownership/capture binding is not addressed.
- T04 review r1 N2: old model-snapshot response/pruning semantics are not addressed.
- T04 review r1 N3: ULIDs/review ordering within a millisecond remain unchanged.
- T04 review r1 N5: resolve changes fingerprint and original-capture retry behavior remains a contract-level follow-up.
- T04 review r1 N6: unused `ULID_A` remains.
- T04 review r1 N7: crop download still buffers bodies before the size check.
- T04 review r1 N4/index limitation: resolved for owner replacement length changes by remapping/dismissing affected index-based review paths; the shared index-based path contract remains in force.
