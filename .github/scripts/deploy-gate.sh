#!/usr/bin/env bash
# Production deploy gate (T12 review B1/B2/S3). Runs from the TRUSTED default-branch checkout,
# before any candidate code is checked out or executed.
#
#   deploy-gate.sh trust   verify the triggering CI run is a successful PUSH to this repo's main,
#                          then check freshness (below). Untrusted input fails the job.
#   deploy-gate.sh fresh   re-check only that WR_HEAD_SHA is still the tip of main.
#
# Writes proceed=true|false to $GITHUB_OUTPUT. A stale SHA or a deploy that H2 has not enabled
# yet is a clear, successful skip (proceed=false); it is never an error and never a deploy.
#
# Inputs (environment): GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_TOKEN,
# GITHUB_OUTPUT, WR_EVENT, WR_CONCLUSION, WR_HEAD_BRANCH, WR_HEAD_REPO, WR_HEAD_SHA,
# DEPLOY_ENABLED (repository/environment variable PRODUCTION_DEPLOY_ENABLED).
set -euo pipefail

mode="${1:-}"
out="${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

fail() {
  echo "::error::deploy gate: $*"
  exit 1
}
skip() {
  echo "::notice::deploy gate: SKIPPED: $*"
  echo 'proceed=false' >>"$out"
  exit 0
}

[[ "$mode" == trust || "$mode" == fresh ]] || fail "usage: deploy-gate.sh trust|fresh"
[[ "${WR_HEAD_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail "workflow_run head_sha is missing or malformed"

if [[ "$mode" == trust ]]; then
  [[ "${GITHUB_EVENT_NAME:-}" == workflow_run ]] || fail "event is '${GITHUB_EVENT_NAME:-}', expected workflow_run"
  [[ "${WR_CONCLUSION:-}" == success ]] || fail "CI conclusion is '${WR_CONCLUSION:-}', expected success"
  [[ "${WR_EVENT:-}" == push ]] || fail "CI was triggered by '${WR_EVENT:-}', only 'push' may deploy"
  [[ "${WR_HEAD_BRANCH:-}" == main ]] || fail "CI branch is '${WR_HEAD_BRANCH:-}', only 'main' may deploy"
  [[ -n "${GITHUB_REPOSITORY:-}" && "${WR_HEAD_REPO:-}" == "$GITHUB_REPOSITORY" ]] ||
    fail "CI head repository '${WR_HEAD_REPO:-}' is not '${GITHUB_REPOSITORY:-}' (fork runs never deploy)"
  if [[ "${DEPLOY_ENABLED:-}" != true ]]; then
    skip "production deploy is not enabled (H2 sets variable PRODUCTION_DEPLOY_ENABLED=true after docs/runbooks/cloudflare-setup.md)"
  fi
fi

api="${GITHUB_API_URL:-https://api.github.com}"
[[ -n "${GITHUB_TOKEN:-}" ]] || fail "GITHUB_TOKEN is required to read the main tip"
# The token goes through curl's stdin config, not argv.
if ! body=$(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" |
  curl --config - -fsS --max-time 30 -H 'Accept: application/vnd.github+json' \
    "$api/repos/$GITHUB_REPOSITORY/git/ref/heads/main"); then
  fail "could not read the current main tip; refusing to deploy"
fi
tip=$(printf '%s' "$body" | jq -r '.object.sha // empty')
[[ "$tip" =~ ^[0-9a-f]{40}$ ]] || fail "main tip response is malformed; refusing to deploy"

if [[ "$tip" != "$WR_HEAD_SHA" ]]; then
  skip "candidate $WR_HEAD_SHA is stale; main is now $tip. The newer CI run deploys main."
fi

echo "deploy gate ($mode): candidate $WR_HEAD_SHA is the tip of main"
echo 'proceed=true' >>"$out"
