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
import { CROP_KEY_RE } from './crops.ts';
import { nowIso, parseBody, type AppEnv } from '../http.ts';
import {
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

  const fp = await fingerprint(veteran);
  if (fp !== capture.fingerprint) {
    throw validationError(
      [{ path: '/fingerprint', message: 'fingerprint does not match the veteran payload (01 §5)' }],
      'Fingerprint mismatch',
    );
  }

  const extra: { path: string; message: string }[] = [];
  const seenSkills = new Set<string>();
  veteran.skills.forEach((s, i) => {
    if (seenSkills.has(s.skillId)) {
      extra.push({ path: `/veteran/skills/${i}/skillId`, message: 'the same skill appears twice' });
    }
    seenSkills.add(s.skillId);
  });
  const seenPaths = new Set<string>();
  capture.fields.forEach((f, i) => {
    if (seenPaths.has(f.path)) {
      extra.push({ path: `/fields/${i}/path`, message: 'the same field path appears twice' });
    }
    seenPaths.add(f.path);
    if (f.cropKey !== null && !CROP_KEY_RE.test(f.cropKey)) {
      extra.push({
        path: `/fields/${i}/cropKey`,
        message: 'cropKey is not a crops/<ULID>/<path>.png key',
      });
    }
  });
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
  const existing = await db
    .prepare('SELECT id FROM veterans WHERE fingerprint = ?')
    .bind(capture.fingerprint)
    .first<{ id: string }>();
  const created = existing === null;
  const id = existing?.id ?? c.var.deps.newId(c.var.deps.now().getTime());

  const openByPath = new Map<string, string>();
  if (!created) {
    const open = await db
      .prepare(`SELECT id, path FROM review_items WHERE veteran_id = ? AND status = 'open'`)
      .bind(id)
      .all<{ id: string; path: string }>();
    for (const r of open.results) openByPath.set(r.path, r.id);
  }
  const reviewItemIds: string[] = [];
  const newReviews: { i: string; p: string; t: string }[] = [];
  for (const f of capture.fields) {
    if (f.status !== 'low_confidence') continue;
    let rid = openByPath.get(f.path);
    if (!rid) {
      rid = c.var.deps.newId(c.var.deps.now().getTime());
      newReviews.push({ i: rid, p: f.path, t: now });
    }
    reviewItemIds.push(rid);
  }

  const minConfidence = capture.fields.reduce((m, f) => Math.min(m, f.confidence), 1);
  const trainMode = deriveTrainMode(veteran.epithet); // 01 §6; the server derives it, whatever the payload says
  const stmts = [
    ...writeVeteranStatements(
      db,
      { ...veteran, trainMode },
      {
        id,
        fingerprint: capture.fingerprint,
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
    db.prepare('DELETE FROM capture_fields WHERE veteran_id = ?').bind(id),
    ...insertFieldsStatement(db, id, capture.fields),
  ];
  if (newReviews.length > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO review_items (id, veteran_id, path, status, created_at)
           SELECT json_extract(value, '$.i'), ?1, json_extract(value, '$.p'), 'open',
                  json_extract(value, '$.t') FROM json_each(?2) ORDER BY key`,
        )
        .bind(id, JSON.stringify(newReviews)),
    );
  }
  const pair: [string, string] = [veteran.characterId, veteran.outfitId];
  stmts.push(matchParentsStatement(db, id, [pair]));
  await db.batch(stmts);

  const body: IngestResponse = { veteranId: id, created };
  if (reviewItemIds.length > 0) body.reviewItemIds = reviewItemIds;
  return c.json(body, created ? 201 : 200);
});

const etagOf = async (maxUpdated: string | null, count: number) =>
  `"${(await sha256Hex(`${maxUpdated ?? ''}|${count}`)).slice(0, 32)}"`;

const matchesEtag = (header: string | undefined, etag: string): boolean =>
  header !== undefined &&
  header.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });

veterans.get('/roster', async (c) => {
  const { maxUpdated, count } = await rosterStamp(c.env.DB);
  const etag = await etagOf(maxUpdated, count);
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
    matchParentsStatement(db, id, [[row.character_id, row.outfit_id]]),
  ]);
  const keys = crops.results.map((r) => r.crop_key);
  if (keys.length > 0) await c.env.CROPS.delete(keys);
  return c.body(null, 204);
});
