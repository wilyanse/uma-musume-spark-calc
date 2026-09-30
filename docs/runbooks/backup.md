# D1 backup and restore

Two independent recovery paths exist:

- **Weekly encrypted SQL export** (this runbook, §1–§4): runs every week and is kept for 90 days as an age-encrypted GitHub Actions artifact.
- **D1 Time Travel** (§6): always on, point-in-time recovery for the last **7 days** on the Free plan.

Cloudflare documents that an export can block other database requests while it runs, so exports are scheduled for a quiet window (Sunday 03:17 UTC).

The repository's visibility stays as it is. Because artifacts on a public repository can be downloaded by any signed-in GitHub user, the workflow **encrypts the export before upload**:

- It uses [age](https://age-encryption.org) with a public-key **recipient**.
- GitHub stores only the public recipient, in the repository variable `BACKUP_AGE_RECIPIENT`.
- The private key never touches GitHub, CI or this repository.
- Without the private key, nobody (including GitHub, Cloudflare, and anyone who downloads the artifact) can read the backup.

## 1. One-time setup (H2)

### 1a. Generate the backup key on a trusted machine (H2 only)

Install age v1.3.2 from its official release, or from your OS package manager. `.github/scripts/install-tool.sh age <dir>` downloads the same pinned, SHA-256-verified binary that CI uses.

```sh
umask 077
mkdir -p ~/.uma-backup-key && chmod 700 ~/.uma-backup-key
age-keygen -o ~/.uma-backup-key/uma-d1-backup.agekey    # prints only "Public key: age1..."
age-keygen -y ~/.uma-backup-key/uma-d1-backup.agekey    # re-derives the public recipient
```

Store the identity file (it contains `AGE-SECRET-KEY-1...`) **off GitHub**, in user-managed secure storage:

- **Primary:** a password manager secure note or attachment (1Password, Bitwarden, etc.).
- **Second copy:** an offline one (an encrypted USB drive, or a printed copy in a safe).

Then delete the working copy with `rm ~/.uma-backup-key/uma-d1-backup.agekey`, or keep it only in an encrypted home directory.

Never paste the private key into chat, an issue, a GitHub secret or variable, CI logs, or this repository. The workflow has no way to use it, by design.

### 1b. GitHub configuration (H2)

1. Go to **Settings > Secrets and variables > Actions > Variables > New repository variable** and add `BACKUP_AGE_RECIPIENT` = the `age1...` public key. It is public by nature.
2. Go to **Settings > Environments > New environment** and create `backup`:
   - **Deployment branches: Selected branches**, then add `main`.
   - Environment secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

   Prefer a **separate backup token**, created in **Account API tokens > Custom**, that grants only **Account › D1 › Edit** for this account. The export is a `POST …/d1/database/{id}/export` API call, so a D1 Read token is not expected to be enough; this was not tested in this task. The first manual run confirms it. The token needs no Workers or R2 rights.

3. Go to **Settings > Actions > General > Artifact and log retention** and confirm the maximum is at least 90 days. A lower repository maximum silently shortens `retention-days: 90`.

### Fail-closed behaviour

`.github/scripts/backup-d1.sh` stops **before any export or upload** if the recipient is missing, is not an `age1…` X25519 recipient, has a bad checksum, or is a pasted private key (the regression tests in `.github/tests/run.sh` cover this).

## 2. What the scheduled workflow does

`.github/workflows/backup.yml` runs Sunday 03:17 UTC, and on **Actions > Weekly D1 backup > Run workflow** from `main`. Non-main dispatches are skipped. Its steps:

1. Install age v1.3.2 via `install-tool.sh`, which verifies the SHA-256 before extracting.
2. `backup-d1.sh` validates `BACKUP_AGE_RECIPIENT` (fail closed).
3. It runs `wrangler d1 export uma-spark-calc --remote --env production --output=<private temp dir>/d1-backup-<UTC>.sql` inside a `mktemp -d` directory under `umask 077`.
4. It checks that the export is non-empty and contains `CREATE TABLE veterans`.
5. It encrypts with `age -r "$BACKUP_AGE_RECIPIENT"` to `d1-backup-<UTC>.sql.age`. It checks the `age-encryption.org/v1` header and that no `CREATE TABLE` text leaks into the ciphertext.
6. An `EXIT` trap removes the plaintext temp directory on success **and** on failure.
7. The workflow uploads **exactly that one `.sql.age` file** as artifact `d1-backup-<run id>`, with a 90-day retention. No plaintext, keys or directories are uploaded.

Verify a run: open **Actions > Weekly D1 backup**, then the latest run. It must be green, and the artifact must list one file ending in `.sql.age`.

## 3. Download, decrypt and verify a backup (H2)

Needs `gh` (or the Actions web UI), `age` and `sqlite3`. Work in a private temp directory, and use one explicit file name throughout (no globs):

```sh
umask 077
work=$(mktemp -d)
gh run list --workflow backup.yml --branch main --status success --limit 5    # pick a run id
printf 'Run ID: '; IFS= read -r run_id
[[ "$run_id" =~ ^[0-9]+$ ]] || { echo 'Invalid run ID' >&2; exit 1; }
gh run download "$run_id" --name "d1-backup-$run_id" --dir "$work"
# Enter the exact UTC timestamp in the artifact filename (no glob).
printf 'Artifact UTC timestamp (YYYYMMDDTHHMMSSZ): '; IFS= read -r stamp
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo 'Invalid timestamp' >&2; exit 1; }
cipher="$work/d1-backup-$stamp.sql.age"
test -f "$cipher" && test -s "$cipher" || { echo 'Backup ciphertext missing or empty' >&2; exit 1; }
backup_sql="${cipher%.age}"

# Decrypt with the private identity, fetched from your password manager at use time. For example,
# with the 1Password CLI:
#   op read 'op://Private/uma-d1-backup-key/uma-d1-backup.agekey' | age -d -i - -o "$backup_sql" "$cipher"
# or with a local identity file on an encrypted disk:
age -d -i ~/.uma-backup-key/uma-d1-backup.agekey -o "$backup_sql" "$cipher"

# Validate: import into a throw-away SQLite DB, then integrity_check and table list SEPARATELY.
bash .github/scripts/verify-sql-backup.sh "$backup_sql"
```

`verify-sql-backup.sh` runs the equivalent of these commands, and fails on any step:

```sh
db="$work/restore-check.db"
sqlite3 -bail "$db" < "$backup_sql"            # a SQL text dump is NOT a database file; import it first
sqlite3 "$db" 'PRAGMA integrity_check;'        # must print exactly: ok
sqlite3 "$db" "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"   # must include veterans, review_items, owned_cards
sqlite3 "$db" 'SELECT count(*) FROM veterans;'
```

Expected tail: `integrity_check: ok`, then the table list, then `verify: ok`. Remove the plaintext when finished with `rm -rf "$work"`. The decrypted SQL contains guest trainer names: never commit it, attach it to an issue or share it.

## 4. Restore (H2, approved incident only)

Always test on a disposable database first. Never restore over `uma-spark-calc` without an approved incident or change record and a fresh backup of the current state.

1. Validate locally (§3).
2. Load into a **new disposable D1 database** and inspect it:

```sh
cd apps/api
pnpm exec wrangler d1 create uma-spark-calc-restore-check
pnpm exec wrangler d1 execute uma-spark-calc-restore-check --remote --file="$backup_sql"
pnpm exec wrangler d1 execute uma-spark-calc-restore-check --remote \
  --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
pnpm exec wrangler d1 execute uma-spark-calc-restore-check --remote --command "SELECT count(*) AS veterans FROM veterans;"
pnpm exec wrangler d1 delete uma-spark-calc-restore-check     # after inspection
```

3. For production, the lowest-risk path is usually Time Travel (§6) if the incident is less than 7 days old. Otherwise, with approval:
   1. Take a fresh export of the current state.
   2. Create a new D1 database.
   3. Import the backup into it.
   4. Point `database_id` in `wrangler.jsonc` at the new database through a reviewed PR.
   5. Let the deploy workflow roll it out.

   Importing over the existing database would conflict with existing tables. `d1 export` output contains `CREATE TABLE` statements, not `DROP`.

## 5. Recovery limits and key management

- **Losing the private key means every backup encrypted to it is unrecoverable.** Keep two independent copies (§1a). Nobody can recover it for you.
- **Key rotation:**
  1. Generate a new key (§1a) and replace `BACKUP_AGE_RECIPIENT`.
  2. **Keep the old identity until the last artifact encrypted to it has expired**, which is 90 days after the change.
- If the private key is suspected compromised, rotate immediately. Remember that already-downloaded ciphertext stays readable to whoever holds the old key. Artifacts can be deleted early in **Actions > run > Artifacts**.
- **Coverage:** weekly exports mean up to 7 days of data loss from the export path alone. Time Travel covers the last 7 days, so together they give continuous coverage only while both are healthy.
- Artifacts expire after 90 days, or the repository maximum if lower. A backup older than that must be downloaded and stored by H2.
- An export is a logical SQL dump. R2 crop images are **not** included. They are re-capturable screenshot crops (≤ 60 KB each), and no R2 backup is in scope (65 §5).
- The first real run, and its artifact and decrypt, are **not verified** in this task. Only the local synthetic tests have run (see the T12 changelog). H2 must do §3 once after the first scheduled or manual run.

## 6. Point-in-time recovery with Time Travel (H2)

Use Time Travel for a recent accidental write or migration (within 7 days on Free):

```sh
cd apps/api
pnpm exec wrangler d1 info uma-spark-calc
pnpm exec wrangler d1 time-travel info uma-spark-calc --timestamp='2026-09-30T02:00:00Z'
```

Record the returned bookmark. Restoring overwrites the database and cancels in-flight queries. Have a second human confirm the bookmark, database, account and incident approval, then run:

```sh
pnpm exec wrangler d1 time-travel restore uma-spark-calc --bookmark='<confirmed-bookmark>'
pnpm exec wrangler d1 migrations list uma-spark-calc --remote --env production
```

Then run `.github/scripts/verify-production.sh` (cloudflare-setup.md §6) before reopening writes. Reconcile writes made after the restore point from the latest encrypted export or operator records.

Sources checked 2026-09-30:

- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
- https://github.com/FiloSottile/age (v1.3.2 release; asset digests pinned in `.github/scripts/install-tool.sh`)
