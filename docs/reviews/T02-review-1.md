# T02 review, round 1 (claude-opus-5-5, high)

## Verdict: PASS

## Blocking
(none)

## Should fix
- [S1] apps/web/src/api/mode.ts:2 and :4-6 — `FIXTURE_MODE` repeats the `=== '1'` comparison inline instead of calling `isFixtureMode`. The test at apps/web/test/skeleton.test.tsx:32-36 checks only the helper, which production never calls, so the real switch is not tested. I confirmed by hand that it works (`VITE_FIXTURES=1 vite build` puts `data source: fixtures` into the bundle), but no test would catch a regression. Suggestion: `export const FIXTURE_MODE = isFixtureMode(import.meta.env.VITE_FIXTURES);`.
- [S2] apps/web/src/api/client.ts:5 together with apps/web/vite.config.ts:4-8 — fixture mode points requests at `/fixtures/<x>.json`, but nothing serves `apps/web/fixtures/` (Vite only serves `public/`). Under `wrangler dev`, `GET /fixtures/roster.json` returned `200 text/html` (the SPA fallback), so turning fixture mode on today would fail at the JSON parse, not with a clear error. The changelog says so openly (Decisions, 5th bullet). T13 owns only `apps/web/src/**`, so fixing it via `vite.config.ts` would be a cross-task edit. Suggestion: record this in the T13 hand-off, or load fixtures from `src` with `import.meta.glob('../../fixtures/*.json')` so T13 can fix it without leaving its Owns paths.
- [S3] apps/web/src/api/client.ts:9-15 — `getJson` and `getHealth` are exported but nothing calls them (only `dataUrl` is tested). This is dead code in the skeleton, and TanStack Query is set up in main.tsx with no query using it. Suggestion: either wire one placeholder (for example `/health`) to `useQuery(getHealth)` so the API client, `credentials: 'include'` and fixture paths actually run end to end, or drop `getHealth` until T13.

## Nits
- [N1] apps/web/tsconfig.json:4 — `lib` puts `DOM` and `WebWorker` in one program. They have overlapping global declarations, and this only passes because of `skipLibCheck`. A separate tsconfig for `src/workers/*.worker.ts` would be cleaner once the engine worker grows.
- [N2] apps/api/src/app.ts (Hono default notFound) — unknown `/api/v1/*` routes return `404 text/plain "404 Not Found"`, not RFC 9457 problem+json (40 §4). That is T04's job, but it's worth putting in the T04 hand-off because the skeleton test at apps/api/test/health.test.ts:13-16 locks in only the status code.
- [N3] pnpm-workspace.yaml:2-3 — `prettier --check` fails on this file. The double quotes were already on `main`, so T02 didn't cause it, but the changelog's prettier command left out the one non-lockfile shared file it touched.
- [N4] The changelog verification trims the API test output to totals only. That's fine, but the curl block leaves out `Content-Length`, so it isn't verbatim. What I reproduced matches it apart from that.
- [N5] apps/api/wrangler.jsonc:23 — `ACCESS_TEAM_DOMAIN: ""` is an empty-string var. T04/T12 should treat an empty value as misconfiguration and not as "no issuer check".

## Checklist
1 Spec conformance: ok.
   - `pnpm --filter api test` hits `/api/v1/health` via `SELF.fetch` in miniflare and validates it with `HealthResponse.parse`. It passes even without a prior web build.
   - `pnpm --filter web build` passes. Main bundle is 107.66 kB gzip, under the 250 kB limit.
   - `wrangler dev` serves the SPA, the SPA fallback for deep links, the worker chunk and `/api/v1/health` together. I reproduced this.
   - Bindings `DB`/`CROPS`/`ASSETS`, names `uma-spark-calc` and `uma-spark-calc-crops`, and `run_worker_first: ["/api/*"]` match 40 §1-2 and 65 §2.
   - All 8 routes from 60 §2 are present.
   - The health body `{ok, masterVersion, dbSchemaVersion}` matches 01 §9.
   - I checked the Comlink transport in a real browser, which the worker could not: `/targets/abc` rendered `params: {"id":"abc"}` and `engine worker: pong:web`.
2 Correctness: ok for a skeleton. `index.ts` sends `/api/*` to Hono and everything else to ASSETS. Fixture-mode data path is broken (S2).
3 Test quality: minor issues (S1). The tests assert real behaviour: miniflare health contract, a 404 for an unknown route, SSR render of `/planner`, and the URL mapping. No skips or snapshots. The changelog verification matches my re-runs: schema 124, web 5, api 2, and the same bundle hashes and sizes.
4 Fabrication check: ok. No game constants. `masterVersion` comes from a var and `dbSchemaVersion: 0` is declared as a placeholder. The changelog output is real (reproduced).
5 Security: ok. Only health is exposed, and a comment requires T04's JWT gate on every other route. `AUTH_DISABLED` is not defined in wrangler config. `.dev.vars` is gitignored. No secrets; `database_id` is an all-zero placeholder. The startup assertion is left to T04, as the changelog notes.
6 Free-tier constraints: ok. Static assets bypass the Worker (`run_worker_first` covers `/api/*` only), health makes no D1 calls, and no paid features are used.
7 Scope: ok. The diff touches only `apps/api/**`, `apps/web/**` and the T02 changelog, plus `pnpm-lock.yaml` and `pnpm-workspace.yaml`, both declared under Cross-task edits.
8 Maintainability: minor issues (S3, N1). Dependencies are pinned exactly (no `^`), strict mode comes from the base tsconfig, and there are no TODOs. The split Vitest 4/5 versions are justified by the pool-workers peer dependency and listed as a follow-up.

## Commands run
```
$ git diff --stat main...HEAD
 apps/api/{env.d.ts,migrations/.gitkeep,package.json,src/app.ts,src/index.ts,test/health.test.ts,tsconfig.json,vitest.config.ts,wrangler.jsonc}
 apps/web/{fixtures/.gitkeep,index.html,package.json,public/.gitkeep,src/**,test/skeleton.test.tsx,tsconfig.json,vite.config.ts}
 docs/changelog/T02-app-skeletons.md | 92 ++
 pnpm-lock.yaml | 2301 +++---
 pnpm-workspace.yaml | 5 +
 29 files changed, 2610 insertions(+), 159 deletions(-)

$ pnpm install --frozen-lockfile
Already up to date

$ pnpm -r lint          -> packages/schema, apps/api, apps/web: Done (exit 0)
$ pnpm -r typecheck     -> packages/schema, apps/web, apps/api: Done (exit 0)

$ pnpm -r test
packages/schema test:       Tests  124 passed (124)
apps/web test:  RUN  v5.0.2 …/apps/web
apps/web test:       Tests  5 passed (5)
apps/api test:  RUN  v4.1.11 …/apps/api
apps/api test:       Tests  2 passed (2)
EXIT 0

$ rm apps/web/dist && pnpm --filter api test     # health test independent of web build
 Test Files  1 passed (1)
      Tests  2 passed (2)

$ pnpm --filter web build
✓ 146 modules transformed.
dist/index.html                          0.32 kB │ gzip:   0.23 kB
dist/assets/engine.worker-Crm6So1O.js    4.12 kB
dist/assets/index--uMx3vdd.js          342.97 kB │ gzip: 107.66 kB
EXIT 0

$ cd apps/api && pnpm exec wrangler dev --port 8817
$ curl -si localhost:8817/api/v1/health
HTTP/1.1 200 OK
Content-Length: 61
Content-Type: application/json

{"ok":true,"masterVersion":"unversioned","dbSchemaVersion":0}
$ curl -si localhost:8817/                 -> 200 text/html; charset=utf-8, <!doctype html> … /assets/index--uMx3vdd.js
$ curl -si localhost:8817/planner          -> 200 text/html (SPA fallback)
$ curl -si localhost:8817/veterans/abc     -> 200 text/html (SPA fallback)
$ curl -si localhost:8817/assets/engine.worker-Crm6So1O.js -> 200 text/javascript, Content-Length: 4123
$ curl -si localhost:8817/api/v1/nope      -> 404 text/plain "404 Not Found"
$ curl -si localhost:8817/fixtures/roster.json -> 200 text/html (SPA fallback, see S2)

# browser (Chromium via CDP) at http://localhost:8817/targets/abc
rosterreviewcardstargetsplannerhealth
Target
Placeholder screen (T13).
params: {"id":"abc"}
data source: api
engine worker: pong:web

$ VITE_FIXTURES=1 vite build --outDir <scratch>
… (0,b.jsxs)(`p`,{children:[`data source: `,`fixtures`]}) …

$ pnpm exec prettier --check apps package.json pnpm-workspace.yaml docs/changelog/T02-app-skeletons.md
[warn] pnpm-workspace.yaml          # also fails on main (pre-existing double quotes)

$ grep -rn "TODO\|FIXME" apps   -> no TODOs
$ git status --short            -> clean (worktree unchanged)
```
