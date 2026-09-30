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
