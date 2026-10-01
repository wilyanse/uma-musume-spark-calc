# T12 independent review — round 2

Reviewer session: 20261001_045831_151783. Reviewed commit: c30cc11.

## Verdict: PASS

## Blocking
None.

## Should fix
- [S1] .github/scripts/agent-gates.sh:29: `dotnet --list-runtimes | tee /dev/stderr | grep -Eq …` runs under `set -o pipefail`. `grep -q` exits on its first match. If `dotnet` writes anything after the matching `NETCore.App 8.x` line in a later write, `tee` gets SIGPIPE and the gate fails even though 8.x is installed. I reproduced this with a multi-write producer: 200/200 false failures. The real local `dotnet` writes in one buffer and gave 0/100. So this is latent, not observed, but on hosted runners the 8.x line is always followed by 9.x/10.x lines. Suggestion: drop `-q` (`grep -E … >/dev/null`), or capture the output into a variable first and then grep it.
- [S2] docs/runbooks/backup.md:73-83: the §3 snippet is meant to be pasted into an interactive shell. On any invalid input, `… || { …; exit 1; }` closes the operator's terminal, and `umask 077` stays changed for the rest of the session. Suggestion: wrap the block in `( … )` or `bash -c`, as cloudflare-setup.md §5 already does, or use `return`/`false` instead.

## Nits
- [N1] docs/changelog/T12-devops.md:19: says "61 checks". The retry output (line 488) and my run both show 62.
- [N2] .github/scripts/verify-sql-backup.sh:19: validation is proven only on a sqlite3 `.dump`-style synthetic export, including `d1_migrations`/`sqlite_sequence`. The real `wrangler d1 export` format (for example sqlite_sequence handling) is untested until H2 decrypts a real artifact. backup.md:144 already says so. Keep it UNVERIFIED.
- [N3] .github/tests/mock_access.py and the curl/pnpm/dotnet fakes are local mocks. The changelog calls them local regression checks, not cloud runs, which is correct. No real Access, D1 export, Actions run or Worker CPU number exists.

## Checklist
1. Spec conformance: ok.
   - CI runs `pnpm -r lint/typecheck/test`, with a coverage check so a package missing a script fails. Only `web` is filtered for the build, and the bundle limit is 250000.
   - The exact spec paths are used: `agent/tests/Uma.Agent.Core.Tests` and `agent/src/Uma.Agent.Windows` with EnableWindowsTargeting. The T09 sibling uses the same csproj path and net8.0.
   - Deploy runs migrations then deploy. Backup is weekly with 90-day retention.
   - Every runbook step has a verify command. Status is Partial on H2 only.
2. Correctness: ok, apart from S1 and S2.
   - B1: both job `if`s plus `deploy-gate.sh trust` check conclusion, event==push, head_branch==main and head_repository==repository. The gate runs from the default-branch sparse checkout; the candidate is checked out only in the deploy job.
   - B2: workflow-level `production-deploy` with cancel-in-progress false. Freshness is checked in the gate and re-checked just before migrations; a stale run skips as proceed=false.
   - B5: `/master/latest.json` is correct. The verifier uses `--max-redirs 0` and asserts exact status plus body, so a 302 fails.
   - B6: the order is Access app → AUD → migrations → `deploy --secrets-file` → verify. Wrangler 4.143 source confirms three things. `--secrets-file` exists. It sets `keepSecrets`. `addRequiredSecretsInheritBindings` throws for a first deploy without secrets unless a file is supplied.
   - B7: the dump is imported into a temp DB, then `integrity_check` and the table list run separately, with one explicit path.
   - S3: missing H2 fails closed. Without `PRODUCTION_DEPLOY_ENABLED` the run is an explicit skip. With it, the preflight rejects missing secrets, the placeholder D1 ID or an empty team domain.
   - S8: MASTER_VERSION alignment is enforced.
3. Test quality: ok.
   - I re-ran the 62 regression checks: 62 pass, including from a fresh clone.
   - The `Bearer ***` fix is real. I checked it independently against a local HTTP server that requires `Authorization: Bearer <synthetic>`: the correct token gives proceed=true, a wrong token gives a 401 and fail-closed exit 1. The token is absent from argv.
   - Recursive tests give schema 146 / master-data 82 / web 5 / api 86. The bundle is 106265 gzip bytes. The dry-run matches the changelog.
4. Fabrication check: ok.
   - Model attribution records the requested versus uncertain actual model for round 0, the preserved Opus partial work, and the Sol retry separately.
   - The S6 correction is present. No cloud result is claimed.
   - All 5 action SHAs match their tags via `git ls-remote`.
5. Security: ok.
   - Fork and PR runs cannot reach the deploy job. Secrets exist only on the `production`/`backup` environments and are exposed only to the wrangler steps. The privileged job has no cache.
   - The release tag is passed through `env` and regex-checked, and the exe is resolved explicitly.
   - Backup: the age recipient is validated (regex, bech32 checksum via age, pasted private key rejected) before export. Encryption happens before a single-file upload. The plaintext temp dir is removed on success and failure. No private key is on GitHub and none was printed.
   - `preview_urls: false` with the hostname Access app matches Cloudflare docs: Version URLs are separate hostnames.
   - No `AUTH_DISABLED` in production, enforced by CI.
6. Free-tier constraints: ok.
   - The runbook quotes Cloudflare's R2 "Get started" page, which requires an R2 subscription checkout. Zero Trust Free needs payment details but is not charged.
   - GitHub Free: environment secrets and required reviewers apply to public repos only. All three were re-checked against current docs.
   - No Workers Paid. Worker CPU is UNVERIFIED until H2.
7. Scope: ok. The diff touches only `.github/**`, the production env in `apps/api/wrangler.jsonc`, the two runbooks and the changelog.
8. Maintainability: ok.
   - Actions are SHA-pinned, and age v1.3.2 and actionlint v1.7.12 are digest-verified.
   - The pnpm version comes from `packageManager` only. Every job has concurrency and timeouts.
   - actionlint with ShellCheck 0.11.0 is clean on the workflows and scripts.

## Commands run
```
$ git rev-parse HEAD; git log --oneline 39bce46..HEAD
c30cc11797db59bf8276d448adb6d664e201d88a
c30cc11 T12: address round-one DevOps review

$ bash .github/scripts/install-tool.sh age "$D"; bash .github/scripts/install-tool.sh actionlint "$D"
v1.3.2
1.7.12
$ TOOLS_DIR="$D" bash .github/tests/run.sh
  ok   fork PR whose head branch is named main -> refused (exit 1, proceed=none)
  ok   stale SHA at freshness re-check -> clear skip (exit 0, proceed=false)
  ok   main-tip request authenticates through curl stdin config
  ok   private key pasted as recipient -> fail before export (exit 1, export called=0, temp leftovers=0)
  ok   wrangler export failure -> fail, plaintext removed, no ciphertext (exit 1, export called=1, temp leftovers=0)
  ok   decrypt with the (ephemeral) private identity round-trips byte-for-byte
  ok   302 login redirect reported as FAIL, not success
regression checks: 62 passed, 0 failed
(fresh clone of c30cc11 without node_modules: regression checks: 62 passed, 0 failed)

# Independent real-curl check of deploy-gate.sh against a local server requiring a synthetic bearer token
ghs_SYNTHE exit 0 deploy gate (trust): candidate aaaa…aaaa is the tip of main  out= proceed=true
wrong_toke exit 1 ::error::deploy gate: could not read the current main tip; refusing to deploy curl: (22) The requested URL returned error: 401
/repos/owner/uma/git/ref/heads/main auth_ok=True accept=application/vnd.github+json
/repos/owner/uma/git/ref/heads/main auth_ok=False accept=application/vnd.github+json

# Separate clone under $TMPDIR (no data refresh, no pnpm -r build)
$ pnpm install --frozen-lockfile → Done in 6.6s using pnpm v11.22.0
$ node .github/scripts/check-workspace-coverage.mjs . → workspace coverage ok: 4 packages run lint, typecheck and test
$ node .github/scripts/check-config.mjs . → config check ok (structure): MASTER_VERSION=global-20260930
$ pnpm -r lint / typecheck → all Done
$ pnpm -r test → schema 146, web 5, master-data 82, api 86 passed
$ pnpm --filter web build → dist/assets/index--uMx3vdd.js 342.97 kB │ gzip: 107.66 kB
$ gzip -9 -c index-*.js | wc -c → 106265
$ pnpm exec wrangler deploy --env production --dry-run --outdir "$(mktemp -d)"
env.DB (uma-spark-calc) D1 Database / env.CROPS (uma-spark-calc-crops) R2 Bucket / env.ASSETS
env.ACCESS_TEAM_DOMAIN ("") / env.MASTER_VERSION ("global-20260930")
--dry-run: exiting now.   exit=0

$ actionlint -shellcheck=shellcheck-v0.11.0 .github/workflows/*.yml → exit=0
$ shellcheck -S warning .github/scripts/*.sh .github/tests/run.sh → exit=0

$ wrangler deploy --help | grep -E "secrets-file|strict"
--secrets-file  Path to a file containing secrets to upload with the version (JSON or .env format)…
--strict        Enables strict mode, which prevents uploads when there are conflicting remote changes.
$ wrangler d1 export --help → --remote, --output [required], -e/--env present
(wrangler cli.js: addRequiredSecretsInheritBindings throws for new Worker without secrets file; keepSecrets: keepVars || !!props.secretsFile)

$ git ls-remote --tags <action> → checkout v7.0.1, setup-dotnet v6.0.0, upload-artifact v7.0.1, pnpm/action-setup v6.1.0 (^{}), setup-node v7.0.0: all MATCH
$ curl api.github.com/repos/wilyanse/uma-musume-spark-calc → "visibility": "public", "default_branch": "main"
$ curl developers.cloudflare.com/r2/get-started/index.md → "You need a Cloudflare account with an R2 subscription … Complete the checkout flow"
$ curl developers.cloudflare.com/cloudflare-one/setup/index.md → "If you chose the Zero Trust Free plan, this step is still needed but you will not be charged."
$ curl github/docs deployments-and-environments.md → required reviewers public-only on Free/Pro/Team; environment secrets private need Pro/Team/Enterprise
$ curl developers.cloudflare.com/workers/versions-and-deployments/version-urls → "<version-prefix>-<worker-name>.<subdomain>.workers.dev"; preview_urls:false disables them

# D1-like synthetic export (migrations + d1_migrations AUTOINCREMENT) through verify-sql-backup.sh
integrity_check: ok
tables: capture_fields cm_targets d1_migrations model_snapshots owned_cards review_items roster_meta sqlite_sequence veteran_deck …
verify: ok   exit=0

# S1 reproduction (pipefail + tee + grep -q)
multi-write producer: false failures: 200/200
single-write:         false failures: 0/200
real local dotnet:    false failures: 0/100

$ git status --short (worktree, after all runs) → (empty)
```

Reviewed commit: c30cc11797db59bf8276d448adb6d664e201d88a (task/T12-devops). These remain human-only and UNVERIFIED: H2 provisioning, actual deploy, live Access, the encrypted remote artifact restore, and Worker CPU.
