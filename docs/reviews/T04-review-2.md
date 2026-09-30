# T04 review, round 2 (claude-opus-5-5, high)

## Verdict: PASS

## Blocking
(none)

Round-1 Blocking items:
- B1 is resolved. apps/api/src/routes/veterans.ts:95-160 and apps/api/src/db/veterans.ts:73-76 and 134-197 no longer pre-read the veteran:
  - Every child, field, review and match statement resolves the id through `(SELECT id FROM veterans WHERE fingerprint = ?1)` inside the same batch.
  - `veteranId` and `created` come from the upsert's `RETURNING`.
  - `updated_at` is forced past `created_at` on conflict, so the flag stays correct when the clock is frozen.
  - Probes (below) with 6 concurrent POSTs mixing two captures of one fingerprint ended with 1 veteran, 0 orphan rows, all responses carrying the stored id, exactly one `created:true`, and exactly one open item that matches the final fields.
  - The new test (test/ingest.test.ts:333-383) passed 3 of 3 runs. The same `Promise.all` pattern reproduced the bug in round 1.
- B2 is resolved. `package.json`, `vitest.config.ts`, `env.d.ts` and `scripts/fixture-fingerprint.ts` are now declared with reasons under *Cross-task edits* (docs/changelog/T04-api-core.md, Review round 1).

## Should fix
- [S1] apps/api/src/routes/reviews.ts:80-85 and 161-190: resolve is a read-modify-write with no concurrency guard.
  - Problem: it loads the whole veteran, applies one pointer, then upserts the whole row and its children by `id`. Two resolves on the same veteran in flight at once lose one update, and the database is left inconsistent.
  - Probe P2 (two open items, `/stats/spd`→900 and `/stats/sta`→950, sent together): both requests returned 200 and both items are `resolved`. The `/stats/spd` field says `corrected` with value 900, but the veteran row has `spd=894, sta=950`, so the fingerprint reflects the wrong value.
  - The same pattern means a `DELETE /veterans/:id` that lands between the load and the batch lets `ON CONFLICT(id)` re-insert the deleted veteran with its children. The final `row!` (reviews.ts:199-200) is then null, which gives a 500.
  - This isn't a regression (the code predates round 1) and needs two concurrent requests from a single-user UI, hence Should fix rather than Blocking.
  - Suggestion: optimistic concurrency. Include the loaded `updated_at` (or fingerprint) as a guard, e.g. `UPDATE veterans … WHERE id = ? AND updated_at = ?`, or a guard statement first in the batch that fails when it doesn't match. Answer 409 "veteran changed, reload" when it fails, and never insert on the resolve path.
- [S2] apps/api/src/checks.ts:86-91: the new "path must resolve" rule is broader than S3c needed.
  - Problem: it rejects the whole capture (422) for any field path that isn't correctable, including `status: 'ok'` provenance fields that never become review items.
  - Probe P6: an `ok` field with path `/trainMode` (a real `veteran` property, and a valid JSON pointer per 01 §3) → `422 /fields/9/path`.
  - This rule isn't in `@uma/schema`. 01 §3 says the agent validates "the same rules" before upload, so a capture the agent considers valid would sit in the outbox failing forever.
  - It's disclosed only as a note in Review round 1. It's not in *Deviations* or OPEN_QUESTIONS.
  - Suggestion: apply the resolvability and `/trainMode` check only to `low_confidence` fields (the ones that create items), and add an OPEN_QUESTIONS entry so T09's validator mirrors it (or so it moves into `packages/schema`).

## Nits
- [N1] apps/api/src/routes/veterans.ts:35-36: the statement-budget comment is stale. It still says "1 lookup + 1 open-review lookup"; the real count is now 15 = upsert + 4 deletes + 4 inserts + field delete/insert + dismiss + review insert + match + final SELECT. Since there's zero headroom, it's worth stating accurately.
- [N2] apps/api/test/ingest.test.ts:368-370: this assertion is a tautology. It maps each status onto itself (201→201, otherwise 200), so it can never fail. Either assert that every status is in {200, 201} and matches its `created`, or drop it.
- [N3] apps/api/test/review.test.ts (the `N4` test): as the changelog admits, it only checks the relative order of untouched owners. The flagged case (owner previously absent) appends the block, so the stored order becomes self, parent2, parent1. That's harmless, but not what the test name ("keeps the owner block in place") implies.
- [N4] `git merge-tree main HEAD` shows a content conflict in docs/OPEN_QUESTIONS.md (main moved on). It's expected with the Q-4 renumbering the changelog mentions, but the orchestrator has to resolve it at merge.
- [N5] Round-1 nits N1-N3 and N5-N7 are still open (listed as not addressed). Carry them to follow-ups on merge, together with S1-S2 above and the index-shift limitation of N4.

## Checklist
1. Spec conformance: ok.
   - Every 01 §3/§4/§8/§9 endpoint and status code is still present.
   - Idempotency on fingerprint (01 §3) now holds under concurrency.
   - 40 §4's "no duplicate open item per path" is enforced in SQL (`NOT EXISTS`).
   - The ETag is the specified hash of `max(updated_at)|count`, plus a revision (documented). It's strictly more correct and was tested at a frozen clock.
   - Every 40 §5 item is covered.
   - The ingest-time path rule goes beyond the contract (S2).
2. Correctness: issues (S1, S2).
   - Round-1 S1-S4 are fixed and verified:
     - Revision triggers cover insert/update/delete and match changes.
     - `extraVeteranChecks` is shared, and resolving to a duplicate skill now gives 422.
     - 409 is mapped only when the error mentions `veterans.fingerprint`. Probe P5 confirmed D1's error text contains it.
     - Stale open items are dismissed on re-ingest.
   - Newly found: a lost update under concurrent resolves (S1).
3. Test quality: ok. The new tests assert real database state (orphan counts, review rows, revision, 304 vs 200). One tautological assertion (N2) and one weak N4 test (N3). Stable across 3 repeat runs. The changelog's verification output matches my re-run: 86/86; statements 15/15/6; benchmark sizes identical and timings within noise; both migrations apply.
4. Fabrication check: ok. No game constants were added. The changelog numbers are reproducible, and the B1 test's failing run against the old source is consistent with my round-1 reproduction.
5. Security: ok.
   - `AUTH_DISABLED=1` is honoured only with empty Access vars and a local host (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). Anything else fails closed with 500, tested end to end with `localhost.evil.com` and `notlocalhost`.
   - The residual risk is documented. The Cloudflare edge routes by Host, so a public request can't arrive as `localhost`.
   - SQL is parameterised; interpolated fragments are constants only.
6. Free-tier constraints: ok, but at the limit. Ingest uses 15 of 15 statements, asserted in a test (no headroom; see N1). The roster uses 6 queries (the stamp stays a single query). The revision triggers add one row write per veteran write, which is negligible. Q-4 (roster size and CPU at 2,000 veterans) is unchanged and disclosed.
7. Scope: ok. Changes outside Owns are `env.d.ts`, `package.json`, `vitest.config.ts`, `scripts/fixture-fingerprint.ts` and `pnpm-lock.yaml`, all declared; plus `docs/OPEN_QUESTIONS.md` (Q-4) and the changelog. No unrelated refactors.
8. Maintainability: ok. Pointer and validation helpers are consolidated in `src/checks.ts`. Migration 0001 is left immutable and the change is a new 0002 with `DB_SCHEMA_VERSION = 2` (tested). Types are strict. There's a stale comment (N1), and `ULID_A` is still unused (round-1 N6).

## Commands run
```
$ git diff --stat main...HEAD | tail -1
 44 files changed, 4852 insertions(+), 23 deletions(-)
$ git diff main...HEAD --stat -- . ':!apps/api/src' ':!apps/api/migrations' ':!apps/api/test'
 apps/api/env.d.ts | 13 ; apps/api/package.json | 3 ; apps/api/scripts/fixture-fingerprint.ts | 9
 apps/api/vitest.config.ts | 23 ; docs/OPEN_QUESTIONS.md | 6 ; docs/changelog/T04-api-core.md | 170 ; pnpm-lock.yaml | 3

$ pnpm -r lint ; echo exit $?
apps/web lint: Done
apps/api lint: Done
exit 0

$ pnpm -r typecheck ; echo exit $?
apps/web typecheck: Done
apps/api typecheck: Done
exit 0

$ pnpm -r test ; echo exit $?
packages/schema test:       Tests  146 passed (146)
apps/web test:       Tests  5 passed (5)
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  86 passed (86)
exit 0

$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!

$ cd apps/api && pnpm exec vitest run --reporter=verbose | grep -E "statements:|benchmark:|roster 304|Tests "
statements: create=15 re-ingest=15 roster=6
roster benchmark: n=260 bytes=1226681 first-request=36.0ms first-parse=2.0ms warm-handler=49.6ms warm-parse=2.6ms
roster 304 (n=260): 1.0ms
roster benchmark: n=2000 bytes=9436001 first-request=228.0ms first-parse=20.0ms warm-handler=236.4ms warm-parse=22.6ms
roster 304 (n=2000): 2.0ms
      Tests  86 passed (86)

$ npx wrangler d1 migrations apply uma-spark-calc --local --persist-to $TMPDIR/t04r2-d1
│ 0001_init.sql            │ ✅     │
│ 0002_roster_revision.sql │ ✅     │

$ for i in 1 2 3; do pnpm exec vitest run test/ingest.test.ts test/roster-parents.test.ts test/review.test.ts test/auth.test.ts | grep "Tests "; done
      Tests  63 passed (63)
      Tests  63 passed (63)
      Tests  63 passed (63)

$ git merge-tree --write-tree --name-only main HEAD
CONFLICT (content): Merge conflict in docs/OPEN_QUESTIONS.md

# Reviewer probes (temporary apps/api/test/zz-probe.test.ts, deleted afterwards; git status clean)
$ pnpm exec vitest run test/zz-probe.test.ts --reporter=verbose
P1 bodies [[201,{"veteranId":"…0002","created":true,…}],[200,{"veteranId":"…0002","created":false,…}] ×5]   # 6 concurrent POSTs, captures X/Y same fingerprint
P1 vets [{"id":"…0002"}]
P1 reviews […5 × "dismissed", {"path":"/stats/sta","status":"open"}]   # matches final low field
P1 low fields [{"path":"/stats/sta"}]
P1 orphans [{"n":0}]
P2 statuses 200 200                                                     # concurrent resolves spd→900, sta→950
P2 reviews [{"path":"/stats/spd","status":"resolved","resolved_value_json":"900"},{"path":"/stats/sta","status":"resolved","resolved_value_json":"950"}]
P2 veteran [{"spd":894,"sta":950}]                                      # spd update lost (S1)
P3 resolve 200 / re-ingest 200 created:false, new open item for the re-flagged path (per 40 §4)
P4 201 200 200 [{"created_at":"2026-09-30T00:00:00.000Z","updated_at":"2026-09-30T00:00:00.001Z"}]   # frozen clock
P5 Error: D1_ERROR: UNIQUE constraint failed: veterans.fingerprint: SQLITE_CONSTRAINT
P6 422 {"errors":[{"path":"/fields/9/path","message":"the field path does not point at a correctable part of the veteran"}]}   # ok-status /trainMode field (S2)
P7 rev [{"revision":3}]

$ git status --short
(empty)
```
