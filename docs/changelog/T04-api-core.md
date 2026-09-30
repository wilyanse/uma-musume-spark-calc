# T04 — API core

- **Status:** Done (two spec claims in 40 §4 don't hold at 2,000 veterans; see Q-4)
- **Branch:** task/T04-api-core
- **Agent / model:** claude-sonnet-5-5
- **Date:** 2026-09-30

## Summary

`apps/api` now implements every endpoint of 01 §3, §4, §8, §9 on Hono + D1 + R2: idempotent ingest (server-side fingerprint check, master-ID check, parent matching, review items), roster with ETag/304, veteran detail/PATCH/DELETE, review queue and resolve, owned-card sync, crops, CM targets and model snapshots. Migration `0001_init.sql` creates the 01 §7 schema (STRICT). Access JWT verification (RS256, JWKS cached 1 h) guards everything but health and fails closed on misconfiguration. All errors are RFC 9457 problem+json. 80 tests run against real migrations in miniflare.

## Files

Created:

- `apps/api/migrations/0001_init.sql` — 01 §7 tables, indexes, plus a trigger (see Decisions)
- `apps/api/src/{auth,deps,http,master,problem,ulid}.ts`, `src/db/veterans.ts`
- `apps/api/src/routes/{veterans,reviews,owned-cards,crops,cm-targets,model-snapshots}.ts`
- `apps/api/scripts/fixture-fingerprint.ts` — recomputes the fixture fingerprint
- `apps/api/test/{ingest,review,roster-parents,roster-benchmark,other-endpoints,auth,master}.test.ts`, `test/helpers/{harness,apply-migrations}.ts`
- `apps/api/test/fixtures/mcqueen.json` and `test/fixtures/master/test-1/*.json` (local master fixture in 01 §11 shapes; T03 not merged yet)
- `docs/changelog/T04-api-core.md`

Modified:

- `apps/api/src/{app,index}.ts` (`createApp(deps)`, routes, auth, problem handlers), `test/health.test.ts`, `vitest.config.ts` (migrations + `AUTH_DISABLED=1` for tests only), `env.d.ts`, `package.json` (`zod` 4.6.5, same as schema), `migrations/.gitkeep` removed
- `docs/OPEN_QUESTIONS.md` — Q-4

## Decisions

- **Injected seams** (`Deps`: `now`, `newId`, `master`, `fetchJson`) so tests are deterministic and the master loader is swappable (hand-off). Default loader reads `/master/<version>/{characters,outfits,skills,sparks,cards,ranks,scenarios}.json` through `ASSETS`, with a per-isolate cache; a missing version (SPA fallback answers HTML) yields `null` → 422 `/masterVersion`. Versions are matched against `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` before being put in a URL.
- **Auth mode** (`resolveAuthMode`): `AUTH_DISABLED=1` is honoured only when `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are both empty. Empty/invalid team domain (must be `<team>.cloudflareaccess.com`), missing `ACCESS_AUD`, or `AUTH_DISABLED` beside a real config → 500 problem "misconfigured" (N5). Health stays open. The spec's "startup assertion" is implemented as this per-request check (Workers have no startup hook); a test also asserts `wrangler.jsonc` never mentions `AUTH_DISABLED`.
- JWT: RS256 only; `iss`, `aud` (string or array), `exp`, `nbf` (60 s leeway); unknown `kid` triggers at most one JWKS refetch per minute; JWKS fetch failure → 503 (never a pass). Verified tokens are memoised per isolate to avoid repeat RSA verifies (CPU budget).
- **422 body**: `errors[] = {path, message}`; zod paths are JSON pointers into the request (`/veteran/stats/spd`). Master-ID failures carry `{kind, path, id, message}` from `checkMasterIds` (path prefixed `/veteran`). Contract messages (`RULE.*`, `OWNED_CARDS_SYNC_RULES[1].message`) are emitted verbatim.
- **Server derives `trainMode`** from the epithet (01 §6) and ignores the payload's value; overrides are preserved by the upsert's `CASE`.
- **Extra ingest checks** not in zod: duplicate `skillId`s (PK would fail), duplicate field paths (PK), `cropKey` must match `crops/<ULID>/<name>.png` (it's later passed to R2 delete).
- **Batching**: child rows go in as one JSON parameter per table, expanded with `json_each`, so no statement nears D1's 100 bound-parameter cap and array order is kept in rowid (review paths like `/sparks/3/stars` index into that order). Ingest = ≤ 14 statements (limit 15).
- **Parent matching** is one `UPDATE` (see `matchParentsStatement`): a non-guest parent with a known outfit matches iff exactly one roster veteran has the same (characterId, outfitId) and its `self` sparks contain every (sparkId, stars) shown for that parent on the child's Inspiration tab. A parent with zero sparks never matches. It re-runs for the veteran, children pointing at it, and children whose parent shares its identity. The child's parent outfit is only known if the agent read it (`outfitId` may be null → no match).
- **Roster ETag** = first 32 hex of sha256(`max(updated_at)|count`). A parent-match change doesn't touch the child row, so a trigger `trg_parent_match_bumps_updated_at` sets the child's `updated_at` to max+1 ms. This keeps the specified ETag formula correct; it's tested.
- **Review resolve**: applies the value to the loaded veteran via JSON pointer (only to existing paths; `__proto__` etc. refused), re-validates the whole `Veteran` with zod and `checkMasterIds`, recomputes the fingerprint (409 with `veteranId` of the clash), then in one batch rewrites the veteran, marks the field `corrected`, resolves the item and re-matches. `/sparks/<owner>` (pseudo-pointer) takes that owner's full list `[{sparkId,type,stars}]`. `/trainMode` isn't correctable via a review item (use PATCH).
- **Crops**: `GET /crops/<cropKey>` (key = `crops/<id>/<urlencoded path>.png`, so URLs read `/crops/crops/…`; a single fully-encoded segment also works). PNG magic checked, ≤ 60 KB, 413/415 otherwise. Deleting a veteran deletes its crops.
- `GET /model-snapshots` returns the latest (optionally `?kind=`), 404 if none; POST keeps the newest 20 per kind. `cm-targets` POST accepts an optional client ULID `id`; the server generates one otherwise. `PUT /owned-cards` returns `{count, partial, syncedAt}` and also rejects card IDs unknown to the master version (uses the same loader).
- `DB_SCHEMA_VERSION = 1`, tested against the last migration file name.
- Extra indexes beyond 01 §7 (`veteran_parents(character_id, outfit_id)`, `review_items(veteran_id)`, `model_snapshots(kind, trained_at)`) support the matching/join/latest queries.

## Deviations from spec

- 40 §3: "startup assertion" for `AUTH_DISABLED` is a per-request fail-closed check (no startup hook on Workers).
- 40 §4 "roster < 2 MB at 2,000 veterans" and the 10 ms CPU budget don't hold (Q-4): 260 veterans = 1.23 MB, 2,000 = 9.4 MB. Implemented as specified; not asserted at 2,000.
- 01 §7 gets a trigger and 3 extra indexes (above); tables/columns are unchanged, except that NOT NULL was added to columns that are always present (e.g. `veteran_sparks.type`).

## Cross-task edits

- `pnpm-lock.yaml` — adds `zod` 4.6.5 as a direct dependency of `apps/api` (3 lines).

## Verification

```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test     (exit 0 for all three; grep of output)
packages/schema test:  Test Files  4 passed (4)
packages/schema test:       Tests  146 passed (146)
apps/web test:  Test Files  1 passed (1)
apps/web test:       Tests  5 passed (5)
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  80 passed (80)

$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!

# statement counts (test "D1 statement budget"; a batch counts each statement) and roster benchmark
$ cd apps/api && pnpm exec vitest run --reporter=verbose | grep -E "statements:|benchmark:|roster 304"
statements: create=14 re-ingest=14 roster=6
roster benchmark: n=260 bytes=1226681 first-request=35.0ms first-parse=3.0ms warm-handler=30.2ms warm-parse=2.6ms
roster 304 (n=260): 1.0ms
roster benchmark: n=2000 bytes=9436001 first-request=228.0ms first-parse=20.0ms warm-handler=228.6ms warm-parse=22.4ms
roster 304 (n=2000): 2.0ms

$ cd apps/api && npx wrangler d1 migrations apply uma-spark-calc --local
🚣 19 commands executed successfully.  | 0001_init.sql | ✅ |
```

The benchmark numbers are wall-clock inside miniflare on the dev Mac, **not** Worker CPU time; the free-tier 10 ms CPU limit can't be measured locally and must be confirmed after H2 (Q-4). Statement counts: ingest 14 (≤ 15), roster 6 (≤ 6).

40 §5 acceptance mapping:

- 422 validation, fingerprint mismatch, parent-rule violation, unknown master IDs, unreadable-parent flag: `ingest.test.ts`
- idempotent re-ingest, override preserved: `ingest.test.ts`
- review resolve updates value + fingerprint (+409 collision, `/sparks/<owner>`, pointer safety): `review.test.ts`
- owned-cards count mismatch (+`?partial=1`, duplicates, unknown IDs): `other-endpoints.test.ts`
- golden ingest of `test/fixtures/mcqueen.json` → roster equality: `ingest.test.ts`
- statement count, benchmark: `ingest.test.ts`, `roster-benchmark.test.ts`
- auth (401 on all routes, JWT claims, fail-closed config), unknown routes → problem+json: `auth.test.ts`, `health.test.ts`

## Open questions / follow-ups

- Q-4: roster size / CPU budget claims in 40 §4.
- Follow-up: the fixture `mcqueen.json` is hand-built from screenshots 01–06/10 (guest parent = T.M. Opera O; parent 1 = Special Week; skill/spark/card IDs are slugs of the visible names; deck card names aren't legible so cards are `card:fixture-card-N`). Replace with the T09 labels when they land.
- Follow-up: the local master fixture (`test/fixtures/master/test-1`) should be swapped for `apps/web/public/master/latest.json` once T03 is on main (loader is already injectable; production reads it through `ASSETS`).
- Follow-up (T12): set real `ACCESS_TEAM_DOMAIN` (var) and `ACCESS_AUD` (secret); until then every non-health route answers 500 "misconfigured" outside tests/`.dev.vars`. Local dev needs `.dev.vars` with `AUTH_DISABLED=1`.
- Follow-up: parent matching only sees parents whose outfit the agent captured; grandparent-level matching isn't part of the spec.
- Not verified: default `assetsMasterLoader` against a real `ASSETS` binding (tested with a fake Fetcher only; no built web assets yet).

## Review round 1

Review: `docs/reviews/T04-review-1.md` (CHANGES_REQUESTED). Both blocking items and S1–S4 are fixed, each with a regression test; N4 is partly fixed. No rebase, merge or push; 01 contract unchanged.

### B1 — concurrent identical POSTs (fixed)
- Cause: `id` came from a pre-read outside the batch, so a racing request bound its child/review rows to an id the upsert then discarded.
- Fix: the handler no longer pre-reads. Every child insert/delete, `capture_fields`, `review_items` and the parent-match statement resolve the veteran with `(SELECT id FROM veterans WHERE fingerprint = ?1)` inside the same D1 batch. The upsert ends with `RETURNING id, created_at = updated_at AS created`; the response uses that row, so `veteranId` is the persisted id and `created` comes from the database. `updated_at` is forced strictly after `created_at` on conflict so the flag can't be wrong at a frozen clock.
- New review items are inserted only where no open item exists for that (veteran, path); a final SELECT in the batch returns the persisted item ids for `reviewItemIds`.
- Test `concurrent identical ingests (B1)`: three identical POSTs in `Promise.all`. Asserts one veteran, every response carries the stored id, zero orphan child/field/review rows, the same spark count as a single ingest, exactly one review item, ≤ 1 `created:true`. Run against the old code it failed (`expected 3 to be less than or equal to 1`).
- Statement budget: create=15, re-ingest=15 (with a review item; the count includes the final SELECT), roster=6. Limit is 15, asserted for both. There is no headroom left.

### B2 — undeclared files (fixed by declaration)
See *Cross-task edits* below (the same section is extended, not duplicated). `scripts/fixture-fingerprint.ts` was not moved.

### S1 — stale roster ETag (fixed)
Migration `0002_roster_revision.sql` (DB_SCHEMA_VERSION 2): drops the `updated_at`-bumping trigger and adds a one-row `roster_meta.revision`, incremented by triggers on veterans INSERT/UPDATE/DELETE and on `veteran_parents.matched_veteran_id` changes. ETag = sha256(`max(updated_at)|count|revision`). Nothing touches `updated_at` except the write itself, so no clock drift ahead. Test `S1` runs at a frozen clock: parent-match ingest, patch parent, and delete parent each produce 200 (not 304) for the old tag. Side effect: the empty roster after a delete no longer has the same ETag as the initial empty roster (the existing test was changed to expect 4 distinct tags).

### S2 — duplicate skill on resolve (fixed)
`src/checks.ts` `extraVeteranChecks` (duplicate skillId, and duplicate owner+sparkId) is shared by ingest and resolve, so resolve answers 422 with path `/veteran/skills/2/skillId`. 409 is only mapped from a UNIQUE error mentioning `veterans.fingerprint`. Test `S2`.

### S3 — stale/unresolvable review items (fixed)
- (a)/(b): the ingest batch sets open items to `dismissed` (with `resolved_at`) when their path is not low-confidence in this capture, including when the field is gone. A later low-confidence read opens a fresh item. Test `re-ingest dismisses open items…`.
- (c): ingest now 422s a field path that doesn't resolve in the veteran (or isn't `/sparks/parent1|2`, and `/trainMode`) at `/fields/<i>/path`. The old test that accepted `/nope/deeper` became a 422 test (also covers `__proto__`, `/sparks/99/stars`). Shared pointer helpers moved to `src/checks.ts`.
- Behaviour change to note: captures whose agent emits field paths outside the veteran (e.g. non-correctable `/trainMode`) are now rejected. 01 §3 doesn't say either way.

### S4 — AUTH_DISABLED (fixed)
`resolveAuthMode(env, host)` honours `AUTH_DISABLED=1` only when the ACCESS vars are empty AND the request host is `localhost`, `127.0.0.1`, `[::1]` or `*.localhost`. Any other host with the flag set → 500 "misconfigured" (fail closed). Tests: local hosts allowed; `uma.example.workers.dev`, `example.com`, `localhost.evil.com`, `notlocalhost` refused, end to end through the app. The test harness now calls `https://localhost/…`. Residual risk: a deployment reachable under the host name `localhost` (not possible via workers.dev or a Cloudflare zone). `wrangler dev` serves `localhost`, so local dev is unaffected.

### N4 — spark-index invalidation (partly fixed; follow-up)
Resolving `/sparks/<owner>` now replaces that owner's block in place instead of moving it to the end, so other owners' indices don't move. It is not fully fixed: if the new list has a different length than the old one, indices of later sparks (`/sparks/<n>/…`) in other open items still shift. A complete fix needs review paths that don't depend on array position (e.g. `/sparks/<owner>/<sparkId>/stars`), which changes the field-path contract in 01, so I did not do it. Follow-up: raise with the spec owner; the `N4` test asserts only that the untouched owners' order is preserved (it is weak; it does not cover the index-shift case above).

### Not addressed
N1, N2, N3, N5 (OPEN_QUESTIONS entry), N6, N7. Q-4 kept as is; the orchestrator renumbers on merge.

### Cross-task edits (extended)
- `apps/api/package.json` — T02 skeleton file; adds the direct `zod` 4.6.5 dependency (same version as `packages/schema`); the lockfile change above follows from it.
- `apps/api/vitest.config.ts` — T02 file; reads `migrations/` with `readD1Migrations` and injects `TEST_MIGRATIONS` plus `AUTH_DISABLED=1` (tests only; never in `wrangler.jsonc`).
- `apps/api/env.d.ts` — T02 file; declares the new bindings/vars used by the API (`AUTH_DISABLED`, `TEST_MIGRATIONS`, Access vars) so `typecheck` passes.
- `apps/api/scripts/fixture-fingerprint.ts` — new, in a path no card owns; a dev script recomputing `test/fixtures/mcqueen.json`'s fingerprint. Kept because the fixture is regenerated by hand; it could be moved to `test/helpers/` if the orchestrator prefers.

### Verification
```
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test     (exit 0)
packages/schema test:  Test Files  4 passed (4)
packages/schema test:       Tests  146 passed (146)
apps/web test:  Test Files  1 passed (1)
apps/web test:       Tests  5 passed (5)
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  86 passed (86)

$ pnpm exec prettier --check apps/api
All matched files use Prettier code style!

$ cd apps/api && pnpm exec vitest run --reporter=verbose | grep -E "statements:|benchmark:|roster 304"
statements: create=15 re-ingest=15 roster=6
roster benchmark: n=260 bytes=1226681 first-request=33.0ms first-parse=3.0ms warm-handler=28.4ms warm-parse=2.6ms
roster 304 (n=260): 1.0ms
roster benchmark: n=2000 bytes=9436001 first-request=250.0ms first-parse=20.0ms warm-handler=233.4ms warm-parse=21.2ms
roster 304 (n=2000): 2.0ms

$ npx wrangler d1 migrations apply uma-spark-calc --local --persist-to $TMPDIR/t04-d1
│ 0001_init.sql            │ ✅ │
│ 0002_roster_revision.sql │ ✅ │

# B1 test against the pre-fix source (src/ and migrations/ stashed):
× Promise.all of identical POSTs: one veteran, no orphans, one review set, ≤ 1 created:true
AssertionError: expected 3 to be less than or equal to 1
```
