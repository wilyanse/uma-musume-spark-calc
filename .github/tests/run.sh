#!/usr/bin/env bash
# Local regression checks for the T12 workflows and helper scripts. No network, no cloud access,
# no real credentials: every key is generated ephemerally in a temp dir and deleted on exit.
#
#   bash .github/tests/run.sh
#
# Optional: TOOLS_DIR (holds pinned age/age-keygen/actionlint), otherwise PATH is searched.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"
tools="${TOOLS_DIR:-}"
find_tool() {
  if [[ -n "$tools" && -x "$tools/$1" ]]; then echo "$tools/$1"; else command -v "$1" || true; fi
}
AGE=$(find_tool age)
AGE_KEYGEN=$(find_tool age-keygen)
ACTIONLINT=$(find_tool actionlint)
for t in AGE AGE_KEYGEN ACTIONLINT; do
  [[ -n "${!t}" ]] || { echo "missing tool: $t (run .github/scripts/install-tool.sh)"; exit 1; }
done
for t in jq sqlite3 ruby python3 node pnpm curl; do
  command -v "$t" >/dev/null || { echo "missing tool: $t"; exit 1; }
done

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
passes=0
fails=0
ok() { passes=$((passes + 1)); echo "  ok   $*"; }
no() { fails=$((fails + 1)); echo "  FAIL $*"; }
expect() { # expect <description> <expected-exit> <cmd...>
  local desc="$1" want="$2"
  shift 2
  local got=0
  "$@" >"$scratch/last.log" 2>&1 || got=$?
  if [[ "$got" == "$want" ]]; then ok "$desc (exit $got)"; else no "$desc (exit $got, wanted $want)"; sed 's/^/       | /' "$scratch/last.log"; fi
}

# ---------------------------------------------------------------------------------------------
echo "== actionlint (workflow syntax, expressions, embedded shell via shellcheck if present)"
expect "actionlint .github/workflows/*.yml" 0 "$ACTIONLINT" -color=false .github/workflows/ci.yml .github/workflows/deploy.yml .github/workflows/backup.yml .github/workflows/agent-release.yml

# ---------------------------------------------------------------------------------------------
echo "== workflow structure (parsed YAML)"
expect "deploy/ci/backup/release structural assertions" 0 ruby .github/tests/workflow_structure.rb

# ---------------------------------------------------------------------------------------------
echo "== deploy gate: trusted vs fork/PR events, stale SHA"
bin="$scratch/bin"
mkdir -p "$bin"
# Fake curl: answers the main-ref lookup from $FAKE_TIP, records argv, swallows stdin config.
cat >"$bin/curl" <<'EOF'
#!/usr/bin/env bash
cat >"$FAKE_DIR/curl.stdin"
printf '%s\n' "$@" >"$FAKE_DIR/curl.argv"
[[ "${FAKE_CURL_FAIL:-}" == 1 ]] && exit 22
printf '{"ref":"refs/heads/main","object":{"sha":"%s","type":"commit"}}' "$FAKE_TIP"
EOF
chmod +x "$bin/curl"
SHA_A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
SHA_B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
gate() { # gate <mode> KEY=VALUE... ; prints proceed value to $scratch/proceed
  local mode="$1"
  shift
  : >"$scratch/gh_out"
  local rc=0
  env -i PATH="$bin:$PATH" HOME="$HOME" FAKE_DIR="$scratch" FAKE_TIP="$SHA_A" \
    GITHUB_OUTPUT="$scratch/gh_out" GITHUB_EVENT_NAME=workflow_run GITHUB_REPOSITORY=owner/uma \
    GITHUB_API_URL=https://api.github.invalid GITHUB_TOKEN=ghs_fake_test_token \
    WR_EVENT=push WR_CONCLUSION=success WR_HEAD_BRANCH=main WR_HEAD_REPO=owner/uma \
    WR_HEAD_SHA="$SHA_A" DEPLOY_ENABLED=true "$@" \
    bash .github/scripts/deploy-gate.sh "$mode" >"$scratch/gate.log" 2>&1 || rc=$?
  sed -n 's/^proceed=//p' "$scratch/gh_out" >"$scratch/proceed"
  return "$rc"
}
gate_case() { # gate_case <desc> <want-exit> <want-proceed|-> <mode> KEY=VALUE...
  local desc="$1" want="$2" wantp="$3" mode="$4"
  shift 4
  local rc=0
  gate "$mode" "$@" || rc=$?
  local p
  p=$(cat "$scratch/proceed")
  if [[ "$rc" == "$want" && "$p" == "${wantp/-/}" ]]; then
    ok "$desc (exit $rc, proceed=${p:-none})"
  else
    no "$desc (exit $rc, proceed=${p:-none}; wanted exit $want, proceed=${wantp})"
    sed 's/^/       | /' "$scratch/gate.log"
  fi
}
gate_case "trusted push to main at the tip -> deploy" 0 true trust
gate_case "fork PR whose head branch is named main -> refused" 1 - trust WR_EVENT=pull_request WR_HEAD_REPO=attacker/uma
gate_case "fork push event from another repository -> refused" 1 - trust WR_HEAD_REPO=attacker/uma
gate_case "same-repo pull_request run on main -> refused" 1 - trust WR_EVENT=pull_request
gate_case "pull_request_target run -> refused" 1 - trust WR_EVENT=pull_request_target
gate_case "push to a non-main branch -> refused" 1 - trust WR_HEAD_BRANCH=feature
gate_case "failed CI conclusion -> refused" 1 - trust WR_CONCLUSION=failure
gate_case "gate invoked by a non-workflow_run event -> refused" 1 - trust GITHUB_EVENT_NAME=push
gate_case "malformed head_sha -> refused" 1 - trust 'WR_HEAD_SHA=abc;rm -rf /'
gate_case "deploy not enabled by H2 yet -> clear skip" 0 false trust DEPLOY_ENABLED=
gate_case "stale SHA (main moved on) -> clear skip" 0 false trust FAKE_TIP="$SHA_B"
gate_case "stale SHA at freshness re-check -> clear skip" 0 false fresh FAKE_TIP="$SHA_B"
gate_case "fresh SHA at freshness re-check -> deploy" 0 true fresh
gate_case "main tip lookup fails -> refuse (fail closed)" 1 - fresh FAKE_CURL_FAIL=1
gate trust >/dev/null 2>&1 || true
if grep -q ghs_fake_test_token "$scratch/curl.argv"; then no "GITHUB_TOKEN leaked into curl argv"; else ok "GITHUB_TOKEN absent from curl argv"; fi
if grep -Fq 'Authorization: Bearer ghs_fake_test_token' "$scratch/curl.stdin"; then ok "main-tip request authenticates through curl stdin config"; else no "main-tip request omitted its authorization header"; fi
gate trust FAKE_TIP="$SHA_B" || true
if grep -q 'SKIPPED: candidate .* is stale' "$scratch/gate.log"; then ok "stale skip prints an explicit SKIPPED notice"; else no "stale skip message missing"; fi

# ---------------------------------------------------------------------------------------------
echo "== workspace coverage (all packages, incl. a future @uma/engine)"
expect "real workspace: every package has lint/typecheck/test" 0 node .github/scripts/check-workspace-coverage.mjs .
ws="$scratch/ws"
mkdir -p "$ws/packages/schema" "$ws/packages/engine"
printf 'packages:\n  - "packages/*"\n' >"$ws/pnpm-workspace.yaml"
printf '{"name":"root","private":true,"packageManager":"pnpm@11.22.0"}\n' >"$ws/package.json"
for p in schema engine; do
  printf '{"name":"@uma/%s","version":"0.0.0","private":true,"scripts":{"lint":"echo lint-%s","typecheck":"echo tc-%s","test":"echo test-ran-%s"}}\n' "$p" "$p" "$p" "$p" >"$ws/packages/$p/package.json"
done
expect "synthetic workspace with new @uma/engine: coverage ok" 0 node "$repo/.github/scripts/check-workspace-coverage.mjs" "$ws"
if (cd "$ws" && pnpm -r test 2>&1) | grep -q 'test-ran-engine'; then ok "pnpm -r test (the CI command) runs the new @uma/engine package"; else no "pnpm -r test did not run @uma/engine"; fi
printf '{"name":"@uma/engine","version":"0.0.0","private":true,"scripts":{"lint":"echo x","typecheck":"echo x"}}\n' >"$ws/packages/engine/package.json"
expect "package without a test script -> CI fails (no silent skip)" 1 node "$repo/.github/scripts/check-workspace-coverage.mjs" "$ws"

# ---------------------------------------------------------------------------------------------
echo "== wrangler config / MASTER_VERSION alignment"
cfg="$scratch/cfg"
mkdir -p "$cfg/apps/api" "$cfg/apps/web/public/master"
cp apps/api/wrangler.jsonc "$cfg/apps/api/"
cp -R apps/web/public/master/. "$cfg/apps/web/public/master/"
expect "committed config: structure + MASTER_VERSION aligned" 0 node .github/scripts/check-config.mjs "$cfg"
expect "committed placeholders are rejected by the deploy preflight" 1 node .github/scripts/check-config.mjs "$cfg" --require-provisioned
sed -e 's/"database_id": "00000000-0000-0000-0000-000000000000"/"database_id": "1234abcd-0000-4000-8000-00000000beef"/' \
  -e 's/"ACCESS_TEAM_DOMAIN": ""/"ACCESS_TEAM_DOMAIN": "example-team.cloudflareaccess.com"/' \
  apps/api/wrangler.jsonc >"$cfg/apps/api/wrangler.jsonc"
expect "provisioned (synthetic) ids pass the deploy preflight" 0 node .github/scripts/check-config.mjs "$cfg" --require-provisioned
sed 's/"MASTER_VERSION": "global-[0-9]*"/"MASTER_VERSION": "global-19990101"/' apps/api/wrangler.jsonc >"$cfg/apps/api/wrangler.jsonc"
expect "MASTER_VERSION drift from latest.json -> CI fails" 1 node .github/scripts/check-config.mjs "$cfg"
sed 's/"ACCESS_TEAM_DOMAIN": "",/"ACCESS_TEAM_DOMAIN": "", "AUTH_DISABLED": "1",/' apps/api/wrangler.jsonc >"$cfg/apps/api/wrangler.jsonc"
expect "AUTH_DISABLED in a Wrangler env -> CI fails" 1 node .github/scripts/check-config.mjs "$cfg"

# ---------------------------------------------------------------------------------------------
echo "== backup: fail-closed recipient, encrypt before upload, plaintext cleanup, decrypt + verify"
# Synthetic D1-like export: apply the real migrations to a scratch SQLite DB, add fake rows.
synth_db="$scratch/synth.db"
for m in apps/api/migrations/*.sql; do sqlite3 -bail "$synth_db" <"$m"; done
sqlite3 -bail "$synth_db" "INSERT INTO veterans (id, fingerprint, character_id, outfit_id, train_mode, mode_source, scenario_id, master_version, capture_id, captured_at, min_confidence, created_at, updated_at) VALUES ('01SYNTHETIC', 'fp-synthetic', 'chr-synthetic', 'out-synthetic', 'unknown', 'synthetic', 'scn-synthetic', 'global-20260930', 'cap-synthetic', '2026-09-30T00:00:00Z', 1.0, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z');"
sqlite3 "$synth_db" .dump >"$scratch/synthetic-export.sql"
rm -f "$synth_db"
# Fake pnpm: `pnpm exec wrangler d1 export ... --output=<f>` copies the synthetic export.
fbin="$scratch/fbin"
mkdir -p "$fbin"
cat >"$fbin/pnpm" <<'EOF'
#!/usr/bin/env bash
echo called >>"$FAKE_DIR/pnpm.calls"
out=""
for a in "$@"; do case "$a" in --output=*) out="${a#--output=}" ;; esac; done
[[ -n "$out" ]] || exit 2
cp "$FAKE_DIR/synthetic-export.sql" "$out"
[[ "${FAKE_EXPORT_FAIL:-}" == 1 ]] && { echo "simulated wrangler failure" >&2; exit 1; }
exit 0
EOF
chmod +x "$fbin/pnpm"
keydir="$scratch/ephemeral-key" # ephemeral, never printed, removed with $scratch
mkdir -m 700 "$keydir"
"$AGE_KEYGEN" -o "$keydir/identity.txt" 2>/dev/null
recipient=$("$AGE_KEYGEN" -y "$keydir/identity.txt")
backup_case() { # backup_case <desc> <want-exit> <expect-export-called 0|1> KEY=VALUE...
  local desc="$1" want="$2" called="$3"
  shift 3
  rm -rf "$scratch/tmp" "$scratch/out" "$scratch/pnpm.calls"
  mkdir -p "$scratch/tmp"
  local rc=0
  env -i PATH="$fbin:$PATH" HOME="$HOME" FAKE_DIR="$scratch" TMPDIR="$scratch/tmp" AGE_BIN="$AGE" \
    API_DIR="$repo/apps/api" GITHUB_OUTPUT="$scratch/bk_out" AGE_RECIPIENT="$recipient" "$@" \
    bash .github/scripts/backup-d1.sh "$scratch/out" >"$scratch/bk.log" 2>&1 || rc=$?
  local c=0
  [[ -f "$scratch/pnpm.calls" ]] && c=1
  local leftovers
  leftovers=$(find "$scratch/tmp" -mindepth 1 | wc -l | tr -d ' ')
  if [[ "$rc" == "$want" && "$c" == "$called" && "$leftovers" == 0 ]]; then
    ok "$desc (exit $rc, export called=$c, temp leftovers=$leftovers)"
  else
    no "$desc (exit $rc/$want, export called=$c/$called, temp leftovers=$leftovers)"
    sed 's/^/       | /' "$scratch/bk.log"
  fi
}
backup_case "missing BACKUP_AGE_RECIPIENT -> fail before export" 1 0 AGE_RECIPIENT=
backup_case "non-age recipient -> fail before export" 1 0 AGE_RECIPIENT=not-a-key
backup_case "age1 recipient with bad checksum -> fail before export" 1 0 AGE_RECIPIENT="${recipient%?????}qqqqq"
backup_case "private key pasted as recipient -> fail before export" 1 0 AGE_RECIPIENT=AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ
backup_case "wrangler export failure -> fail, plaintext removed, no ciphertext" 1 1 FAKE_EXPORT_FAIL=1
if compgen -G "$scratch/out/*" >/dev/null; then no "failed export left files in the upload dir"; else ok "failed export left nothing in the upload dir"; fi
backup_case "valid recipient -> encrypted, plaintext removed" 0 1
produced=$(find "$scratch/out" -type f)
cipher=$(sed -n 's/^file=//p' "$scratch/bk_out" | tail -n 1)
if [[ "$produced" == "$cipher" && "$cipher" == *.sql.age ]]; then ok "exactly one upload candidate: $(basename "$cipher")"; else no "upload dir holds: ${produced:-none}"; fi
if [[ "$(head -c 21 "$cipher")" == age-encryption.org/v1 ]] && ! grep -Fq 'CREATE TABLE' "$cipher" && ! grep -Fq 'fp-synthetic' "$cipher"; then ok "artifact is age ciphertext with no plaintext SQL"; else no "artifact is not clean ciphertext"; fi
if grep -Fq "AGE-SECRET-KEY" "$scratch/bk.log" "$cipher"; then no "secret key material in log/artifact"; else ok "no secret key material in log or artifact"; fi
( umask 077; "$AGE" -d -i "$keydir/identity.txt" -o "$scratch/decrypted.sql" "$cipher" )
if cmp -s "$scratch/decrypted.sql" "$scratch/synthetic-export.sql"; then ok "decrypt with the (ephemeral) private identity round-trips byte-for-byte"; else no "decrypted SQL differs"; fi
"$AGE_KEYGEN" -o "$scratch/other-identity.txt" 2>/dev/null
if "$AGE" -d -i "$scratch/other-identity.txt" -o /dev/null "$cipher" 2>/dev/null; then no "a different key decrypted the backup"; else ok "a different identity cannot decrypt"; fi
rm -f "$scratch/other-identity.txt"

echo "== restore verification (B7): import into temp SQLite, then integrity_check, then tables"
expect "verify-sql-backup.sh on the decrypted synthetic export" 0 bash .github/scripts/verify-sql-backup.sh "$scratch/decrypted.sql"
if sqlite3 "$scratch/decrypted.sql" 'PRAGMA integrity_check;' >/dev/null 2>&1; then no "sqlite3 accepted a SQL text dump as a DB"; else ok "old runbook command (sqlite3 dump.sql PRAGMA) indeed fails: 'file is not a database'"; fi
head -c 2000 "$scratch/decrypted.sql" >"$scratch/truncated.sql"
expect "truncated export -> verify fails" 1 bash .github/scripts/verify-sql-backup.sh "$scratch/truncated.sql"
printf 'CREATE TABLE other (x);\n' >"$scratch/wrong.sql"
expect "export without the app tables -> verify fails" 1 bash .github/scripts/verify-sql-backup.sh "$scratch/wrong.sql"
rm -f "$scratch/decrypted.sql"

# ---------------------------------------------------------------------------------------------
echo "== .NET gates: exact spec paths, honest NOT RUN only while absent"
ag="$scratch/agent-root"
mkdir -p "$ag/agent" "$scratch/dbin"
cat >"$scratch/dbin/dotnet" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --list-runtimes) printf '%s\n' "${FAKE_RUNTIMES:-Microsoft.NETCore.App 9.0.14 [/x]}" ;;
  --version) echo 9.0.100 ;;
  *) printf '%s ' "$PWD" "$@" >>"$FAKE_DIR/dotnet.calls"; echo >>"$FAKE_DIR/dotnet.calls" ;;
esac
EOF
chmod +x "$scratch/dbin/dotnet"
dn() { env AGENT_GATES_ROOT="$ag" DOTNET_BIN="$scratch/dbin/dotnet" FAKE_DIR="$scratch" "$@"; }
expect "runtime gate without Microsoft.NETCore.App 8.x -> fail" 1 dn bash .github/scripts/agent-gates.sh runtime
expect "runtime gate with 8.x installed -> ok" 0 dn FAKE_RUNTIMES=$'Microsoft.NETCore.App 8.0.20 [/x]\nMicrosoft.NETCore.App 9.0.9 [/x]' bash .github/scripts/agent-gates.sh runtime
expect "core tests while absent -> NOT RUN (exit 0, no pass claim)" 0 dn bash .github/scripts/agent-gates.sh core-tests
if grep -q 'NOT RUN' "$scratch/last.log" && ! grep -qi 'passed' "$scratch/last.log"; then ok "absent project reported as NOT RUN"; else no "absent-project message"; fi
mkdir -p "$ag/agent/tests/Uma.Agent.Core.Tests" "$ag/agent/tests/Other.Tests"
touch "$ag/agent/tests/Other.Tests/Other.Tests.csproj"
expect "Core test dir present without its csproj -> fail (no arbitrary project)" 1 dn bash .github/scripts/agent-gates.sh core-tests
touch "$ag/agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj"
rm -f "$scratch/dotnet.calls"
expect "Core tests present -> dotnet test on the exact spec project" 0 dn bash .github/scripts/agent-gates.sh core-tests
if grep -q "/agent test tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj --configuration Release" "$scratch/dotnet.calls"; then ok "invoked: dotnet test tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj (cwd agent/, global.json applies)"; else no "unexpected dotnet call: $(cat "$scratch/dotnet.calls")"; fi
expect "Windows build while absent -> NOT RUN" 0 dn bash .github/scripts/agent-gates.sh windows-build
mkdir -p "$ag/agent/src/Uma.Agent.Windows"
expect "Windows dir present without csproj -> fail" 1 dn bash .github/scripts/agent-gates.sh windows-build
touch "$ag/agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj"
rm -f "$scratch/dotnet.calls"
expect "Windows project present -> dotnet build with EnableWindowsTargeting" 0 dn bash .github/scripts/agent-gates.sh windows-build
if grep -q "build src/Uma.Agent.Windows/Uma.Agent.Windows.csproj --configuration Release -p:EnableWindowsTargeting=true" "$scratch/dotnet.calls"; then ok "invoked: dotnet build src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -p:EnableWindowsTargeting=true"; else no "unexpected dotnet call: $(cat "$scratch/dotnet.calls")"; fi

# ---------------------------------------------------------------------------------------------
echo "== production verification: exact status + body, redirects never count as success"
port_file="$scratch/port"
python3 .github/tests/mock_access.py "$port_file" >"$scratch/mock.log" 2>&1 &
mock_pid=$!
for _ in $(seq 50); do [[ -s "$port_file" ]] && break; sleep 0.1; done
base="http://127.0.0.1:$(cat "$port_file")"
vp() { env CF_ACCESS_CLIENT_ID=synthetic-id.access CF_ACCESS_CLIENT_SECRET=synthetic-secret "$@"; }
expect "healthy Access + Worker -> all checks pass" 0 vp bash .github/scripts/verify-production.sh "$base/good" global-20260930
expect "service token rejected (every request 302 to login) -> fail" 1 vp bash .github/scripts/verify-production.sh "$base/redirect-all" global-20260930
if grep -q 'FAIL service-token /api/v1/health -> 302' "$scratch/last.log"; then ok "302 login redirect reported as FAIL, not success"; else no "302 not flagged"; fi
expect "hostname not behind Access (anonymous 200) -> fail" 1 vp bash .github/scripts/verify-production.sh "$base/open" global-20260930
expect "ACCESS_AUD mismatch (Worker 401 on /api/v1/roster) -> fail" 1 vp bash .github/scripts/verify-production.sh "$base/bad-aud" global-20260930
expect "wrong MASTER_VERSION deployed -> fail" 1 vp bash .github/scripts/verify-production.sh "$base/good" global-19990101
expect "missing token env -> refuses to run" 1 env -u CF_ACCESS_CLIENT_ID bash .github/scripts/verify-production.sh "$base/good" global-20260930
kill "$mock_pid" 2>/dev/null || true
wait "$mock_pid" 2>/dev/null || true

echo
echo "regression checks: $passes passed, $fails failed"
[[ "$fails" == 0 ]]
