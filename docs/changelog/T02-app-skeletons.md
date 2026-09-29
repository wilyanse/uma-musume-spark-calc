# T02 — App skeletons

- **Status:** Done
- **Branch:** task/T02-app-skeletons
- **Agent / model:** Claude Sonnet 5.5, reasoning low
- **Date:** 2026-09-29

## Summary
`apps/api`: Hono Worker with unauthenticated `GET /api/v1/health` (typed by `@uma/schema` `HealthResponse`), `wrangler.jsonc` (bindings `DB`, `CROPS`, `ASSETS`, `run_worker_first: ["/api/*"]`, SPA fallback), empty `migrations/`, Vitest + `@cloudflare/vitest-pool-workers`. `apps/web`: Vite + React 19 + TS SPA with React Router placeholders for all 60 §2 routes, TanStack Query provider, a Comlink engine worker calling a stub `ping`, and a `VITE_FIXTURES=1` switch. `wrangler dev` serves SPA and API together.

## Files
Created:
- `apps/api/{package.json,tsconfig.json,wrangler.jsonc,vitest.config.ts,env.d.ts,migrations/.gitkeep}`
- `apps/api/src/{app.ts,index.ts}`, `apps/api/test/health.test.ts`
- `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,public/.gitkeep,fixtures/.gitkeep}`
- `apps/web/src/{main.tsx,router.tsx,vite-env.d.ts}`, `src/routes/{Layout,Placeholder}.tsx`, `src/api/{mode,client}.ts`, `src/workers/{engine.api,engine.worker,client}.ts`
- `apps/web/test/skeleton.test.tsx`

Modified:
- `pnpm-lock.yaml`, `pnpm-workspace.yaml` (see Cross-task edits)

## Decisions
- **Compat date `2026-08-01`**, not a newer one: installed workerd supports up to 2026-08-22; `2026-09-01` failed miniflare startup.
- **Vitest 4.1.11 in `apps/api`** (root has 5.0.2): `@cloudflare/vitest-pool-workers@0.22.0` peers on vitest `^4.1.0`. `@vitest/runner`/`@vitest/snapshot` pinned to 4.1.11 as peers. Web uses the root 5.0.2.
- Vite 8.3.1 + `@vitejs/plugin-react` 6.1.1 (its peer requires vite 8). `react-router` 8.4.0 (single package; `react-router/dom` for `RouterProvider`).
- `dbSchemaVersion` is `0` and `masterVersion` comes from var `MASTER_VERSION` (`"unversioned"`) until T04/T03 provide real values.
- `database_id` is an all-zero placeholder; real IDs and `ACCESS_TEAM_DOMAIN` come from T12/H2. `AUTH_DISABLED` is not defined anywhere in wrangler config; JWT check and startup assertion are T04.
- `src/index.ts` routes `/api/*` to Hono and falls back to `ASSETS.fetch` for anything else.
- Fixture mode maps `/api/v1/<x>` to `/fixtures/<x>.json`. `apps/web/fixtures/` is empty (golden dataset lands with T13/70 §2); note Vite serves `public/` only, so T13 must decide whether fixtures are copied to `public/fixtures` or imported.
- pnpm 11 build-script approval: `allowBuilds: esbuild, workerd = true`.
- Bundle: main JS 107.66 kB gzip (limit 250 kB), worker chunk 4.12 kB.
- Design tokens (`pnpm --filter web tokens`) and CSS Modules are not part of the skeleton (depend on T07).

## Deviations from spec
- None. (`pnpm --filter web tokens` script omitted until T07's `docs/design/tokens.json` exists.)

## Cross-task edits
- `pnpm-lock.yaml` — regenerated for new workspace packages.
- `pnpm-workspace.yaml` — pnpm added `allowBuilds` (esbuild, workerd) and two `minimumReleaseAgeExclude` entries (`hono@4.13.11`, `@cloudflare/workers-types@5.20260929.1`, both too new for the release-age gate). Likely to conflict textually with other tasks' edits; trivial to merge.

## Verification
```
$ pnpm --filter api test
 RUN  v4.1.11 .../apps/api
 Test Files  1 passed (1)
      Tests  2 passed (2)

$ pnpm --filter web build
$ tsc -p tsconfig.json && vite build
vite v8.3.1 building client environment for production...
✓ 146 modules transformed.
dist/index.html                          0.32 kB │ gzip:   0.23 kB
dist/assets/engine.worker-Crm6So1O.js    4.12 kB
dist/assets/index--uMx3vdd.js          342.97 kB │ gzip: 107.66 kB
✓ built in 106ms

$ pnpm -r lint && pnpm -r typecheck && pnpm -r test     (all exit 0)
packages/schema test:  Tests  124 passed (124)
apps/web test:  Tests  5 passed (5)
apps/api test:  Tests  2 passed (2)

$ pnpm exec prettier --check apps package.json
All matched files use Prettier code style!

$ cd apps/api && npx wrangler dev --port 8799   # after web build
[wrangler:info] Ready on http://localhost:8799
$ curl -si localhost:8799/api/v1/health
HTTP/1.1 200 OK
Content-Type: application/json

{"ok":true,"masterVersion":"unversioned","dbSchemaVersion":0}
$ curl -si localhost:8799/          -> HTTP/1.1 200 OK, Content-Type: text/html; charset=utf-8 (<!doctype html> SPA index)
$ curl -si localhost:8799/planner   -> HTTP/1.1 200 OK, text/html (SPA fallback)
$ curl -si localhost:8799/assets/engine.worker-Crm6So1O.js -> HTTP/1.1 200 OK, text/javascript
```
Not verified: the Comlink worker running in a real browser (the unit test covers the stub API only, not the Worker/Comlink transport).

## Open questions / follow-ups
- No Q-entries added.
- Follow-up: T04 adds JWT verification, real migrations, `AUTH_DISABLED` startup assertion; T12 real D1 id / team domain and `env.production`.
- Follow-up: T13 fixtures location and tokens/CSS Modules once T07 lands.
- Follow-up: the two vitest majors (4 in api, 5 in web/root) can be unified when the Workers pool supports vitest 5.
