#!/usr/bin/env bash
# Post-deploy verification through Cloudflare Access (T12 review B5). HUMAN/H2 ONLY: needs the
# `uma-agent` service token. Never pass the token on the command line; export it from a secret
# manager (e.g. `op run --env-file=...`) or the read -s prompt in docs/runbooks/cloudflare-setup.md.
#
#   verify-production.sh <base-url> <expected-master-version>
#   e.g. verify-production.sh https://uma-spark-calc.example.workers.dev global-20260930
#
# Environment: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
#
# Every check asserts an exact HTTP status and the response body. Redirects are never followed, so
# an Access login redirect (302) can never be mistaken for success.
set -euo pipefail
umask 077

base="${1:?usage: verify-production.sh <base-url> <expected-master-version>}"
expected="${2:?usage: verify-production.sh <base-url> <expected-master-version>}"
base="${base%/}"
: "${CF_ACCESS_CLIENT_ID:?CF_ACCESS_CLIENT_ID must be exported (secret manager or read -s)}"
: "${CF_ACCESS_CLIENT_SECRET:?CF_ACCESS_CLIENT_SECRET must be exported (secret manager or read -s)}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

# request <auth|anon> <path> -> prints the HTTP status; body in $work/body
request() {
  local mode="$1" path="$2"
  if [[ "$mode" == auth ]]; then
    # Headers travel through curl's stdin config, not argv (no ps / shell-history exposure).
    printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' \
      "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" |
      curl --config - --silent --show-error --max-time 30 --max-redirs 0 \
        --output "$work/body" --write-out '%{http_code}' "$base$path" || true
  else
    curl --silent --show-error --max-time 30 --max-redirs 0 \
      --output "$work/body" --write-out '%{http_code}' "$base$path" </dev/null || true
  fi
}

pass() { echo "PASS $*"; }
bad() { echo "FAIL $*"; failures=$((failures + 1)); }

# 1. Anonymous requests must NOT reach the app (Access redirects to login or denies).
for path in / /master/latest.json /api/v1/health; do
  code=$(request anon "$path")
  if [[ "$code" == 302 || "$code" == 401 || "$code" == 403 ]]; then
    pass "anonymous $path -> $code (blocked by Access)"
  else
    bad "anonymous $path -> $code (expected 302/401/403; hostname is not behind Access?)"
  fi
done

# 2. Health: exact 200 + JSON body.
code=$(request auth /api/v1/health)
if [[ "$code" == 200 ]] && jq -e --arg v "$expected" '.ok == true and .masterVersion == $v' "$work/body" >/dev/null 2>&1; then
  pass "service-token /api/v1/health -> 200, ok=true, masterVersion=$expected"
else
  bad "service-token /api/v1/health -> $code (expected 200 with ok=true, masterVersion=$expected)"
fi

# 3. Master index behind Access: /master/latest.json (NOT /master/<version>/latest.json).
code=$(request auth /master/latest.json)
if [[ "$code" == 200 ]] && jq -e --arg v "$expected" '.version == $v and (.files | length) > 0' "$work/body" >/dev/null 2>&1; then
  pass "service-token /master/latest.json -> 200, version=$expected"
else
  bad "service-token /master/latest.json -> $code (expected 200 with version=$expected)"
fi

# 4. A JWT-protected route proves the Worker accepts the Access JWT (ACCESS_AUD/ACCESS_TEAM_DOMAIN).
code=$(request auth /api/v1/roster)
if [[ "$code" == 200 ]] && jq -e 'type == "object" or type == "array"' "$work/body" >/dev/null 2>&1; then
  pass "service-token /api/v1/roster -> 200 JSON (Worker validated the Access JWT)"
else
  bad "service-token /api/v1/roster -> $code (401 = ACCESS_AUD/team mismatch; 5xx = misconfigured)"
fi

if ((failures > 0)); then
  echo "production verification: $failures check(s) failed"
  exit 1
fi
echo "production verification: all checks passed"
