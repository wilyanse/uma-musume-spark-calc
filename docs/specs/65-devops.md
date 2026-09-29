# 65 — DevOps, hosting, security

Owner task: **T12**.

## 1. Free-tier limits (Cloudflare docs, fetched 2026-09-29): hard constraints
| Product | Free limit | Our usage |
|---|---|---|
| Workers | 100,000 requests/day; **10 ms CPU per request**; 50 subrequests | < 1,000/day. Static assets are free and unlimited, and don't invoke the Worker |
| D1 | 500 MB per DB, 5 GB per account, 10 DBs, **50 queries per Worker invocation**, 7-day Time Travel | < 20 MB even at 5,000 veterans |
| R2 | 10 GB-month, 1M class A / 10M class B ops per month | crops ≤ 60 KB; < 50 MB |
| Access (Zero Trust Free) | free for small teams (single user here) | 1 user + 1 service token |

Nothing may need Workers Paid. If a task finds it needs a paid feature, it stops with status `Blocked (tier)` in its changelog.

## 2. Resources (exact names)
| Resource | Name |
|---|---|
| Worker (with static assets) | `uma-spark-calc` |
| D1 database | `uma-spark-calc` (binding `DB`) |
| R2 bucket | `uma-spark-calc-crops` (binding `CROPS`) |
| Access application | `Uma Spark Calc`, covering the Worker hostname (`uma-spark-calc.<subdomain>.workers.dev`, or a custom domain if the user has one) |
| Access policy | Allow: the user's email (one-time PIN). Service Auth: service token `uma-agent` |

## 3. Secrets and environment variables (exact names)
| Name | Where | Purpose |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | Worker var | JWT issuer / JWKS |
| `ACCESS_AUD` | Worker secret | Access application AUD tag |
| `AUTH_DISABLED` | `.dev.vars` only | local dev |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | deploy (Workers, D1 and R2 edit on the account) |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | deploy |
| Agent service token id/secret | Windows DPAPI via the agent Settings dialog | agent → API |

## 4. CI/CD (`.github/workflows/`)
- `ci.yml` on PRs and pushes: pnpm install (frozen), lint, typecheck, test for all TS packages; `dotnet test agent/tests/Uma.Agent.Core.Tests`; `dotnet build agent/src/Uma.Agent.Windows -p:EnableWindowsTargeting=true`; web build + bundle size check.
- `deploy.yml` on push to `main` (after CI): `wrangler d1 migrations apply uma-spark-calc --remote`, then `wrangler deploy`. Master data ships inside the web assets.
- `agent-release.yml` on tag `agent-v*`: a `windows-latest` runner publishes the single-file exe as a release asset.

## 5. Runbooks (`docs/runbooks/`)
- `cloudflare-setup.md`: step-by-step for the human (H2): create the D1 DB and R2 bucket, set up Zero Trust with the team domain, create the Access app and policy, the service token, the API token, and set the GitHub secrets. Each step lists the exact command or dashboard path and how to verify it.
- `agent-install.md`: install, first-run settings, capture workflow, troubleshooting (unsupported aspect ratio, unknown screen, low confidence).
- `backup.md`: `wrangler d1 export uma-spark-calc --remote --output backup.sql`, run weekly by a scheduled GitHub Action that stores the file as a 90-day artifact.

## 6. Security
- Every `/api/*` route (except health) needs a valid Access JWT (40 §3). CORS is off: the SPA is same-origin, and the agent isn't a browser.
- No PII apart from the guest trainer names that appear on screen. They're stored as captured.
- Dependency pinning; `pnpm audit --prod` in CI (report only).

## 7. Acceptance (T12)
- The CI workflow runs green on the task branch. Since the repo is on GitHub, record the run URL; if Actions can't run, record `act` or local equivalent commands and their output.
- `wrangler deploy --dry-run` succeeds locally, and its output is recorded.
- The runbooks exist, and each step has a verify command.
- The real deploy is **blocked on H2** (the user creates the Cloudflare account and resources), so status is `Partial`.
