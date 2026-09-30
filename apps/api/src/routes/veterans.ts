import { Hono } from 'hono';
import {
  VeteranCapture,
  VeteranPatch,
  checkMasterIds,
  fingerprint,
  sha256Hex,
  type IngestResponse,
} from '@uma/schema';
import { ApiError, validationError } from '../problem.ts';
import { captureFieldChecks, extraVeteranChecks } from '../checks.ts';
import { nowIso, parseBody, type AppEnv } from '../http.ts';
import {
  ID_BY_FINGERPRINT,
  type UpsertResult,
  deriveTrainMode,
  insertFieldsStatement,
  loadRoster,
  loadVeteranDetail,
  matchParentsStatement,
  rosterStamp,
  writeVeteranStatements,
} from '../db/veterans.ts';

const withoutMasterVersion = <T extends { masterVersion: string }>(
  d: T,
): Omit<T, 'masterVersion'> => {
  const { masterVersion, ...rest } = d;
  void masterVersion;
  return rest;
};

export const veterans = new Hono<AppEnv>();

// 40 §4 ingest. Statement budget (≤ 15): 1 lookup + 1 open-review lookup + batch of
// upsert, 4 deletes, ≤ 4 child inserts, fields delete + insert, review insert, parent match = ≤ 15.
veterans.post('/veterans', async (c) => {
  const capture = await parseBody(c, VeteranCapture);
  const { veteran } = capture;
  const db = c.env.DB;

  const computed = await fingerprint(veteran);
  if (computed !== capture.fingerprint) {
    throw validationError(
      [{ path: '/fingerprint', message: 'fingerprint does not match the veteran payload (01 §5)' }],
      'Fingerprint mismatch',
    );
  }

  const extra = [
    ...extraVeteranChecks(veteran, '/veteran'),
    ...captureFieldChecks(capture.fields, veteran),
  ];
  if (extra.length > 0) throw validationError(extra);

  const master = await c.var.deps.master(capture.masterVersion, c.env);
  if (!master) {
    throw validationError(
      [
        {
          path: '/masterVersion',
          message: `unknown master data version "${capture.masterVersion}"`,
        },
      ],
      'Unknown master data version',
    );
  }
  const unknown = checkMasterIds(veteran, master);
  if (unknown.length > 0) {
    throw validationError(
      unknown.map((u) => ({
        path: `/veteran${u.path}`,
        kind: u.kind,
        id: u.id,
        message: `unknown ${u.kind} ID "${u.id}" in master data ${capture.masterVersion}`,
      })),
      'Unknown master-data IDs',
    );
  }

  const now = nowIso(c);
  const lowPaths = capture.fields.filter((f) => f.status === 'low_confidence').map((f) => f.path);
  const newReviews = lowPaths.map((p) => ({
    i: c.var.deps.newId(c.var.deps.now().getTime()),
    p,
    t: now,
  }));

  const minConfidence = capture.fields.reduce((m, f) => Math.min(m, f.confidence), 1);
  const trainMode = deriveTrainMode(veteran.epithet); // 01 §6; the server derives it, whatever the payload says
  // Everything below is bound to the veteran row that actually exists after the upsert, found by
  // fingerprint inside the same D1 transaction: two identical POSTs racing each other end with one
  // veteran, one set of child rows and one set of review items (T04 review B1).
  const fp = capture.fingerprint; // === the verified fingerprint above
  const stmts = [
    ...writeVeteranStatements(
      db,
      { ...veteran, trainMode },
      {
        id: c.var.deps.newId(c.var.deps.now().getTime()),
        fingerprint: fp,
        masterVersion: capture.masterVersion,
        captureId: capture.captureId,
        capturedAt: capture.capturedAt,
        minConfidence,
        trainMode,
        modeSource: 'epithet',
        now,
      },
      'fingerprint',
    ),
    db.prepare(`DELETE FROM capture_fields WHERE veteran_id = ${ID_BY_FINGERPRINT}`).bind(fp),
    ...insertFieldsStatement(db, fp, capture.fields),
    // Open items whose field is no longer low-confidence in this capture are closed (S3a/b).
    db
      .prepare(
        `UPDATE review_items SET status = 'dismissed', resolved_at = ?3
         WHERE veteran_id = ${ID_BY_FINGERPRINT} AND status = 'open'
           AND path NOT IN (SELECT value FROM json_each(?2))`,
      )
      .bind(fp, JSON.stringify(lowPaths), now),
  ];
  if (newReviews.length > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO review_items (id, veteran_id, path, status, created_at)
           SELECT json_extract(value, '$.i'), ${ID_BY_FINGERPRINT}, json_extract(value, '$.p'), 'open',
                  json_extract(value, '$.t') FROM json_each(?2)
           WHERE NOT EXISTS (SELECT 1 FROM review_items o
                             WHERE o.veteran_id = ${ID_BY_FINGERPRINT}
                               AND o.path = json_extract(value, '$.p') AND o.status = 'open')
           ORDER BY key`,
        )
        .bind(fp, JSON.stringify(newReviews)),
    );
  }
  const pair: [string, string] = [veteran.characterId, veteran.outfitId];
  stmts.push(matchParentsStatement(db, { fingerprint: fp }, [pair]));
  if (newReviews.length > 0) {
    stmts.push(
      db
        .prepare(
          `SELECT id, path FROM review_items WHERE veteran_id = ${ID_BY_FINGERPRINT} AND status = 'open' ORDER BY rowid`,
        )
        .bind(fp),
    );
  }
  const results = await db.batch(stmts);

  const upserted = (results[0] as D1Result<UpsertResult>).results[0];
  if (!upserted) throw new Error('ingest upsert returned no row');
  const created = upserted.created === 1;
  const body: IngestResponse = { veteranId: upserted.id, created };
  if (newReviews.length > 0) {
    const open = (results[results.length - 1] as D1Result<{ id: string; path: string }>).results;
    const byPath = new Map(open.map((r) => [r.path, r.id]));
    body.reviewItemIds = lowPaths.map((p) => byPath.get(p)!);
  }
  return c.json(body, created ? 201 : 200);
});

// 40 §4: hash of max(updated_at) + count, plus the monotonic roster revision (migration 0002),
// which moves under every write, including ones that leave max(updated_at) unchanged (S1).
const etagOf = async (s: { revision: number; maxUpdated: string | null; count: number }) =>
  `"${(await sha256Hex(`${s.maxUpdated ?? ''}|${s.count}|${s.revision}`)).slice(0, 32)}"`;

const matchesEtag = (header: string | undefined, etag: string): boolean =>
  header !== undefined &&
  header.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });

veterans.get('/roster', async (c) => {
  const etag = await etagOf(await rosterStamp(c.env.DB));
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (matchesEtag(c.req.header('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return c.json(await loadRoster(c.env.DB), 200, headers);
});

veterans.get('/veterans/:id', async (c) => {
  const detail = await loadVeteranDetail(c.env.DB, c.req.param('id'));
  if (!detail) throw new ApiError(404, 'Not Found', 'No such veteran');
  return c.json(withoutMasterVersion(detail));
});

veterans.patch('/veterans/:id', async (c) => {
  const patch = await parseBody(c, VeteranPatch);
  const id = c.req.param('id');
  if (patch.trainMode !== undefined) {
    const res = await c.env.DB.prepare(
      `UPDATE veterans SET train_mode = ?, mode_source = 'override', updated_at = ? WHERE id = ?`,
    )
      .bind(patch.trainMode, nowIso(c), id)
      .run();
    if (res.meta.changes === 0) throw new ApiError(404, 'Not Found', 'No such veteran');
  }
  const detail = await loadVeteranDetail(c.env.DB, id);
  if (!detail) throw new ApiError(404, 'Not Found', 'No such veteran');
  return c.json(withoutMasterVersion(detail));
});

veterans.delete('/veterans/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const row = await db
    .prepare('SELECT character_id, outfit_id FROM veterans WHERE id = ?')
    .bind(id)
    .first<{ character_id: string; outfit_id: string }>();
  if (!row) throw new ApiError(404, 'Not Found', 'No such veteran');
  const crops = await db
    .prepare('SELECT crop_key FROM capture_fields WHERE veteran_id = ? AND crop_key IS NOT NULL')
    .bind(id)
    .all<{ crop_key: string }>();
  await db.batch([
    ...['veteran_skills', 'veteran_sparks', 'veteran_deck', 'capture_fields', 'review_items'].map(
      (t) => db.prepare(`DELETE FROM ${t} WHERE veteran_id = ?`).bind(id),
    ),
    db.prepare('DELETE FROM veteran_parents WHERE veteran_id = ?').bind(id),
    db.prepare('DELETE FROM veterans WHERE id = ?').bind(id),
    // Children that pointed at this veteran (or share its identity) are re-matched without it.
    matchParentsStatement(db, { id }, [[row.character_id, row.outfit_id]]),
  ]);
  const keys = crops.results.map((r) => r.crop_key);
  if (keys.length > 0) await c.env.CROPS.delete(keys);
  return c.body(null, 204);
});
