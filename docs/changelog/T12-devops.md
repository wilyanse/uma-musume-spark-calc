# T12 — DevOps

- **Status:** Partial. Implementation and local verification pass; the real deploy, backup run and CI run URL are blocked only on H2 (human account and resource provisioning).
- **Branch:** task/T12-devops
- **Agent / model:**
  - Round 0 (commit 39bce46): the launcher requested `claude-opus-5-5` (anthropic) at effort medium. Profile fallback was enabled, and the round-0 changelog self-reported `gpt-5.6-luna-900k`. Which model actually produced round 0 is **uncertain**. It is not confirmed here.
  - Review round 1 partial work before this retry: requested `claude-opus-5-5` (anthropic), effort medium, profile fallback disabled. The prior worker recorded runtime metadata reporting Opus, but that run exhausted HTTP 429 retries before committing; its tracked and untracked changes were preserved. This is attribution to the prior partial work only, not the current retry.
  - Current review round 1 retry: explicitly requested `gpt-6-sol` / `openai-codex`, reasoning medium, profile fallback disabled. This session reports model `gpt-6-sol` and provider `openai-codex`. The retry continued the existing partial work rather than starting over.
- **Date:** 2026-10-01 (retry; prior partial work dated 2026-09-30)

## Summary

- **Workflows.** Pinned GitHub Actions workflows cover CI, production deploy, the weekly backup and the agent release:
  - **CI** runs recursive lint, typecheck and test over every pnpm workspace package, including the upcoming `@uma/engine`. It builds only the web app, from committed master data, and checks the bundle budget and `MASTER_VERSION` alignment. It also runs the .NET agent gates on the exact spec paths.
  - **Deploy** accepts only a successful push-triggered CI run from this repository's `main`. It is serialised, skips a stale candidate SHA, and fails closed until H2 enables it.
  - **Backup** is encrypted with age before upload. Only the public recipient is stored on GitHub.
  - **Agent release** passes the tag through `env` and resolves the exe explicitly.
- **Runbooks.** They give the corrected first-deploy order (Access app, then AUD, then deploy with `--secrets-file`, then verification through Access), a status-and-body production verifier, key management, decryption and restore, and a SQL-export validation that works.
- **Regression tests.** `.github/tests/run.sh` (61 checks) covers trusted vs fork/PR gating, stale-SHA skip, all-package coverage, backup encryption and plaintext cleanup, restore validation, the .NET gates and the production verifier. It runs locally and as a CI job.

## Files

Created in round 0:

- `.github/workflows/ci.yml`, `deploy.yml`, `backup.yml`, `agent-release.yml`
- `docs/runbooks/cloudflare-setup.md`, `docs/runbooks/backup.md`

Created in review round 1:

- `.github/scripts/deploy-gate.sh` — trust gate (event, conclusion, branch, repository) and main-tip freshness check. Stale or not-enabled runs skip explicitly.
- `.github/scripts/check-config.mjs` — checks the Wrangler production structure and `MASTER_VERSION == latest.json.version`. `--require-provisioned` also rejects the placeholder D1 ID and an empty team domain.
- `.github/scripts/check-workspace-coverage.mjs` — every workspace package must define lint, typecheck and test.
- `.github/scripts/install-tool.sh` — installs pinned, SHA-256-verified age v1.3.2 and actionlint v1.7.12.
- `.github/scripts/backup-d1.sh` — recipient fail-closed check, export into a private temp dir, sanity check, age encryption, ciphertext check, cleanup on every exit.
- `.github/scripts/verify-sql-backup.sh` — imports the export into a temp SQLite DB, then runs `integrity_check` and the table listing as separate commands.
- `.github/scripts/agent-gates.sh` — .NET 8 runtime gate, `Uma.Agent.Core.Tests` test, `Uma.Agent.Windows` build.
- `.github/scripts/verify-production.sh` — H2-only verification through Access: exact status and body checks, no redirects followed.
- `.github/tests/run.sh`, `.github/tests/workflow_structure.rb`, `.github/tests/mock_access.py` — local regression checks.

Modified in review round 1:

- All four workflows.
- Both runbooks.
- `apps/api/wrangler.jsonc`, **production env section only**: `workers_dev: true`, `preview_urls: false`, and a comment on `MASTER_VERSION`.
- This changelog.

## Decisions

- **Deploy trust (B1).** The trust check sits in three places:
  - both job `if`s;
  - `deploy-gate.sh trust`, which runs from a sparse checkout of the default branch and never touches candidate code or secrets;
  - the `production` environment's main-only branch rule, which H2 configures.

  The candidate SHA is checked out only in the deploy job, after the gate has passed. Cloudflare secrets are scoped to the two wrangler steps: install and build never see them. The privileged job uses no dependency cache.
- **Deploy is opt-in (S3).** Repository variable `PRODUCTION_DEPLOY_ENABLED=true` must be set by H2 after provisioning. Without it, a main push ends green with a `SKIPPED` notice instead of a red failure. Once it is enabled, the preflight fails hard if a secret is missing or a config value is still a placeholder.
- **Serialisation (B2).** `concurrency: production-deploy` with `cancel-in-progress: false` means a running migration is never cancelled. GitHub keeps at most one pending run per group and replaces older pending runs with newer ones. On top of that, the explicit re-check against the main tip, made just before migrations, skips any run that got through while stale.
- **CI concurrency.** PR runs cancel superseded runs. Main pushes get a unique group per run, so deploy.yml never loses a main CI run.
- **Backup encryption (B4).** I chose age X25519 recipients over `gpg --symmetric`:
  - GitHub holds no decryption capability at all; a leaked GitHub secret cannot decrypt anything.
  - It is a single static binary, pinned by release digest.

  The private key lives only in user-managed storage (password manager plus an offline copy). A separate `backup` environment and a D1-only token keep the backup credentials narrower than the deploy credentials.
- **First-deploy order (B6).** Access app, then AUD, then `wrangler deploy --secrets-file`, then verification. Per the Cloudflare Secrets doc ("Upload secrets alongside code"), this creates the Worker together with `ACCESS_AUD` in one deploy, so no misconfigured Worker ever goes live. It also avoids `wrangler secret put` prompting to create a Worker that does not exist yet. I checked locally that `--secrets-file` works with `--dry-run` (a synthetic value showed as `env.ACCESS_AUD ("(hidden)")`).
- **`preview_urls: false` in production.** Cloudflare's Access doc says host-name Access protects "only that exact URL". Version and preview URLs would otherwise sit outside the `Uma Spark Calc` host-name application.
- **Production verification (B5).** The verifier uses `curl --max-redirs 0` with an exact `%{http_code}` and `jq` assertions on the body. It checks `/api/v1/roster` to prove the Worker accepted the Access JWT, which catches an AUD or team mismatch. Headers go to curl on stdin (`--config -`), not in argv.
- **.NET (S1/S2).** `setup-dotnet` installs 8.0.x and 9.0.x. `dotnet` runs from `agent/`, so `agent/global.json` selects the SDK. The gates skip only while the exact spec project is wholly absent, and report that as `NOT RUN … This is not a pass` (a warning plus a step summary). If a partial directory exists, CI fails.
- **Tool pinning.** age v1.3.2 and actionlint v1.7.12 are installed by `install-tool.sh`. The SHA-256 digests come from the GitHub release asset metadata and match my local `shasum -a 256` of the downloaded archives (recorded below).
- **Workflow validation.** actionlint (which also runs shellcheck on `run:` blocks when shellcheck is on PATH; ubuntu-latest ships it) plus the Ruby structural assertions on the parsed YAML.
- **Free-tier CPU is UNVERIFIED** until H2 records Worker CPU metrics (cloudflare-setup.md §9, Q-4). The R2 subscription checkout (payment method) is documented as an H2 prerequisite, quoting the official R2 "Get started" page.

## Deviations from spec

- **65 §7:** status is Partial. No Cloudflare or GitHub resources were provisioned, and no workflow was run on GitHub, so there is no run URL. Local equivalents and the regression suite stand in (see Verification).
- **65 §3:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are GitHub Actions **environment** secrets (`production`, plus a D1-only token on `backup`), not repository-wide secrets. The names are unchanged; the scoping is narrower (B1).
- **65 §5:** the weekly artifact is `d1-backup-<UTC>.sql.age`, the age-encrypted `wrangler d1 export … --output` file, not a plaintext `backup.sql` (B4). The export command is unchanged apart from `--env production`.
- **New H2 configuration items:**
  - repository variables `PRODUCTION_DEPLOY_ENABLED` and `BACKUP_AGE_RECIPIENT`;
  - GitHub environments `production` and `backup`.

  These are configuration only: no new service and no paid tier.

## Cross-task edits

- None. `apps/api/wrangler.jsonc` changes are confined to `env.production`, which T12 owns. `OPEN_QUESTIONS.md` was not edited (Q-100..Q-109 remain reserved).

## Verification (round 0, historical)

```
$ for p in @uma/schema @uma/master-data api web; do pnpm --filter "$p" lint; pnpm --filter "$p" typecheck; pnpm --filter "$p" test; done
@uma/schema: Test Files 4 passed (4); Tests 146 passed (146)
@uma/master-data: Test Files 3 passed (3); Tests 82 passed (82)
api: Test Files 8 passed (8); Tests 86 passed (86)
web: Test Files 1 passed (1); Tests 5 passed (5)

$ find agent -name '*.csproj' -type f -print
(no output — no agent projects exist)
```

Correction (S6): the round-0 changelog showed `Agent projects are not present yet (T09/T10 queued); no claim of a pass.` under this `find` command. That text is the workflow's echo message, not `find` output. `find` printed nothing.

## Review round 1

The review is at `docs/reviews/T12-review-1.md`. Every finding is answered below; the command output follows in "Round 1 verification".

### Blocking

- **B1 — Fixed.** The trust check is now in all three places listed under Decisions:
  - Both `deploy.yml` job `if`s require `conclusion == 'success' && event == 'push' && head_branch == 'main' && head_repository.full_name == github.repository`.
  - The `gate` job re-checks the same conditions, plus `GITHUB_EVENT_NAME == workflow_run` and a well-formed 40-hex SHA, in `deploy-gate.sh trust`. It runs from the trusted default-branch checkout (`sparse-checkout: .github/scripts`, no `ref:`) with no secrets and no environment.
  - Only after that does the `deploy` job (`needs: gate`, `environment: production`) check out `head_sha`.

  Cloudflare secrets are set only on the migrate and deploy steps, and there is no cache in the privileged job. cloudflare-setup.md §8 documents the `production` environment: main-only deployment branch rule, optional required reviewers and Prevent self-review, environment-scoped secrets, and GitHub Free plan availability. Regression checks cover a fork PR whose branch is named `main`, a fork push, same-repo `pull_request`, `pull_request_target`, a non-main branch, failed CI, a non-`workflow_run` invocation and a malformed SHA. All are refused.
- **B2 — Fixed.** Workflow-level `concurrency: {group: production-deploy, cancel-in-progress: false}`. Inside the group, `deploy-gate.sh fresh` runs right before migrations. It compares `head_sha` with `GET /repos/{repo}/git/ref/heads/main`. On a mismatch it emits `::notice::… SKIPPED: candidate <sha> is stale; main is now <tip>`, sets `proceed=false` and leaves migrations and deploy skipped. If the main-tip lookup fails, the job fails closed (no deploy). The same check also runs early in the gate job. The token goes to curl on stdin.
- **B3 — Fixed.** CI runs `pnpm -r lint`, `pnpm -r typecheck` and `pnpm -r test` with no package matrix. The only filtered command is `pnpm --filter web build`. There is no `pnpm -r build` anywhere; a structural assertion enforces this. Because `pnpm -r <script>` silently skips a package that lacks the script, `check-workspace-coverage.mjs` fails CI in that case. It was run against the real `task/T05-inheritance` manifests and covers `@uma/engine` (5 packages). A synthetic test proves `pnpm -r test` executes a new `@uma/engine` and that a package with no `test` script fails CI.
- **B4 — Fixed.** Repository visibility is unchanged. `backup.yml` now:
  - installs the pinned, digest-verified age v1.3.2;
  - runs `backup-d1.sh`, which stops **before export** when `vars.BACKUP_AGE_RECIPIENT` is missing, is not `age1…`, has a bad checksum (age itself rejects it) or is a pasted `AGE-SECRET-KEY`;
  - exports into a `umask 077` `mktemp -d` directory, removed by an `EXIT` trap on success and failure;
  - encrypts, then verifies the `age-encryption.org/v1` header and the absence of plaintext;
  - uploads exactly one path, `steps.backup.outputs.file` (the `.sql.age`).

  backup.md documents H2 key generation, off-GitHub storage (password manager plus offline copy), download, decryption (including stdin identity from a password manager), validation, restore, rotation (keep the old key 90 days) and recovery limits (a lost key means unrecoverable backups; R2 is not included; weekly granularity). The review's statement that artifacts are downloadable only with "repository read access" was false for this public repository; that runbook text is removed. Tests use only ephemeral keys, created in a temp dir, never printed and deleted on exit. No keys are committed: the `grep` for `AGE-SECRET-KEY-1[0-9A-Z]{50,}` over the tree found none.
- **B5 — Fixed.** Every path is now `/master/latest.json`. The unauthenticated `curl -fsS … | jq` lines are removed. `verify-production.sh` (H2-only) never follows redirects and asserts:
  - anonymous requests to `/`, `/master/latest.json` and `/api/v1/health` return 302, 401 or 403;
  - `/api/v1/health` returns 200 with `ok == true` and the expected `masterVersion`;
  - `/master/latest.json` returns 200 with the expected `.version`;
  - `/api/v1/roster` returns 200 JSON.

  The token comes from a `read -rs` prompt or a secret manager and reaches curl on stdin. A local mock tests it: a 302 is reported as `FAIL`, as are an open host name, an AUD mismatch (401) and a wrong version. The runbook also tells the operator to confirm in a browser.
- **B6 — Fixed.** New order:
  - §2: resources and wrangler IDs, merged via PR.
  - §3: workers.dev host and Access app, then copy the AUD. This happens **before any deploy**.
  - §4: service token.
  - §5: first deploy from the repository root with `pnpm install` at the root. It runs a dry-run and the migrations, then `wrangler deploy --env production --strict --secrets-file <0600 temp file>`. The AUD is written to that file through `read -rs` and `printf`, a builtin, so it never appears in argv. The file is deleted afterwards. `wrangler secret list | jq` confirms the secret without printing its value.
  - §6: verification through Access.

  `wrangler secret put` is kept only for later AUD rotation, when the Worker exists. The fail-closed auth is unchanged, and `check-config.mjs --require-provisioned` blocks placeholder config.
- **B7 — Fixed.** `verify-sql-backup.sh <one file>` runs `sqlite3 -bail "$db" < "$backup_sql"`, then `PRAGMA integrity_check;` (must be exactly `ok`), then a separate `sqlite_schema` table query (must include `veterans`, `review_items` and `owned_cards`) and a row count. The runbook asks for the exact timestamp from the downloaded artifact and uses one explicit `backup_sql` path throughout, without a multi-file glob. This was exercised locally on a synthetic export built from the real migrations. I also confirmed the old command fails with `file is not a database (26)`. No remote verification is claimed.

### Should fix

- **S1 — Fixed.** `setup-dotnet` installs both `8.0.x` and `9.0.x` in CI and in agent-release. `agent-gates.sh runtime` prints `dotnet --version` from `agent/` (global.json) and fails without `Microsoft.NETCore.App 8.`. Locally it correctly **fails**, because this Mac has only the 9 and 10 runtimes (see output).
- **S2 — Fixed.** The gates use the exact paths `agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj` and `agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj`. They skip only while the path is wholly absent, reporting `NOT RUN … This is not a pass`. A directory without its csproj, or an `Uma.Agent.Core` source directory without the test project, fails CI. Nothing else under `agent/` is picked up in their place.
- **S3 — Fixed.** Two parts:
  - The `PRODUCTION_DEPLOY_ENABLED` opt-in gives a clean skip until H2 enables deploy.
  - A preflight that runs before install, build and migrations fails when an environment secret is empty, `database_id` is the zero placeholder or not a UUID, `ACCESS_TEAM_DOMAIN` is not `<team>.cloudflareaccess.com`, `AUTH_DISABLED` or an `ACCESS_AUD` var is present, `preview_urls` is not false, or `MASTER_VERSION` is misaligned.
- **S4 — Fixed.** No secret literals remain in any runbook command: tokens use the `read -rs` / export / `unset` pattern or `op run`. The exact permission names are listed: Account › Workers Scripts › Edit, D1 › Edit, Workers R2 Storage › Edit, Account Settings › Read. The permission check runs `d1 info`, `r2 bucket list`, `deployments list` and `d1 migrations list`. The runbook states honestly that these prove read access and that Edit is proven by the first CI deploy.
- **S5 — Fixed.** The model line now records what was requested and marks the round-0 actual model as uncertain (see header).
- **S6 — Fixed.** See the correction under the round-0 verification.
- **S7 — Fixed.** The tag reaches pwsh only as `$env:TAG`. There is no `${{ }}` inside any `run:`, which is asserted. The tag format is validated with `-cnotmatch`. The csproj path is fixed. The exe is resolved with `@(Get-ChildItem -LiteralPath publish -Filter *.exe -File)`, which must match exactly one file, passed through `GITHUB_OUTPUT` and handed to `gh release create $env:TAG $env:EXE --verify-tag`. `$LASTEXITCODE` is checked.
- **S8 — Fixed.** CI runs `check-config.mjs .`, which fails when `env.production.vars.MASTER_VERSION != apps/web/public/master/latest.json .version` or that version's directory is missing. A regression test covers the drift case.

### Nits

- **N1 — Fixed.** `pnpm/action-setup` has no `version:` anywhere. `packageManager: pnpm@11.22.0` is the single source, and this is asserted.
- **N2 — Fixed.** The bundle limit is `250000`, and the check selects exactly one `index-*.js`.
- **N3 — Fixed.** Every job has `timeout-minutes`. backup has `concurrency: d1-backup` and agent-release has `agent-release-<ref>`, both with `cancel-in-progress: false`.
- **N4 — Acknowledged.** The top-level comment is untouched this round.

### Round 1 verification

All commands were run in this worktree on 2026-09-30. Nothing was deployed, no Cloudflare or GitHub resource was accessed, and no credential was read.

The workflow validators and regression suite were run with digest-verified tool downloads. shellcheck v0.11.0 was put on PATH so that actionlint lints the `run:` blocks too.

```
$ bash .github/scripts/install-tool.sh age "$D"; bash .github/scripts/install-tool.sh actionlint "$D"
v1.3.2
1.7.12
exit=0

$ shasum -a 256 actionlint_1.7.12_darwin_arm64.tar.gz age-v1.3.2-darwin-arm64.tar.gz age-v1.3.2-linux-amd64.tar.gz
aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f  actionlint_1.7.12_darwin_arm64.tar.gz
e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5  age-v1.3.2-darwin-arm64.tar.gz
cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10  age-v1.3.2-linux-amd64.tar.gz
(match the GitHub release "digest" fields and the constants in install-tool.sh)

$ actionlint -color=false -verbose .github/workflows/*.yml
verbose: Found total 0 errors in 1 ms for .github/workflows/agent-release.yml
verbose: Found total 0 errors in 30 ms for .github/workflows/backup.yml
verbose: Found total 0 errors in 73 ms for .github/workflows/ci.yml
verbose: Found total 0 errors in 76 ms for .github/workflows/deploy.yml
verbose: Found 0 errors in 4 files

$ shellcheck .github/scripts/*.sh .github/tests/run.sh
(no output) shellcheck=0

$ TOOLS_DIR="$D" bash .github/tests/run.sh
== actionlint (workflow syntax, expressions, embedded shell via shellcheck if present)
  ok   actionlint .github/workflows/*.yml (exit 0)
== workflow structure (parsed YAML)
  ok   deploy/ci/backup/release structural assertions (exit 0)
== deploy gate: trusted vs fork/PR events, stale SHA
  ok   trusted push to main at the tip -> deploy (exit 0, proceed=true)
  ok   fork PR whose head branch is named main -> refused (exit 1, proceed=none)
  ok   fork push event from another repository -> refused (exit 1, proceed=none)
  ok   same-repo pull_request run on main -> refused (exit 1, proceed=none)
  ok   pull_request_target run -> refused (exit 1, proceed=none)
  ok   push to a non-main branch -> refused (exit 1, proceed=none)
  ok   failed CI conclusion -> refused (exit 1, proceed=none)
  ok   gate invoked by a non-workflow_run event -> refused (exit 1, proceed=none)
  ok   malformed head_sha -> refused (exit 1, proceed=none)
  ok   deploy not enabled by H2 yet -> clear skip (exit 0, proceed=false)
  ok   stale SHA (main moved on) -> clear skip (exit 0, proceed=false)
  ok   stale SHA at freshness re-check -> clear skip (exit 0, proceed=false)
  ok   fresh SHA at freshness re-check -> deploy (exit 0, proceed=true)
  ok   main tip lookup fails -> refuse (fail closed) (exit 1, proceed=none)
  ok   GITHUB_TOKEN passed via curl stdin config, not argv
  ok   stale skip prints an explicit SKIPPED notice
== workspace coverage (all packages, incl. a future @uma/engine)
  ok   real workspace: every package has lint/typecheck/test (exit 0)
  ok   synthetic workspace with new @uma/engine: coverage ok (exit 0)
  ok   pnpm -r test (the CI command) runs the new @uma/engine package
  ok   package without a test script -> CI fails (no silent skip) (exit 1)
== wrangler config / MASTER_VERSION alignment
  ok   committed config: structure + MASTER_VERSION aligned (exit 0)
  ok   committed placeholders are rejected by the deploy preflight (exit 1)
  ok   provisioned (synthetic) ids pass the deploy preflight (exit 0)
  ok   MASTER_VERSION drift from latest.json -> CI fails (exit 1)
  ok   AUTH_DISABLED in a Wrangler env -> CI fails (exit 1)
== backup: fail-closed recipient, encrypt before upload, plaintext cleanup, decrypt + verify
  ok   missing BACKUP_AGE_RECIPIENT -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   non-age recipient -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   age1 recipient with bad checksum -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   private key pasted as recipient -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   wrangler export failure -> fail, plaintext removed, no ciphertext (exit 1, export called=1, temp leftovers=0)
  ok   failed export left nothing in the upload dir
  ok   valid recipient -> encrypted, plaintext removed (exit 0, export called=1, temp leftovers=0)
  ok   exactly one upload candidate: d1-backup-20260930T111602Z.sql.age
  ok   artifact is age ciphertext with no plaintext SQL
  ok   no secret key material in log or artifact
  ok   decrypt with the (ephemeral) private identity round-trips byte-for-byte
  ok   a different identity cannot decrypt
== restore verification (B7): import into temp SQLite, then integrity_check, then tables
  ok   verify-sql-backup.sh on the decrypted synthetic export (exit 0)
  ok   old runbook command (sqlite3 dump.sql PRAGMA) indeed fails: 'file is not a database'
  ok   truncated export -> verify fails (exit 1)
  ok   export without the app tables -> verify fails (exit 1)
== .NET gates: exact spec paths, honest NOT RUN only while absent
  ok   runtime gate without Microsoft.NETCore.App 8.x -> fail (exit 1)
  ok   runtime gate with 8.x installed -> ok (exit 0)
  ok   core tests while absent -> NOT RUN (exit 0, no pass claim) (exit 0)
  ok   absent project reported as NOT RUN
  ok   Core test dir present without its csproj -> fail (no arbitrary project) (exit 1)
  ok   Core tests present -> dotnet test on the exact spec project (exit 0)
  ok   invoked: dotnet test tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj (cwd agent/, global.json applies)
  ok   Windows build while absent -> NOT RUN (exit 0)
  ok   Windows dir present without csproj -> fail (exit 1)
  ok   Windows project present -> dotnet build with EnableWindowsTargeting (exit 0)
  ok   invoked: dotnet build src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -p:EnableWindowsTargeting=true
== production verification: exact status + body, redirects never count as success
  ok   healthy Access + Worker -> all checks pass (exit 0)
  ok   service token rejected (every request 302 to login) -> fail (exit 1)
  ok   302 login redirect reported as FAIL, not success
  ok   hostname not behind Access (anonymous 200) -> fail (exit 1)
  ok   ACCESS_AUD mismatch (Worker 401 on /api/v1/roster) -> fail (exit 1)
  ok   wrong MASTER_VERSION deployed -> fail (exit 1)
  ok   missing token env -> refuses to run (exit 1)

regression checks: 61 passed, 0 failed
```

Mutation check: the structural assertions were run against the round-0 workflows (`git show 39bce46:.github/workflows/*.yml`, temporarily swapped in and then restored). They fail, so the tests detect the reviewed defects:

```
$ ruby .github/tests/workflow_structure.rb     # with round-0 workflows
violation: deploy: concurrency production-deploy with cancel-in-progress false
violation: deploy: gate job if lacks github.event.workflow_run.event == 'push'
violation: deploy: deploy job if lacks github.event.workflow_run.head_repository.full_name == github.repository
violation: deploy: order must be freshness -> migrations -> deploy
violation: ci: must run pnpm -r test
violation: ci: no hard-coded package matrix
violation: ci: MASTER_VERSION alignment check missing
violation: ci: bundle limit must be 250000 bytes (N2)
violation: ci: setup-dotnet must install 8.0.x and 9.0.x
violation: backup: upload must be exactly the encrypted file output
violation: release: no ${{ }} interpolation inside pwsh scripts (S7)
... (48 violations total)
exit=1
$ ruby .github/tests/workflow_structure.rb     # with round-1 workflows
workflow structure: all assertions hold
```

All-package coverage, checked against the real T05 manifests (`git archive task/T05-inheritance` of the package.json files into a scratch directory; the T05 branch itself was not modified):

```
$ node .github/scripts/check-workspace-coverage.mjs <task/T05-inheritance manifests>
covered: api
covered: web
covered: @uma/engine
covered: @uma/master-data
covered: @uma/schema
workspace coverage ok: 5 packages run lint, typecheck and test
exit=0
```

The CI-equivalent commands, in workflow order:

```
$ pnpm install --frozen-lockfile
Scope: all 5 workspace projects
Already up to date
Done in 293ms using pnpm v11.22.0

$ node .github/scripts/check-workspace-coverage.mjs .
covered: api
covered: web
covered: @uma/master-data
covered: @uma/schema
workspace coverage ok: 4 packages run lint, typecheck and test

$ node .github/scripts/check-config.mjs .
config check ok (structure): MASTER_VERSION=global-20260930

$ pnpm -r lint
packages/schema lint: Done
apps/web lint: Done
packages/master-data lint: Done
apps/api lint: Done
exit=0

$ pnpm -r typecheck
packages/schema typecheck: Done
packages/master-data typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done
exit=0

$ pnpm -r test
packages/schema test:  Test Files  4 passed (4) / Tests  146 passed (146)
packages/master-data test:  Test Files  3 passed (3) / Tests  82 passed (82)
apps/web test:  Test Files  1 passed (1) / Tests  5 passed (5)
apps/api test:  Test Files  8 passed (8) / Tests  86 passed (86)
exit=0

$ pnpm --filter web build
dist/assets/engine.worker-Crm6So1O.js    4.12 kB
dist/assets/index--uMx3vdd.js          342.97 kB │ gzip: 107.66 kB
✓ built in 106ms

$ (CI bundle step: exactly one index-*.js, gzip -9)
main gzip bytes: 106265 (limit 250000)
exit=0
```

Note on `pnpm -r lint`: the first attempt failed with 199 `apps/api` errors, all in the ignored, untracked `apps/api/.wrangler/review-dry-run/index.js`. That is a bundle the round-1 reviewer's dry-run left inside the tree. I moved it out of the worktree, to `~/.hermes/cache/scratch/t12tools/moved-wrangler/`, rather than deleting it. To stop this recurring, every dry-run in the runbooks and in this changelog now uses `--outdir "$(mktemp -d)"`.

```
$ cd apps/api && pnpm exec wrangler deploy --env production --dry-run --outdir "$(mktemp -d)"
✨ Read 19 files from the assets directory .../apps/web/dist
Total Upload: 894.76 KiB / gzip: 150.75 KiB
Your Worker has access to the following bindings:
env.DB (uma-spark-calc)                            D1 Database
env.CROPS (uma-spark-calc-crops)                   R2 Bucket
env.ASSETS                                         Assets
env.ACCESS_TEAM_DOMAIN ("")                        Environment Variable
env.MASTER_VERSION ("global-20260930")             Environment Variable
--dry-run: exiting now.
exit=0

$ pnpm exec wrangler deploy --env production --dry-run --outdir "$(mktemp -d)" --secrets-file <0600 temp file, synthetic ACCESS_AUD>
env.ACCESS_TEAM_DOMAIN ("")                        Environment Variable
env.ACCESS_AUD ("(hidden)")                        Environment Variable
--dry-run: exiting now.
exit=0
(validates the B6 first-deploy flag locally; value was a synthetic placeholder, file deleted)

$ node .github/scripts/check-config.mjs . --require-provisioned     # the deploy preflight, pre-H2
::error::config check: env.production D1 database_id is still the placeholder (H2 step 3)
::error::config check: env.production ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com (H2 step 2)
exit=1
(expected until H2 fills in real ids)
```

The .NET gates as they behave on this machine:

```
$ find agent -name '*.csproj' -type f -print
(no output) exit=0

$ bash .github/scripts/agent-gates.sh runtime
10.0.103
Microsoft.NETCore.App 9.0.14 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.3 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
::error::Microsoft.NETCore.App 8.x runtime is not installed; net8.0 tests cannot run
exit=1
(correct: this Mac has no .NET 8 runtime; CI installs 8.0.x via setup-dotnet)

$ bash .github/scripts/agent-gates.sh core-tests
::warning::Agent Core tests NOT RUN: agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj is not present yet. This is not a pass.
exit=0

$ bash .github/scripts/agent-gates.sh windows-build
::warning::Windows agent build NOT RUN: agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj is not present yet. This is not a pass.
exit=0
```

backup.md §3 was exercised as written, with a synthetic export (real migrations, no real data) and an ephemeral key that was never printed and was deleted afterwards. `gh run download` was replaced by `cp`, and no GitHub or Cloudflare access took place:

```
decrypted: d1-backup-20260930T031700Z.sql 3965 bytes
integrity_check: ok
tables: capture_fields cm_targets model_snapshots owned_cards review_items roster_meta veteran_deck veteran_parents veteran_skills veteran_sparks veterans
veterans rows: 0
verify: ok
# expanded commands:
ok
capture_fields cm_targets model_snapshots owned_cards review_items roster_meta veteran_deck veteran_parents veteran_skills veteran_sparks veterans
0
# old runbook command for comparison:
Error: in prepare, file is not a database (26)
exit=26
$ grep -c AGE-SECRET <that log>
0
```

Formatting and working-tree checks:

```
$ pnpm exec prettier --check .github apps/api/wrangler.jsonc docs/runbooks
All matched files use Prettier code style!

$ git diff --check
check=0
```

Not verified, because it needs H2 or GitHub:

- a real GitHub Actions run and its URL;
- remote D1 export, artifact download and decryption;
- remote migrations and deploy;
- Access behaviour on the real host name;
- API token Edit permission;
- Worker CPU time on the Free plan (**UNVERIFIED**, Q-4).

## Open questions / follow-ups

- Q-100–Q-109 stay reserved for H2 setup follow-ups. No entries were added; `OPEN_QUESTIONS.md` is outside T12 ownership.
- **Remaining H2 prerequisites**, in order (cloudflare-setup.md unless noted):
  1. Cloudflare account with 2FA, a Zero Trust Free team and the One-time PIN login method (§1).
  2. **R2 subscription checkout with a payment method**, required by Cloudflare even for free usage (§0, §2).
  3. D1 and R2 resources; commit the real `database_id` and `ACCESS_TEAM_DOMAIN` via PR (§2).
  4. workers.dev subdomain, then the `Uma Spark Calc` Access application with Allow (email OTP) and Service Auth policies. Copy the AUD (§3).
  5. The `uma-agent` service token (§4).
  6. First deploy with `--secrets-file` carrying `ACCESS_AUD` (§5), then `verify-production.sh` (§6).
  7. The scoped deploy API token (§7).
  8. GitHub environment `production`: main-only branch rule, optional required reviewer, environment secrets. Then set the repository variable `PRODUCTION_DEPLOY_ENABLED=true` (§8).
  9. Backup (backup.md §1): generate the age key off GitHub and store it in the password manager plus an offline copy. Set the variable `BACKUP_AGE_RECIPIENT`, create environment `backup` with a D1-only token, and check that artifact retention is at least 90 days. After the first run, do the download, decrypt and verify in §3.
  10. Record Worker CPU metrics (§9). Free-tier CPU fit is **UNVERIFIED** until then (Q-4).
- After T09 and T10 land, confirm that the `.NET` gates flip from `NOT RUN` to real runs and that an `agent-v*` tag publishes exactly one exe.

### GPT-6 Sol retry verification (2026-10-01)

The prior Opus-attributed partial changes above were kept in place. This retry found and fixed a latent defect: `deploy-gate.sh` had sent the literal `Bearer ***` to the GitHub API, so a real main-tip lookup would have failed authentication even though the mocked curl returned a response. It now sends `Bearer $GITHUB_TOKEN` via curl's stdin config, never argv; a regression assertion checks the header value with a synthetic token. The H2 first-deploy AUD temp file now has an EXIT cleanup trap for interrupted/failed deploys. No cloud resource or real credential was accessed. The prior round-1 output above is historical; the following is the re-run on this retry.

```
$ bash .github/scripts/install-tool.sh age "$D" && bash .github/scripts/install-tool.sh actionlint "$D"
v1.3.2
1.7.12
exit=0

$ TOOLS_DIR="$D" bash .github/tests/run.sh
== actionlint (workflow syntax, expressions, embedded shell via shellcheck if present)
  ok   actionlint .github/workflows/*.yml (exit 0)
== workflow structure (parsed YAML)
  ok   deploy/ci/backup/release structural assertions (exit 0)
== deploy gate: trusted vs fork/PR events, stale SHA
  ok   trusted push to main at the tip -> deploy (exit 0, proceed=true)
  ok   fork PR whose head branch is named main -> refused (exit 1, proceed=none)
  ok   stale SHA at freshness re-check -> clear skip (exit 0, proceed=false)
  ok   GITHUB_TOKEN absent from curl argv
  ok   main-tip request authenticates through curl stdin config
== workspace coverage (all packages, incl. a future @uma/engine)
  ok   pnpm -r test (the CI command) runs the new @uma/engine package
  ok   package without a test script -> CI fails (no silent skip) (exit 1)
== backup: fail-closed recipient, encrypt before upload, plaintext cleanup, decrypt + verify
  ok   missing BACKUP_AGE_RECIPIENT -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   age1 recipient with bad checksum -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   wrangler export failure -> fail, plaintext removed, no ciphertext (exit 1, export called=1, temp leftovers=0)
  ok   valid recipient -> encrypted, plaintext removed (exit 0, export called=1, temp leftovers=0)
  ok   decrypt with the (ephemeral) private identity round-trips byte-for-byte
  ok   a different identity cannot decrypt
== restore verification (B7): import into temp SQLite, then integrity_check, then tables
  ok   verify-sql-backup.sh on the decrypted synthetic export (exit 0)
== production verification: exact status + body, redirects never count as success
  ok   healthy Access + Worker -> all checks pass (exit 0)
  ok   service token rejected (every request 302 to login) -> fail (exit 1)
regression checks: 62 passed, 0 failed

$ pnpm install --frozen-lockfile
Scope: all 5 workspace projects
Already up to date
Done in 294ms using pnpm v11.22.0
$ node .github/scripts/check-workspace-coverage.mjs .
covered: api
covered: web
covered: @uma/master-data
covered: @uma/schema
workspace coverage ok: 4 packages run lint, typecheck and test
$ node .github/scripts/check-config.mjs .
config check ok (structure): MASTER_VERSION=global-20260930
$ pnpm -r lint
packages/schema lint: Done
apps/web lint: Done
packages/master-data lint: Done
apps/api lint: Done
$ pnpm -r typecheck
packages/schema typecheck: Done
packages/master-data typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done
$ pnpm -r test
packages/schema: Test Files 4 passed (4); Tests 146 passed (146)
packages/master-data: Test Files 3 passed (3); Tests 82 passed (82)
apps/web: Test Files 1 passed (1); Tests 5 passed (5)
apps/api: Test Files 8 passed (8); Tests 86 passed (86)
$ pnpm --filter web build
✓ 146 modules transformed.
dist/assets/engine.worker-Crm6So1O.js    4.12 kB
dist/assets/index--uMx3vdd.js          342.97 kB │ gzip: 107.66 kB
✓ built in 126ms
$ gzip -9 -c apps/web/dist/assets/index-*.js | wc -c
  106265
$ pnpm exec prettier --check .github apps/api/wrangler.jsonc docs/runbooks
All matched files use Prettier code style!
$ shellcheck .github/scripts/*.sh .github/tests/run.sh
(no output; exit=0)
$ actionlint -color=false -verbose .github/workflows/*.yml
verbose: Found 0 errors in 4 files
$ bash .github/scripts/agent-gates.sh core-tests
::warning::Agent Core tests NOT RUN: agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj is not present yet. This is not a pass.
$ bash .github/scripts/agent-gates.sh windows-build
::warning::Windows agent build NOT RUN: agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj is not present yet. This is not a pass.
$ (cd apps/api && pnpm exec wrangler deploy --env production --dry-run --outdir "$out")
⛅️ wrangler 4.143.0
✨ Read 19 files from the assets directory .../apps/web/dist
Total Upload: 894.76 KiB / gzip: 150.75 KiB
env.DB (uma-spark-calc) D1 Database
env.CROPS (uma-spark-calc-crops) R2 Bucket
env.ASSETS Assets
env.ACCESS_TEAM_DOMAIN ("") Environment Variable
env.MASTER_VERSION ("global-20260930") Environment Variable
--dry-run: exiting now.
```

The exact CI bundle-step shell uses Bash `mapfile` on `ubuntu-latest`. A direct local attempt with macOS `/bin/bash` failed `mapfile: command not found` (exit 127); this was not counted as a passing local run. The same one-entry selection and budget were checked locally using Python (`main gzip bytes: 106247 (limit 250000)` with gzip's mtime=0) and `gzip -9 -c | wc -c` returned 106265. No remote CI run URL exists yet. H2 is the remaining blocker for deployment, artifact verification and CPU measurements; .NET projects are not yet present, so their gates are explicitly NOT RUN rather than passed.
