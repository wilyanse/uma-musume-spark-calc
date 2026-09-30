# T12 — DevOps

- **Status:** Partial
- **Branch:** task/T12-devops
- **Agent / model:** gpt-5.6-luna-900k, effort standard/full implementation pass
- **Date:** 2026-09-30

## Summary

Added pinned GitHub Actions workflows for PR/push CI, production deployment after successful main CI, weekly D1 exports, and tagged Windows agent releases. CI uses the actual current package filters and builds the web from committed master data without running the upstream master-data fetch.

Added the production Wrangler environment with the required D1/R2/static-asset bindings and fail-closed auth configuration, plus complete Cloudflare setup and D1 backup/restore runbooks. Real deployment remains blocked on H2 account/resource/secret provisioning.

## Files
Created:
- `.github/workflows/ci.yml` — pinned TS, web bundle, audit, and conditional .NET gates.
- `.github/workflows/deploy.yml` — CI-gated production migrations and deploy.
- `.github/workflows/backup.yml` — weekly remote D1 SQL export and 90-day artifact.
- `.github/workflows/agent-release.yml` — tagged Windows single-file release.
- `docs/runbooks/cloudflare-setup.md` — exact H2 setup, verification, security, and scaling procedure.
- `docs/runbooks/backup.md` — scheduled/manual backup, restore, and Time Travel procedure.

Modified:
- `apps/api/wrangler.jsonc` — added complete `env.production` bindings/vars without `AUTH_DISABLED`.

## Decisions

- GitHub Actions third-party actions are pinned to immutable commit SHAs; comments record the fetched action versions.
- CI runs `lint`, `typecheck`, and `test` for exactly `@uma/schema`, `@uma/master-data`, `api`, and `web`. It does not use `pnpm -r build`; the web build consumes committed `apps/web/public/master` data.
- T09/T10 .NET gates activate when their projects exist. Before then they print an explicit queued-project message and make no claim that tests passed. Once projects exist, the required test/build commands run and fail normally.
- The production environment repeats assets, D1, R2, and vars because Wrangler environment bindings/vars are non-inheritable. It keeps Worker name `uma-spark-calc` and leaves the D1 ID/team domain as H2-controlled placeholders.
- `/api/v1/health` remains public at the Worker JWT layer, but the hostname-level Access application protects the whole hostname, including static SPA/master routes and health at the edge. The runbook does not claim that health is publicly reachable through Access.
- Q-100 through Q-109 are reserved for H2 setup follow-ups, as directed; no account-specific values were invented.
- The weekly backup uses GitHub Actions artifacts with 90-day retention and documents the repository-policy caveat. D1 Time Travel is documented as supplementary recovery, not a replacement for an independent export.
- Cloudflare limits/security details were checked against the current official docs on 2026-09-30: Workers platform limits, D1 limits, R2 pricing, Wrangler environments, Access, service tokens, secrets, and GitHub CI docs.

## Deviations from spec

- `65 §7`: status is `Partial`, not Done, because no Cloudflare account/resources/secrets were provisioned in this session and no real deployment or GitHub Actions run can be performed. The exact human steps are in `docs/runbooks/cloudflare-setup.md`.
- `65 §4`: CI's future T09/T10 checks are conditional only while those projects are absent; they are not silently skipped once project files land.
- The current GitHub repository reports zero Actions runs, so no run URL exists to record. Local equivalents and the real Wrangler dry-run are recorded below.

## Cross-task edits

- None.

## Verification

```
$ pnpm install --frozen-lockfile
Packages are cloned from the content-addressable store to the virtual store.
Progress: resolved 246, reused 246, downloaded 0, added 246, done
Done in 6.2s using pnpm v11.22.0

$ for p in @uma/schema @uma/master-data api web; do pnpm --filter "$p" lint; pnpm --filter "$p" typecheck; pnpm --filter "$p" test; done
@uma/schema: eslint .
@uma/schema: tsc -p tsconfig.json
@uma/schema: Test Files 4 passed (4); Tests 146 passed (146)
@uma/master-data: eslint src test vitest.config.ts
@uma/master-data: tsc -p tsconfig.json
@uma/master-data: Test Files 3 passed (3); Tests 82 passed (82)
api: eslint .
api: tsc -p tsconfig.json
api: Test Files 8 passed (8); Tests 86 passed (86)
web: eslint .
web: tsc -p tsconfig.json
web: Test Files 1 passed (1); Tests 5 passed (5)

$ pnpm --filter web build
$ tsc -p tsconfig.json && vite build
✓ 146 modules transformed.
dist/index.html 0.32 kB | gzip 0.23 kB
dist/assets/engine.worker-Crm6So1O.js 4.12 kB
dist/assets/index--uMx3vdd.js 342.97 kB | gzip 107.66 kB
✓ built in 111ms

$ gzip -9 -c apps/web/dist/assets/index--uMx3vdd.js | wc -c
106265

$ find agent -name '*.csproj' -type f -print
Agent projects are not present yet (T09/T10 queued); no claim of a pass.

$ pnpm exec prettier --check .github/workflows apps/api/wrangler.jsonc docs/runbooks
Checking formatting...
All matched files use Prettier code style!

$ pnpm exec wrangler deploy --env production --dry-run --outdir .wrangler/t12-dry-run
⛅️ wrangler 4.143.0
✨ Read 19 files from the assets directory .../apps/web/dist
Total Upload: 894.76 KiB / gzip: 150.75 KiB
Your Worker has access to the following bindings:
env.DB (uma-spark-calc) D1 Database
env.CROPS (uma-spark-calc-crops) R2 Bucket
env.ASSETS Assets
env.ACCESS_TEAM_DOMAIN ("") Environment Variable
env.MASTER_VERSION ("global-20260930") Environment Variable
--dry-run: exiting now.

$ git diff --check
(exit 0)
```

The dry-run output was generated locally and the ignored `.wrangler/t12-dry-run` directory was removed before the final API lint verification; the generated bundle is not part of the commit.

## Open questions / follow-ups

- Q-100–Q-109: reserved for H2 setup follow-ups; no entries were added because `OPEN_QUESTIONS.md` is outside this task's ownership.
- Follow-up: H2 must create the Cloudflare account/Zero Trust team, D1 database, R2 bucket, Access application/policies, `uma-agent` service token, and scoped API token; set the real D1 ID/team domain and Worker secret `ACCESS_AUD`; add the two GitHub secrets; then run the setup verification and first deploy.
- Follow-up: H2 must inspect production Worker CPU time in Cloudflare Metrics. Local wall-time benchmarks do not establish the 10 ms CPU limit; Q-4 remains the roster scaling risk.
- Follow-up: after T09/T10 land, confirm the conditional .NET CI gates run and agent tags publish the expected executable.
