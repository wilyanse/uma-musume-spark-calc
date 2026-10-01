#!/usr/bin/env bash
# Weekly D1 backup: export -> validate -> encrypt with age -> expose ONLY the ciphertext
# (T12 review B4). Fails closed before any export when the recipient is missing or invalid.
#
#   backup-d1.sh <out-dir>
#
# Environment:
#   AGE_BIN              explicit path to the pinned age binary (installed by install-tool.sh)
#   AGE_RECIPIENT        the PUBLIC age recipient (GitHub variable BACKUP_AGE_RECIPIENT)
#   API_DIR              directory holding wrangler.jsonc (default apps/api)
#   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are consumed by wrangler only.
#   GITHUB_OUTPUT        receives file=<ciphertext path>
#
# Plaintext SQL only ever lives in a mode-0700 temp directory that is removed on every exit path.
set -euo pipefail
umask 077

out_dir="${1:?usage: backup-d1.sh <out-dir>}"
age_bin="${AGE_BIN:?AGE_BIN must point at the pinned age binary}"
api_dir="${API_DIR:-apps/api}"

fail() {
  echo "::error::backup: $*"
  exit 1
}

# 1. Fail closed on the recipient before touching Cloudflare.
recipient="${AGE_RECIPIENT:-}"
[[ -n "$recipient" ]] || fail "variable BACKUP_AGE_RECIPIENT is not set; refusing to export (docs/runbooks/backup.md §1)"
[[ "$recipient" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || fail "BACKUP_AGE_RECIPIENT is not an age X25519 public recipient (age1...); refusing to export"
[[ -x "$age_bin" ]] || fail "AGE_BIN ($age_bin) is not executable"
# age itself must accept the recipient (checksum is validated by the bech32 decoder).
printf 'probe' | "$age_bin" -r "$recipient" -o /dev/null 2>/dev/null || fail "age rejected BACKUP_AGE_RECIPIENT; refusing to export"

work=$(mktemp -d)
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

stamp=$(date -u +%Y%m%dT%H%M%SZ)
plain="$work/d1-backup-$stamp.sql"
mkdir -p "$out_dir"
cipher="$out_dir/d1-backup-$stamp.sql.age"

# 2. Export into the private temp directory.
(cd "$api_dir" && pnpm exec wrangler d1 export uma-spark-calc --remote --env production --output="$plain") ||
  fail "wrangler d1 export failed"

# 3. Minimal sanity checks on the plaintext before encrypting it.
[[ -s "$plain" ]] || fail "export is empty"
grep -Eiq 'CREATE TABLE (IF NOT EXISTS )?[`"]?veterans' "$plain" || fail "export has no veterans table; not a full schema dump"

# 4. Encrypt, then prove the file is age ciphertext (not the plaintext) before exposing it.
"$age_bin" -r "$recipient" -o "$cipher" "$plain" || { rm -f "$cipher"; fail "age encryption failed"; }
header=$(head -c 21 "$cipher")
[[ "$header" == 'age-encryption.org/v1' ]] || { rm -f "$cipher"; fail "output is not age ciphertext"; }
if grep -Fq 'CREATE TABLE' "$cipher"; then rm -f "$cipher"; fail "ciphertext contains plaintext SQL"; fi

bytes=$(wc -c <"$cipher" | tr -d ' ')
echo "encrypted backup: $(basename "$cipher") ($bytes bytes)"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "file=$cipher" >>"$GITHUB_OUTPUT"
fi
