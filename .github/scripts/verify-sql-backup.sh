#!/usr/bin/env bash
# Validates ONE decrypted D1 SQL export (T12 review B7): imports it into a throw-away SQLite
# database, then runs PRAGMA integrity_check and lists tables as separate commands.
#
#   verify-sql-backup.sh <backup.sql>
#
# The temporary database lives in a mode-0700 directory removed on every exit path.
set -euo pipefail
umask 077

sql="${1:?usage: verify-sql-backup.sh <backup.sql>}"
[[ -f "$sql" && -s "$sql" ]] || { echo "verify: $sql is missing or empty" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "verify: sqlite3 is required" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
db="$work/restore-check.db"

sqlite3 -bail "$db" <"$sql" || { echo "verify: import failed" >&2; exit 1; }

integrity=$(sqlite3 "$db" 'PRAGMA integrity_check;')
echo "integrity_check: $integrity"
[[ "$integrity" == ok ]] || { echo "verify: integrity check failed" >&2; exit 1; }

tables=$(sqlite3 "$db" "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;")
echo "tables: $(echo "$tables" | tr '\n' ' ')"
for t in veterans review_items owned_cards; do
  grep -qx "$t" <<<"$tables" || { echo "verify: expected table $t is missing" >&2; exit 1; }
done
echo "veterans rows: $(sqlite3 "$db" 'SELECT count(*) FROM veterans;')"
echo "verify: ok"
