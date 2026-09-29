# 40 — API (Cloudflare Worker)

Owner tasks: **T04** (API core), **T12** (deploy config with devops). Folder: `apps/api`.

## 1. Stack
- Hono on Cloudflare Workers, with the `wrangler.jsonc` config. Bindings: `DB` (D1 `uma-spark-calc`), `CROPS` (R2 `uma-spark-calc-crops`), `ASSETS` (the static SPA from `apps/web/dist`).
- Validate requests with the zod schemas from `@uma/schema`.
- Test with Vitest + `@cloudflare/vitest-pool-workers` (miniflare D1/R2) using real migrations.

## 2. Routing
- `/api/v1/*` → Hono. Everything else → `ASSETS` with an SPA fallback to `index.html`. Set `assets.run_worker_first` to `["/api/*"]` so static requests never invoke the Worker.
- Endpoints: exactly the list in 01 §3, §4, §8 and §9.

## 3. Authentication
- Cloudflare Access protects the whole hostname. The Worker **also** verifies the `Cf-Access-Jwt-Assertion` JWT on every `/api/*` request except `/api/v1/health`:
  - fetch the JWKS from `https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/certs` and cache it for 1 h;
  - check `aud == ACCESS_AUD` and `iss == https://<TEAM>.cloudflareaccess.com`.
- Environment (exact names): `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`), `ACCESS_AUD`. In local dev and tests, `AUTH_DISABLED=1` skips the check. It must be impossible to set in production: wrangler `env.production` doesn't define it, and a startup assertion checks that.
- The agent's service-token requests also arrive with a valid Access JWT (Access issues one for service tokens), so there's one code path.

## 4. Behaviour details
- **Ingest** (`POST /veterans`): validate (01 §3). Recompute the fingerprint server-side and reject 422 on mismatch. Upsert by fingerprint inside a D1 `batch()`: delete then insert the child rows. Keep `mode_source='override'` rows' `train_mode`. Create `review_items` for `low_confidence` fields that don't already have an open item for the same path.
- **Parent matching:** after an insert, set `veteran_parents.matched_veteran_id` for each non-guest parent whose (characterId, outfitId) has **exactly one** veteran in the roster whose own sparks are a superset of the parent's sparks shown on the child's Inspiration tab. Leave it NULL otherwise. Run the same pass for existing children when a new veteran arrives.
- **Roster** (`GET /roster`): one JSON document, with the ETag = hash of `max(updated_at)` + count. At 260–2,000 veterans it stays < 2 MB.
- **D1 free tier:** 50 queries per invocation. Ingest must stay ≤ 15 statements, using batch with multi-row `INSERT … VALUES (…),(…)`. The roster read uses ≤ 6 queries (one per table), then assembles in JS. Add a test that counts the statements.
- **Worker CPU on the free tier is 10 ms per request.** Keep the handlers light: no ranking or model fitting server-side (that happens in the browser). JSON parsing of an 1–2 MB roster is the heaviest step, so benchmark it in a test with 2,000 synthetic veterans and record the result in the changelog.
- **Errors:** RFC 9457 problem+json `{type,title,status,detail,errors?}`.

## 5. Acceptance (T04)
- Integration tests cover each endpoint's happy path and main error paths: 422 validation, fingerprint mismatch, parent rule violation, idempotent re-ingest, override preserved, review resolve updates the value and fingerprint, and the owned-cards count mismatch.
- A golden ingest test posts the fixture `VeteranCapture` produced from the T09 labels (T04 writes its own until T09 lands: `apps/api/test/fixtures/mcqueen.json` built from 01 §3 and the screenshots) and checks the roster output.
- The statement-count test and the CPU benchmark are recorded in the changelog.
