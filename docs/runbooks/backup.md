# D1 backup and restore

D1 Time Travel is always on and provides point-in-time recovery within the plan's retention window (Free currently 7 days; Paid currently 30 days). It is not a substitute for the independent weekly SQL artifact below. Cloudflare documents that exports can block other database requests, so run this during a quiet window.

## Scheduled backup

`.github/workflows/backup.yml` runs every Sunday at 03:17 UTC and can also be started with **Actions > Weekly D1 backup > Run workflow**. It executes:

```sh
cd apps/api
pnpm exec wrangler d1 export uma-spark-calc --remote --output=backup.sql
```

The workflow uploads `apps/api/backup.sql` as a GitHub Actions artifact with `retention-days: 90`. GitHub artifacts are downloadable by signed-in users with repository read access; the repository owner should confirm the repository's artifact-retention policy allows 90 days.

Verify a run in GitHub: **Actions > Weekly D1 backup**, open the successful run, confirm the artifact exists, download it, and inspect without sharing it:

```sh
sqlite3 backup.sql '.tables'
head -n 5 backup.sql
```

The SQL contains guest trainer names and must be treated as private data. Do not commit the file, attach it to an issue, or put it in a public release.

## Manual backup

With Cloudflare credentials available through the normal Wrangler login or environment variables:

```sh
cd apps/api
pnpm exec wrangler d1 info uma-spark-calc
pnpm exec wrangler d1 export uma-spark-calc --remote --output=backup-$(date -u +%Y%m%dT%H%M%SZ).sql
sqlite3 backup-*.sql 'PRAGMA integrity_check;'
```

Verify the output is non-empty and has the expected schema:

```sh
test -s backup-*.sql
grep -E 'CREATE TABLE.*(veterans|review_items|owned_cards)' backup-*.sql
```

Delete local copies securely according to the machine's policy after confirming the artifact or encrypted archive is stored.

## Restore into a disposable local database

Never test a restore over production first. The SQL export can be loaded into a local SQLite database for inspection:

```sh
sqlite3 /tmp/uma-spark-calc-restore.db < backup.sql
sqlite3 /tmp/uma-spark-calc-restore.db 'PRAGMA integrity_check;'
sqlite3 /tmp/uma-spark-calc-restore.db '.tables'
```

For a Cloudflare preview or newly created disposable D1 database, create the database first, then execute the SQL. Verify the database name and account before using `--remote`:

```sh
pnpm exec wrangler d1 create uma-spark-calc-restore-check
pnpm exec wrangler d1 execute uma-spark-calc-restore-check --remote --file=backup.sql
pnpm exec wrangler d1 execute uma-spark-calc-restore-check --remote \
  --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
```

Delete that disposable database after inspection. Do not run a restore against `uma-spark-calc` without an approved incident/change record and a fresh backup.

## Point-in-time recovery with Time Travel

Use Time Travel for a recent accidental write or migration, not as a routine export:

```sh
cd apps/api
pnpm exec wrangler d1 info uma-spark-calc
pnpm exec wrangler d1 time-travel info uma-spark-calc --timestamp='2026-09-30T02:00:00Z'
```

Record the returned bookmark. Restoration overwrites the database and cancels in-flight queries. Confirm the bookmark, database, account, and incident approval with a second human, then run:

```sh
pnpm exec wrangler d1 time-travel restore uma-spark-calc --bookmark='<confirmed-bookmark>'
pnpm exec wrangler d1 migrations list uma-spark-calc --remote
```

Verify application health and a representative read through the Access-protected hostname before reopening writes. Reconcile any writes made after the restore point from the SQL artifact or operator records.

## Limitations and ownership

- Weekly artifacts are retained for 90 days, but GitHub repository policy may impose a shorter maximum; verify it in **Settings > Actions > General**.
- Free-plan D1 Time Travel is currently seven days, so the weekly export is needed for longer recovery coverage.
- A D1 export is a logical SQL dump, not an encrypted backup service. Restrict GitHub repository access and artifact access.
- The task does not provision Cloudflare resources or credentials. H2 must create the database, GitHub secrets, and retention policy before the scheduled job can succeed.

Sources checked 2026-09-30:

- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts
