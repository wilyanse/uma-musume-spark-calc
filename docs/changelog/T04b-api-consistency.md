# T04b — API review consistency hardening

- **Status:** Done
- **Branch:** task/T04b-api-consistency
- **Initial implementation attribution:** recorded as `gpt-5.6-luna-900k` in the prior changelog; the initial requested model and whether fallback selected it are not independently verified here. The preceding Opus retry exhausted HTTP 429 retries without completing this fix.
- **Review round 1 fix launch:** requested `gpt-6-sol` / `openai-codex`, medium reasoning, profile fallback disabled (explicit orchestrator retry). This is separate from the initial implementation attribution.
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

The initial round-1 review correctly identified that the original 88-test suite did not exercise the actual remap SQL: the absent-owner test used an identity map. The new tests below now exercise both shrink and growth; the earlier coverage claim was premature.

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

## Review round 1
- **B1:** Replaced the microtask-order-dependent test with one-shot D1 batch barriers. Tests explicitly choose DELETE, PATCH, re-ingest, another resolve (both winner directions), or same-item resolve as the winner before the guarded batch; also DELETE just after commit. They assert statuses, unchanged losing values/fields, open-versus-closed item state, counts/orphans, override/mode preservation, fingerprint recomputed from persisted detail, successful retries only for still-open stale items, and 409 for resolved/dismissed retries. The re-ingest clearing low confidence is tested separately. No sleeps.
- **B2:** Added real shrinking 10→3 and growing 10→13 owner-block integration cases, including two-digit indexes before/inside/after the block. They execute `REMAP_REVIEW_PATHS_SQL` through resolve, compare each survivor's sparkId and field value, retire removed targets, keep unrelated items, and resolve a moved item against only its intended spark. A direct SQL test checks parsing, removed/closed items, unrelated paths/veterans, and repeat remap. The original changelog's untested remap claim is corrected above.
- **S1:** Added migration 0003's internal `retired` marker; removed-target review rows retain the original path and scalar resolved value, with open rows dismissed. GET excludes retired rows rather than joining an old path to a different spark's current field. Surviving closed paths follow the same spark. Regression tests check both cases. Contract limitation: GET has only current `CaptureField` metadata, not an immutable historical snapshot; it cannot display the removed target's closed audit entry faithfully, so that entry remains in D1 but is omitted from GET. No shared API field added.
- **S2:** Ingest and resolve now reject low-confidence correction paths targeting whole arrays, array elements, or spark owner/ID leaves; the latter can change identity even without changing array length. Other safe leaf values and the remapped `/sparks/<owner>` correction remain supported. Tests cover rejection at ingest and for legacy open items at resolve, as well as provenance-only acceptance. Q-110 records the rule. Other array containers (`skills`, `deck`, `parents`) are covered for whole-element/array replacements.
- **S3:** `countingEnv` verifies create/re-ingest=15, roster=6, worst-case owner resolve with actual remap=24, PATCH=7; resolve and PATCH assert ≤50.
- **S4:** Initial recorded model, uncertain initial fallback provenance, failed Opus HTTP-429 retry and this explicit GPT-6 Sol medium request are separately identified at the top. No claim about an unobserved fallback selection.
- **N1:** Path helper's comment now describes its actual resolution and unsafe-segment checks.
- **N2:** Kept orchestrator-reserved Q-110 (not Q-8), moved it to the end of Open without modifying other questions, and explained the reservation in its context.
- **N3:** Both winner directions are chosen by barriers, not incidental Promise order.
- **N4:** Documented that syntactically valid unsafe provenance pointers are stored but never applied; a test checks `/__proto__/polluted` creates no item or prototype mutation.

Verification (real output, trimmed):
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test
Scope: 4 of 5 workspace projects
packages/schema lint: Done; apps/web lint: Done; packages/master-data lint: Done; apps/api lint: Done
packages/schema typecheck: Done; apps/web typecheck: Done; packages/master-data typecheck: Done; apps/api typecheck: Done
packages/schema test: Test Files 4 passed (4); Tests 146 passed (146)
packages/master-data test: Test Files 3 passed (3); Tests 82 passed (82)
apps/web test: Test Files 1 passed (1); Tests 5 passed (5)
apps/api test: Test Files 10 passed (10); Tests 103 passed (103)

$ cd apps/api && pnpm exec vitest run test/ingest.test.ts --reporter=verbose
statements: create=15 re-ingest=15 roster=6
statements: resolve(owner+remap)=24 patch=7
Test Files 1 passed (1); Tests 19 passed (19)

$ pnpm exec prettier --check apps/api
Checking formatting...
All matched files use Prettier code style!
$ git diff --check
(no output; exit 0)

$ cd apps/api && npx wrangler d1 migrations apply uma-spark-calc --local --persist-to /Users/willjose/.hermes/cache/scratch/t04b-r1-d1
0001_init.sql ✅ (19 commands); 0002_roster_revision.sql ✅ (8 commands); 0003_write_guard.sql ✅ (4 commands)
```
A broad Prettier check including the existing Markdown documents reports style warnings on `docs/OPEN_QUESTIONS.md` and this changelog; the API source/test formatting check is recorded separately below. No workspace build/master-data refresh, push or deploy was run. A second independent review is required before merge.
