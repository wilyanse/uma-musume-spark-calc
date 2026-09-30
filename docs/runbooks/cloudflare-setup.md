# Cloudflare production setup (H2)

This runbook is for the human operator (H2). Every command here that touches Cloudflare or GitHub settings is **H2-only**: implementing agents never run it. Do not put account IDs in chat, and never commit Access AUDs, API tokens, service-token secrets or age private keys to git.

Secret handling rules for every step:

- Never type a secret as a command argument or inline `VAR='...'` assignment. Those end up in shell history and `ps`. Use the `read -rs` prompt pattern below, or your password manager's CLI injection (for example `op run --env-file=...`).
- `unset` secret variables when the step is done.
- The prompt pattern works in bash and zsh:

```sh
printf 'Secret value: '; IFS= read -rs SOME_SECRET; echo; export SOME_SECRET
# ... use it ...
unset SOME_SECRET
```

## 0. Limits and paid-plan prerequisites

Cloudflare's current documentation sets these hard constraints. Workers Free: 100,000 requests/day, 10 ms CPU per request, 50 subrequests. D1 Free: 500 MB per database, 5 GB per account, 10 databases, 50 queries per invocation, 7-day Time Travel. R2 Free usage: 10 GB-month, 1M Class A and 10M Class B operations per month. Worker CPU is CPU time, not local wall time.

Before you start, know these checkout steps:

- **R2 needs a subscription.** Cloudflare's R2 "Get started" page says: "You need a Cloudflare account with an R2 subscription … Complete the checkout flow to add an R2 subscription". R2 includes free monthly usage and bills only usage above it. This project stays far below the free usage (65 §1), but the checkout step (payment method) is still required. If you won't add a payment method, stop here and record `Blocked (tier)` (65 §1). Don't substitute another product.
- **Zero Trust Free** also asks for payment details during onboarding. The Free plan is not charged.
- Nothing here needs Workers Paid. **Free-plan CPU fit is UNVERIFIED** until step 9 is done against real traffic (Q-4 scaling risk).

## 1. Account and Zero Trust team

1. Create or sign in to a Cloudflare account and enable 2FA: https://dash.cloudflare.com/sign-up.
2. Open **Zero Trust** and create an organization on the **Free** plan. The team name you choose becomes `<team>.cloudflareaccess.com`.
3. Under **Zero Trust > Settings > Authentication > Login methods**, enable **One-time PIN**.
4. Record the team host name exactly: lowercase, no `https://`.

Verify (public endpoint, no credentials needed):

```sh
curl -fsS "https://<team>.cloudflareaccess.com/cdn-cgi/access/certs" | jq -e '.keys | length >= 1'
```

## 2. D1, R2 and the Wrangler config (H2)

1. In **Storage & databases > R2 > Overview**, complete the R2 subscription checkout (see step 0).
2. From the repository root:

```sh
pnpm install --frozen-lockfile
cd apps/api
pnpm exec wrangler login            # browser OAuth; no token is typed
pnpm exec wrangler whoami
pnpm exec wrangler d1 create uma-spark-calc
pnpm exec wrangler r2 bucket create uma-spark-calc-crops
```

3. Edit `apps/api/wrangler.jsonc`:
   - Copy the `database_id` printed by `d1 create` into **both** `d1_databases[0].database_id` entries: top-level and `env.production`.
   - Set both `ACCESS_TEAM_DOMAIN` values to `<team>.cloudflareaccess.com`.
   - Never add `AUTH_DISABLED`.
   - `MASTER_VERSION` must equal `apps/web/public/master/latest.json` `.version`. CI enforces this.
4. Merge that change to `main` through a pull request. The IDs are not secrets.

Verify:

```sh
pnpm exec wrangler d1 info uma-spark-calc
pnpm exec wrangler r2 bucket list | grep -F 'uma-spark-calc-crops'
cd ../.. && node .github/scripts/check-config.mjs . --require-provisioned
# expected: config check ok (provisioned): MASTER_VERSION=global-20260930
```

## 3. workers.dev host name and the Access application (before any deploy)

Create the Access application **before** the Worker is first deployed, so the host name is never publicly reachable.

1. In **Workers & Pages**, note the account's `workers.dev` subdomain. If none exists yet, register one on that page. The production host is then `uma-spark-calc.<subdomain>.workers.dev`.
2. Go to **Zero Trust > Access controls > Applications > Create new application > Self-hosted and private > Add public hostname**, and enter that exact host with no path. This protects the SPA, `/master/*`, crops and the API.
   - Name: **Uma Spark Calc**.
   - Policy 1, **Allow**: Include > Emails > your email address. The login method is One-time PIN.
   - Policy 2, **Service Auth**: Include > Service Token > `uma-agent` (created in step 4; come back and attach it).
   - Access is deny-by-default. Never add an Everyone or Bypass policy for the host name.
3. Open the application's **Overview/Basic information** and copy the **Application Audience (AUD) Tag**. It is used once in step 5. Don't paste it into chat or git.

`wrangler.jsonc` sets `env.production.preview_urls: false`. Version and preview URLs are separate host names that this host-name Access application does not cover, so they stay disabled. Alternatively, you can protect the whole Worker from **Workers & Pages > uma-spark-calc > Access** once it exists. That covers every host name and preview. The Worker still validates the Access JWT either way.

`/api/v1/health` is outside the Worker's JWT middleware only. Edge Access still protects it. If an external uptime monitor ever needs it, create a separately reviewed Bypass application for exactly that path. Never bypass `/api/*` data routes, `/master/*` or `/`.

Verify: **Zero Trust > Access controls > Applications** lists `Uma Spark Calc` with the exact host and both policies.

## 4. Agent service token (H2)

1. Go to **Zero Trust > Access controls > Service credentials > Service Tokens > Create**. Name it `uma-agent` and choose a finite duration.
2. The client secret is shown once. Store the ID and secret only in your password manager and in the Windows agent's Settings dialog (DPAPI).
3. Attach the token to the application's **Service Auth** policy (step 3).

Verification happens after the first deploy (step 6), because only then does something answer behind Access.

## 5. First deploy with ACCESS_AUD (H2, from a clean checkout of `main`)

The Worker fails closed without `ACCESS_AUD` (apps/api/src/auth.ts `resolveAuthMode`). Upload the secret **in the same deploy that creates the Worker**, using `wrangler deploy --secrets-file`. This avoids `wrangler secret put` against a Worker that doesn't exist yet: that path prompts interactively to create one.

From the repository root:

```sh
git switch main && git pull --ff-only && git status --short   # must be clean
pnpm install --frozen-lockfile
node .github/scripts/check-config.mjs . --require-provisioned
pnpm --filter web build                 # committed master data; never `pnpm -r build`
cd apps/api
pnpm exec wrangler deploy --env production --dry-run --outdir "$(mktemp -d)"
pnpm exec wrangler d1 migrations apply uma-spark-calc --remote --env production

# ACCESS_AUD goes through a prompt into a private temp file (never argv or history).
# The subshell EXIT trap cleans up even if Wrangler or the operator interrupts the step.
(
  umask 077
  secrets_file=$(mktemp)
  trap 'rm -f "$secrets_file"; unset ACCESS_AUD' EXIT
  printf 'Access AUD tag: '; IFS= read -rs ACCESS_AUD; echo
  test -n "$ACCESS_AUD" || { echo 'ACCESS_AUD is empty; refusing deploy' >&2; exit 1; }
  printf 'ACCESS_AUD=%s\n' "$ACCESS_AUD" >"$secrets_file"   # shell builtin: no argv exposure
  unset ACCESS_AUD
  pnpm exec wrangler deploy --env production --strict --secrets-file "$secrets_file"
)
```

If the account has no `workers.dev` subdomain yet, `wrangler deploy` asks to register one. Accept it, then make sure the Access application host (step 3) matches.

Verify that the secret exists without printing its value:

```sh
pnpm exec wrangler secret list --env production | jq -e 'map(.name) | index("ACCESS_AUD") != null'
```

## 6. Verify through Access (H2)

`.github/scripts/verify-production.sh` asserts exact HTTP status codes and response bodies, and never follows redirects. An Access login redirect (302) therefore always counts as a failure. It checks:

1. Anonymous `/`, `/master/latest.json` and `/api/v1/health` are blocked by Access (302/401/403).
2. With the service token, `/api/v1/health` returns 200 with `ok: true` and the expected `masterVersion`.
3. `/master/latest.json` (the index; **not** `/master/<version>/latest.json`) returns 200 with the expected `.version`.
4. `/api/v1/roster` returns 200 JSON. This proves the Worker accepted the Access JWT, so `ACCESS_AUD` and the team domain are correct. A 401 means an AUD or team mismatch.

```sh
cd "$(git rev-parse --show-toplevel)"
printf 'uma-agent client ID: '; IFS= read -rs CF_ACCESS_CLIENT_ID; echo; export CF_ACCESS_CLIENT_ID
printf 'uma-agent client secret: '; IFS= read -rs CF_ACCESS_CLIENT_SECRET; echo; export CF_ACCESS_CLIENT_SECRET
bash .github/scripts/verify-production.sh "https://uma-spark-calc.<subdomain>.workers.dev" \
  "$(jq -r .version apps/web/public/master/latest.json)"
unset CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
# expected last line: production verification: all checks passed
```

The script sends the headers to curl on stdin, not argv. Then check in a private browser window: `/` shows the Access login, and after the email OTP both the SPA and `/master/latest.json` load.

## 7. Deploy API token (H2)

Go to **My Profile / Manage Account > Account API tokens > Create Token > Custom token**. Grant exactly these permissions, scoped to this one account:

- Account › **Workers Scripts** › Edit
- Account › **D1** › Edit
- Account › **Workers R2 Storage** › Edit
- Account › **Account Settings** › Read

Set a finite TTL (expiry). Optionally restrict client IPs, but GitHub-hosted runner IPs are not stable, so this is usually impractical. Copy the token once, into your password manager.

Verify read access for each resource type, without echoing the token:

```sh
cd apps/api
printf 'Cloudflare API token: '; IFS= read -rs CLOUDFLARE_API_TOKEN; echo; export CLOUDFLARE_API_TOKEN
printf 'Cloudflare account ID: '; IFS= read -r CLOUDFLARE_ACCOUNT_ID; export CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler d1 info uma-spark-calc                                  # D1
pnpm exec wrangler r2 bucket list | grep -F uma-spark-calc-crops           # R2
pnpm exec wrangler deployments list --env production | head -n 5          # Workers Scripts
pnpm exec wrangler d1 migrations list uma-spark-calc --remote --env production
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
```

These commands prove only read access. **Edit** permission is proven by the first CI deploy (step 8). There is no non-mutating command that proves it.

## 8. GitHub environment `production` (H2)

Keep the repository's visibility unchanged. Deploy secrets live on an **environment**, not at repository level, so only the deploy job can read them.

1. Go to **Settings > Environments > New environment** and name it `production`.
2. **Deployment branches and tags: Selected branches and tags**, then add a rule for exactly `main`. Workflow runs from any other ref, including forks, can't enter the environment. For `workflow_run` the ref is the default branch, which is also what deploy.yml checks explicitly.
3. Optional but recommended: **Required reviewers** (yourself), so every production deploy waits for a click. You can also tick **Prevent self-review** if a second person exists. On GitHub Free, required reviewers and environment secrets are available for public repositories. For a private repository they need GitHub Pro/Team.
4. **Environment secrets**: `CLOUDFLARE_API_TOKEN` (step 7) and `CLOUDFLARE_ACCOUNT_ID`. Don't also add them as repository secrets.
5. Go to **Settings > Secrets and variables > Actions > Variables** and add the **repository variable** `PRODUCTION_DEPLOY_ENABLED` = `true`. Add it only after steps 1–7 pass. Until it exists, deploy.yml ends successfully with an explicit "SKIPPED: production deploy is not enabled" notice and never touches Cloudflare.
6. Optional hardening: protect `main` with a branch ruleset (require a pull request and the CI checks).

What deploy.yml enforces (see `.github/workflows/deploy.yml` and `.github/scripts/deploy-gate.sh`):

- It runs only after a **successful CI run triggered by `push`** to **`main`** of **this repository** (`head_repository == github.repository`). Pull-request runs, including a fork branch named `main`, are rejected before any candidate code is checked out.
- Deploys are serialised with `concurrency: production-deploy`, `cancel-in-progress: false`. A running migration or deploy is never cancelled.
- Inside that lock, immediately before migrations, the candidate SHA must still be the tip of `main`. A stale run logs `SKIPPED: candidate … is stale` and exits successfully without migrating or deploying.
- The preflight fails if the environment secrets are missing, the D1 ID is the placeholder, or `ACCESS_TEAM_DOMAIN` is empty.

Verify: push a trivial commit to `main` (or re-run the latest main CI). **Actions > Deploy production** must show the gate passing, the approval if you set one, the migration, then the deploy. Afterwards rerun step 6.

## 9. Post-deploy CPU check (H2)

Open **Workers & Pages > uma-spark-calc > Metrics**. Look at **CPU time** percentiles (not wall time), errors and request counts after exercising the roster/import flows. The Free limit is 10 ms CPU per request. Until you record these numbers, Free-tier CPU fit is **UNVERIFIED**, and Q-4 (large-roster scaling) stays open.

## 10. Rotate and revoke

- **API token:** create the new token (step 7) and replace the `production` environment secret (plus the `backup` environment secret, see backup.md). Trigger a deploy/backup to verify, then roll or delete the old token under **Account API tokens**.
- **Service token:** create a new token under the same policy, update the agent Settings, rerun step 6 with the new values, then revoke the old token.
- **ACCESS_AUD** changes only if the Access application is recreated. Upload the new value with `wrangler secret put ACCESS_AUD --env production` (it prompts; the Worker exists by then), then rerun step 6.
- **Backup age key:** see backup.md §5.

## Resource names

Required names are fixed:

| Resource                    | Name                                                |
| --------------------------- | --------------------------------------------------- |
| Worker                      | `uma-spark-calc`                                    |
| D1 database (binding `DB`)  | `uma-spark-calc`                                    |
| R2 bucket (binding `CROPS`) | `uma-spark-calc-crops`                              |
| Access application          | `Uma Spark Calc`                                    |
| Service token               | `uma-agent`                                         |
| GitHub environments         | `production`, `backup`                              |
| Repository variables        | `PRODUCTION_DEPLOY_ENABLED`, `BACKUP_AGE_RECIPIENT` |

Q-100 through Q-109 are reserved for H2 setup follow-ups.

Sources checked 2026-09-30 (fetched as Markdown from developers.cloudflare.com and docs.github.com):

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/r2/get-started/ (R2 subscription checkout requirement)
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/ (host-name vs Worker-level Access)
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/workers/wrangler/configuration/ (`workers_dev`, `preview_urls`)
- https://developers.cloudflare.com/workers/configuration/secrets/ (`--secrets-file` "Upload secrets alongside code")
- https://developers.cloudflare.com/workers/wrangler/commands/workers/ (`secret put`, `deploy --secrets-file`)
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/ (permission names)
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows (`workflow_run`)
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
