# T12 independent review — round 1

Requested reviewer: claude-opus-5-5 / anthropic, medium; profile fallback disabled. Session: 20260930_184837_c7f723.

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] .github/workflows/deploy.yml:3-14,20 — The privileged deploy job trusts any successful CI run whose head_branch is `main`. It never checks `github.event.workflow_run.event` or `head_repository`. CI runs on every `pull_request` (ci.yml:4), the repo is public (GitHub API returns `"visibility": "public"`), and the `workflow_run` `branches` filter matches the PR's head branch name. So a PR from a fork's branch named `main` gives CI conclusion success, and deploy.yml then checks out that fork's `head_sha`. It runs `pnpm install` and the build (untrusted code) with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment, and deploys it to production. `environment: production` only helps if H2 adds required reviewers, and nothing documents that. Required fix: gate the job on `github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository` (plus conclusion success). Document the `production` environment protection (deployment branch = main, optionally a required reviewer) in cloudflare-setup.md.
- [B2] .github/workflows/deploy.yml:12-20 — There is no `concurrency` group and no freshness check. Two quick pushes to main give two workflow_run deploys that can overlap, so remote D1 migrations can race and an older SHA can finish last and overwrite a newer Worker. Required fix: add `concurrency: { group: production-deploy, cancel-in-progress: false }` at workflow or job level. Before touching secrets, skip if `workflow_run.head_sha` is no longer the tip of `origin/main` (or accept a stale skip).
- [B3] .github/workflows/ci.yml:14-18 — The matrix hard-codes `['@uma/schema', '@uma/master-data', api, web]`. 65 §4 requires lint, typecheck and test for all TS packages. The imminent `@uma/engine` (and any later workspace package) would then pass CI without running at all: a false-green gate. Required fix: run `pnpm -r lint`, `pnpm -r typecheck` and `pnpm -r test` (or discover packages dynamically with `pnpm ls -r --json`). Filter only the web build and the bundle check.
- [B4] .github/workflows/backup.yml:30-35 and docs/runbooks/backup.md:14 — The full D1 dump (guest trainer names, plus the whole roster and review data) is uploaded as a plain artifact in a public repo. Artifacts in public repos can be downloaded by any signed-in GitHub user. The runbook's "downloadable by signed-in users with repository read access" is false for this repo. Required fix: encrypt before upload (for example `age` or `gpg --symmetric` with a GitHub secret, and document decryption), or make the repo private as an explicit H2 prerequisite that the workflow checks (fail if `github.event.repository.private` is false). Correct the runbook text. (The visibility decision itself is a user/account prerequisite.)
- [B5] docs/runbooks/cloudflare-setup.md:53,105 — The verify commands use `/master/global-20260930/latest.json`, which doesn't exist. The index is `/master/latest.json` (apps/web/public/master/latest.json; `global-20260930/` holds only the data files). Line 105 would also fail even with the right path: the whole hostname is behind Access, so an unauthenticated `curl -fsS` gets a 302 with an empty body and `jq -e` fails. The line 104 health curl "succeeds" only because `-f` doesn't treat the 302 as an error, so it proves nothing. Required fix: use `/master/latest.json`, and send the service-token headers (from a secret manager) or tell the operator to verify in a browser.
- [B6] docs/runbooks/cloudflare-setup.md:55-68,86-97,114-119 — First-deploy order is broken. Step 4 verifies the service token against `/api/v1/health` before any Worker exists (deploy only happens in §6), so that verify can't pass. `ACCESS_AUD` is set only in §7 ("Rotate and revoke"), after the first production deploy, so the first deployed Worker is misconfigured and every authenticated route fails closed (auth.ts:56). There's also a catch: `wrangler secret put` against a Worker that doesn't exist yet prompts interactively to create it. Required fix: reorder to Access app, AUD, then first deploy followed immediately by `secret put ACCESS_AUD --env production` (or `deploy --secrets-file` from an ignored file), then the service-token verify. Also move the "pnpm install" line in §6 to the repo root.
- [B7] docs/runbooks/backup.md:19,33,39-40 — The verify commands treat the SQL text dump as a SQLite database. `sqlite3 backup.sql '.tables'` and `sqlite3 backup-*.sql 'PRAGMA integrity_check;'` fail with "file is not a database". The `backup-*.sql` globs also break once there is more than one backup. 65 §5/§7 requires each step to have a working verify command. Required fix: load into a temporary database first (`sqlite3 "$tmp.db" < backup.sql && sqlite3 "$tmp.db" 'PRAGMA integrity_check; .tables'`), store the timestamped filename in a variable, and use it throughout.

## Should fix
- [S1] .github/workflows/ci.yml:53-55 and agent-release.yml:15-17 — Only `9.0.x` is installed, while the agent projects target `net8.0` (AGENTS.md). `dotnet test` on a net8.0 test project needs the Microsoft.NETCore.App 8.x runtime, which SDK 9 doesn't ship. It would only work if the hosted image happens to carry .NET 8 (unverified here; this machine has only 9 and 10 runtimes). Suggestion: set `dotnet-version: |` with `8.0.x` and `9.0.x` (global.json asks for 9.0.100 with latestMajor), and add `dotnet --list-runtimes | grep 'NETCore.App 8\.'` as an explicit gate. The self-contained release publish doesn't need the 8.x runtime, but pin it there too for reproducibility.
- [S2] .github/workflows/ci.yml:59-66 — The spec names `dotnet test agent/tests/Uma.Agent.Core.Tests`. Instead, `find agent/tests -name '*.csproj' -print -quit` picks an arbitrary first test project, and the step exits 0 whenever no csproj exists anywhere under `agent`. Suggestion: target the spec path explicitly, and keep the "not present yet" skip keyed on that exact path.
- [S3] .github/workflows/deploy.yml:14 and apps/api/wrangler.jsonc:44,47 — Once merged, every main push triggers a deploy that fails until H2 is done (placeholder `database_id`, empty `ACCESS_TEAM_DOMAIN`, no secrets). A Worker with an empty team domain could also go live and fail closed. Suggestion: add a preflight step that fails (or skips) clearly when the secrets are empty, when `database_id` is all zeros or when `ACCESS_TEAM_DOMAIN` is empty, before running migrations.
- [S4] docs/runbooks/cloudflare-setup.md:81-84 — The "verify without printing the token" example puts the token literally on the command line, where it ends up in shell history. That contradicts line 59. Also, `wrangler whoami` doesn't prove D1, R2 or Workers edit permission. Suggestion: read the token from a secret manager or a `read -s` prompt, and verify with `wrangler d1 list`, `wrangler r2 bucket list` and `wrangler deploy --dry-run`. List the exact token permission names (Account › Workers Scripts:Edit, D1:Edit, Workers R2 Storage:Edit, Account Settings:Read).
- [S5] docs/changelog/T12-devops.md:5 — The model line says `gpt-5.6-luna-900k, effort standard/full implementation pass`. The launcher requested `claude-opus-5-5` / anthropic at medium effort. Session metadata records that, but the profile may have fallen back to gpt-5.6-luna-900k. Suggestion: record "requested claude-opus-5-5 (anthropic), effort medium; actual model uncertain (profile fallback to gpt-5.6-luna-900k possible)".
- [S6] docs/changelog/T12-devops.md:80-81 — The output shown under `$ find agent -name '*.csproj' -type f -print` is the workflow's echo message, not what `find` prints (nothing). The verification output misrepresents what the command produced. Suggestion: show the actual (empty) output and label the message separately.
- [S7] .github/workflows/agent-release.yml:34 — `${{ github.ref_name }}` is interpolated into a pwsh double-quoted string, where `$(...)` would execute. Only people who can push tags can trigger it, but pass it via `env:` instead. Also, PowerShell doesn't expand `publish/*.exe` for native commands. Resolve the file explicitly with `(Get-ChildItem publish -Filter *.exe).FullName` rather than relying on gh's own globbing.
- [S8] apps/api/wrangler.jsonc:51 — `MASTER_VERSION: "global-20260930"` is hard-coded and must be edited by hand whenever master data changes. The runbook mentions this (cloudflare-setup.md:33), but nothing enforces it. Suggestion: add a CI assertion that it equals `apps/web/public/master/latest.json` `.version`.

## Nits
- [N1] ci.yml:21-23, deploy.yml, backup.yml — `pnpm/action-setup` `version: 11.22.0` duplicates `packageManager: pnpm@11.22.0`. Drop one to avoid future mismatch errors.
- [N2] ci.yml:36 — The bundle limit is 256000 bytes, but 60-web says ≤ 250 kB. Use 250000 to match the spec exactly.
- [N3] backup.yml / agent-release.yml — Add a `concurrency` group and `timeout-minutes` to jobs.
- [N4] apps/api/wrangler.jsonc:26-28 — The top-level comment was edited, which is minor churn outside the "production env section". Acceptable.

## Checklist
1 Spec conformance: issues. B3 (all TS packages), B5/B6/B7 (runbook verify steps wrong or unrunnable; 65 §5/§7), S2. Resource and secret names match 65 §2/§3. The production dry-run succeeds. Status Partial on H2 is correctly declared, and no run URL is expected yet.
2 Correctness: issues. B2 (deploy race/staleness), B5, B6, B7, S1, S3.
3 Test quality: The changelog's lint, typecheck, test, build, bundle and dry-run numbers match my runs (146/82/86/5 tests, 106265 gzip bytes, same bindings). S6 misrepresents one command's output.
4 Fabrication check: minor issues. S5 (model line inaccurate), S6. Every action SHA matches its claimed tag (verified via `git ls-remote`). Node 24.14.0 exists. No invented game constants.
5 Security: issues. B1 (fork/PR code can reach deploy secrets and production), B4 (PII backup artifact public on a public repo), S4, S7. No secrets committed, and `AUTH_DISABLED` is absent from env.production. Prerequisites that are not implementation defects: H2 must create the Cloudflare account, resources, token and `ACCESS_AUD`, set GitHub environment protection for `production`, and decide repo visibility and artifact retention.
6 Free-tier constraints: ok. Only Workers, D1, R2 and Access Free are used; D1 Time Travel is correctly described as 7 days on Free; the runbook notes that CPU time must be checked in Metrics.
7 Scope: ok. The diff touches only `.github/**`, `apps/api/wrangler.jsonc`, the two runbooks and the changelog. There are no cross-task edits.
8 Maintainability: issues. B3 (hard-coded package list), S8 (hard-coded MASTER_VERSION), N1. Actions are pinned to SHAs.

## Commands run
$ git diff --stat main...HEAD
 .github/workflows/agent-release.yml |  34 +++
 .github/workflows/backup.yml        |  35 +++
 .github/workflows/ci.yml            |  77 +++++
 .github/workflows/deploy.yml        |  42 +++
 apps/api/wrangler.jsonc             |  31 +++-
 docs/changelog/T12-devops.md        | 110 ++++++
 docs/runbooks/backup.md             |  96 ++++++
 docs/runbooks/cloudflare-setup.md   | 136 ++++++++
 8 files changed, 559 insertions(+), 2 deletions(-)

$ pnpm install --frozen-lockfile
Scope: all 5 workspace projects
Already up to date
Done in 365ms using pnpm v11.22.0

$ pnpm -r lint
packages/schema lint: Done
apps/web lint: Done
packages/master-data lint: Done
apps/api lint: Done

$ pnpm -r typecheck
packages/master-data typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done

$ pnpm -r test | grep -E "Test Files|Tests "
packages/schema test:  Test Files  4 passed (4) / Tests 146 passed (146)
packages/master-data test:  Test Files  3 passed (3) / Tests 82 passed (82)
apps/web test:  Test Files  1 passed (1) / Tests 5 passed (5)
apps/api test:  Test Files  8 passed (8) / Tests 86 passed (86)

$ pnpm --filter web build
dist/assets/engine.worker-Crm6So1O.js    4.12 kB
dist/assets/index--uMx3vdd.js          342.97 kB │ gzip: 107.66 kB
✓ built in 101ms
$ gzip -9 -c apps/web/dist/assets/index--uMx3vdd.js | wc -c
  106265

$ cd apps/api && pnpm exec wrangler deploy --env production --dry-run --outdir .wrangler/review-dry-run
⛅️ wrangler 4.143.0
✨ Read 19 files from the assets directory .../apps/web/dist
Total Upload: 894.76 KiB / gzip: 150.75 KiB
env.DB (uma-spark-calc)                  D1 Database
env.CROPS (uma-spark-calc-crops)         R2 Bucket
env.ASSETS                               Assets
env.ACCESS_TEAM_DOMAIN ("")              Environment Variable
env.MASTER_VERSION ("global-20260930")   Environment Variable
--dry-run: exiting now.
exit=0
(output in ignored apps/api/.wrangler/)

$ pnpm exec wrangler deploy --help | grep strict ; wrangler d1 export/migrations apply/time-travel --help
--strict  Enables strict mode, which prevents uploads when there are conflicting remote changes.
--output  Path to the SQL file for your export [required]; --remote
-e, --env ; --remote (migrations apply)
--timestamp / --bookmark (time-travel info/restore)
(all flags used in workflows/runbooks exist in wrangler 4.143.0)

$ git ls-remote --tags https://github.com/<action>.git | grep <sha>
actions/checkout      3d3c42e5… refs/tags/v7.0.1
actions/setup-dotnet  a98b5685… refs/tags/v6.0.0
actions/upload-artifact 043fb46d… refs/tags/v7.0.1
pnpm/action-setup     ea17c68d… refs/tags/v6.1.0^{}
actions/setup-node    82076278… refs/tags/v7.0.0

$ curl -fsS https://api.github.com/repos/wilyanse/uma-musume-spark-calc | grep -E '"(private|visibility)"'
"private": false,
"visibility": "public",

$ curl -fsS https://nodejs.org/dist/index.json | grep -o '"version":"v24.14.0"'
"version":"v24.14.0"

$ cat agent/global.json ; dotnet --list-runtimes
{ "sdk": { "version": "9.0.100", "rollForward": "latestMajor" } }
Microsoft.NETCore.App 9.0.14
Microsoft.NETCore.App 10.0.3

$ ls apps/web/public/master ; ls apps/web/public/master/global-20260930
global-20260930  latest.json
affinity.json cards.json characters.json outfits.json ranks.json rules.json scenarios.json skills.json sparks.json vocab-cards.json vocab.json

$ pnpm exec prettier --check .github/workflows apps/api/wrangler.jsonc docs/runbooks
All matched files use Prettier code style!

$ git diff --check main...HEAD ; git status --short
check=0
(clean; only ignored apps/api/.wrangler/ and node_modules/)

$ gh repo view … 
To get started with GitHub CLI, please run: gh auth login
(no Actions run data available; no remote CI result claimed)
