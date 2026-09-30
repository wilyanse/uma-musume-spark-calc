# Cloudflare production setup (H2)

This runbook creates the resources used by `uma-spark-calc`. It is intentionally human-run: do not put account IDs, Access AUDs, API tokens, or service-token secrets in git.

Cloudflare's current documentation confirms these hard constraints: Workers Free is 100,000 requests/day and 10 ms CPU/request with 50 subrequests; D1 Free is 500 MB/database, 5 GB/account, 10 databases, and 50 queries/invocation; R2 Free includes 10 GB-month, 1M Class A and 10M Class B operations/month. Worker CPU is CPU time, not local wall time. See https://developers.cloudflare.com/workers/platform/limits/, https://developers.cloudflare.com/d1/platform/limits/, and https://developers.cloudflare.com/r2/pricing/.

## 1. Create the account and Zero Trust team

1. Create/sign in to a Cloudflare account and enable 2FA: https://dash.cloudflare.com/sign-up.
2. Open **Zero Trust** from the dashboard and create an organization on the Zero Trust Free plan. Enter a team name; it becomes `<team>.cloudflareaccess.com`. The current Cloudflare onboarding asks for payment details even on the Free plan; it says the Free plan is not charged.
3. Enable **One-time PIN** under **Zero Trust > Settings > Authentication > Login methods**. Record the team hostname exactly (lowercase, no `https://`).

Verify:

```sh
curl -fsS "https://<team>.cloudflareaccess.com/cdn-cgi/access/certs" | jq -e '.keys | length >= 1'
```

## 2. Create D1 and R2

From the repository root, use the pinned Wrangler from `apps/api`:

```sh
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create uma-spark-calc
pnpm exec wrangler r2 bucket create uma-spark-calc-crops
pnpm exec wrangler d1 list
pnpm exec wrangler r2 bucket list
```

Copy the D1 `database_id` from `d1 create` into both the top-level and `env.production.d1_databases[0]` entries in `apps/api/wrangler.jsonc`. Set both `ACCESS_TEAM_DOMAIN` vars there to the team hostname. Do not add `AUTH_DISABLED` to the file. The committed `MASTER_VERSION` (`global-20260930`) must match the committed directory under `apps/web/public/master/`.

Verify the database ID and storage location:

```sh
pnpm exec wrangler d1 info uma-spark-calc
pnpm exec wrangler r2 bucket list | grep -F 'uma-spark-calc-crops'
```

## 3. Create the Access application and policies

Protect the entire production hostname, not just `/api`: this covers the SPA, `/master/*`, crops, and API. Cloudflare's dashboard path is **Zero Trust > Access controls > Applications > Create new application > Self-hosted and private > Add public hostname**. Use either:

- `uma-spark-calc.<your-subdomain>.workers.dev`, or
- the chosen custom-domain hostname.

Name it **Uma Spark Calc**. Add an **Allow** policy for the user's email address and use One-time PIN. Add a second **Service Auth** policy for the service token named `uma-agent`. Access policies are deny-by-default. Do not add an Everyone bypass.

The Worker itself deliberately leaves `/api/v1/health` outside its JWT middleware for health checks. This is not an unauthenticated public application: the hostname-level Access application still protects the health request at the edge. If an external uptime monitor must reach health without Access, create a separately reviewed, narrowly scoped Access bypass for that path; never bypass the whole hostname and never bypass `/api/*` data routes. The static SPA and master data must remain behind Access.

Verify in **Zero Trust > Access controls > Applications** that the application domain covers the production hostname and that both policies are attached. In a browser, an incognito request to `/` must show Access login; after the email OTP, `/` and `/master/global-20260930/latest.json` must load.

## 4. Create the agent service token

In **Zero Trust > Access controls > Service credentials > Service Tokens**, create **uma-agent**. Choose a finite duration and record the displayed client ID and secret only in the Windows agent's Settings dialog / DPAPI storage. Never commit or paste them into this repository. In the application's policies, ensure the token is accepted by the **Service Auth** policy.

Verify from a machine where the values can be supplied by its secret manager (do not put values in shell history):

```sh
curl -fsSI \
  -H 'CF-Access-Client-Id: <client-id>' \
  -H 'CF-Access-Client-Secret: <client-secret>' \
  'https://<production-host>/api/v1/health'
```

A successful response is HTTP 200. A request without the headers must be redirected/blocked by Access. The Worker still validates the Access JWT; Access service-token authentication is not a replacement for that check.

## 5. Create the deploy API token

Go to **Account API tokens > Create Token > Custom**. Scope it to this account and grant only the permissions needed by this repository: Workers Scripts Edit, D1 Edit, and R2 Edit (plus account read if the dashboard requires it for these operations). Restrict resources to the account containing the three named resources. Copy the token once.

In the GitHub repository, open **Settings > Secrets and variables > Actions** and add exactly:

- `CLOUDFLARE_API_TOKEN` — the token value
- `CLOUDFLARE_ACCOUNT_ID` — the account ID

Verify locally without printing the token:

```sh
CLOUDFLARE_API_TOKEN='...' CLOUDFLARE_ACCOUNT_ID='<id>' \
  pnpm exec wrangler whoami
```

## 6. Dry-run, migrate, and deploy

From a clean checkout, build static assets from committed master data. Do not run `pnpm -r build`; the master-data build fetches game data and can create a new version.

```sh
cd apps/api
pnpm install --frozen-lockfile
pnpm --filter web build
pnpm exec wrangler deploy --env production --dry-run --outdir .wrangler/dry-run
pnpm exec wrangler d1 migrations apply uma-spark-calc --remote --env production
pnpm exec wrangler deploy --env production --strict
```

Verify configuration and the deployed resources:

```sh
pnpm exec wrangler d1 info uma-spark-calc
pnpm exec wrangler r2 bucket list | grep -F 'uma-spark-calc-crops'
curl -fsS 'https://<production-host>/api/v1/health'  # after Access login/token
curl -fsS 'https://<production-host>/master/global-20260930/latest.json' | jq -e '.version == "global-20260930"'
```

After the first deploy, inspect **Workers & Pages > uma-spark-calc > Metrics**. Confirm CPU time (not wall time), request counts, errors, and bundle/startup checks. The local dry-run cannot prove the Free-plan 10 ms CPU budget. Q-4 remains an explicit scaling risk for large rosters.

## 7. Rotate and revoke

Treat the API token and service-token secret as credentials. Rotate them from their respective Cloudflare dashboard pages, update the GitHub secret or Windows agent settings, and revoke the old credential after verifying the new one. Access application AUD values are copied into the Worker secret named `ACCESS_AUD` and are not committed.

Set the Worker secret after creating the Access application:

```sh
cd apps/api
printf '%s' '<aud-tag>' | pnpm exec wrangler secret put ACCESS_AUD --env production
```

Verify that `ACCESS_AUD` is present by making an authenticated API request; do not use a command that prints secret values.

## Resource names and Q-number reservation

Required names are fixed: Worker `uma-spark-calc`, D1 `uma-spark-calc` binding `DB`, R2 `uma-spark-calc-crops` binding `CROPS`, Access app `Uma Spark Calc`, service token `uma-agent`. Q-100 through Q-109 are reserved for H2 setup follow-ups; this task does not invent account-specific values.

Sources checked 2026-09-30:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
