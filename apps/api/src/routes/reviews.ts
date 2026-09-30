import { Hono } from 'hono';
import { z } from 'zod';
import {
  ReviewStatus,
  ResolveReviewRequest,
  Veteran,
  VeteranSpark,
  checkMasterIds,
  fingerprint,
  type ReviewItem,
} from '@uma/schema';
import { ApiError, validationError, zodProblems } from '../problem.ts';
import { nowIso, parseBody, parseQuery, type AppEnv } from '../http.ts';
import {
  deriveTrainMode,
  fieldFromRow,
  loadVeteranDetail,
  matchParentsStatement,
  toVeteran,
  writeVeteranStatements,
  type FieldRow,
} from '../db/veterans.ts';

export const reviews = new Hono<AppEnv>();

interface ReviewRow extends FieldRow {
  id: string;
  review_status: 'open' | 'resolved' | 'dismissed';
  resolved_value_json: string | null;
  created_at: string;
  resolved_at: string | null;
}

const SELECT_REVIEW = `SELECT r.id, r.veteran_id, r.path, r.status AS review_status, r.resolved_value_json,
    r.created_at, r.resolved_at, f.raw_text, f.value_json, f.confidence, f.status, f.candidates_json, f.crop_key
  FROM review_items r JOIN capture_fields f ON f.veteran_id = r.veteran_id AND f.path = r.path`;

const toReviewItem = (r: ReviewRow): ReviewItem => ({
  id: r.id,
  veteranId: r.veteran_id,
  path: r.path,
  status: r.review_status,
  resolvedValue: r.resolved_value_json === null ? null : JSON.parse(r.resolved_value_json),
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  field: fieldFromRow(r),
  cropKey: r.crop_key,
});

reviews.get('/review-items', async (c) => {
  const { status } = parseQuery(c, z.object({ status: ReviewStatus.optional() }));
  const stmt =
    status === undefined
      ? c.env.DB.prepare(`${SELECT_REVIEW} ORDER BY r.created_at, r.id`)
      : c.env.DB.prepare(`${SELECT_REVIEW} WHERE r.status = ? ORDER BY r.created_at, r.id`).bind(
          status,
        );
  const { results } = await stmt.all<ReviewRow>();
  return c.json(results.map(toReviewItem));
});

const unescapePointer = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const OWNER_PSEUDO = /^\/sparks\/(parent1|parent2)$/;
const SparkWithoutOwner = VeteranSpark.omit({ owner: true });

/** Sets `value` at a JSON pointer inside `root`; the target must already exist (no creation). */
function setAtPointer(root: Record<string, unknown>, pointer: string, value: unknown): boolean {
  const segs = pointer.split('/').slice(1).map(unescapePointer);
  if (segs.length === 0 || segs.some((s) => UNSAFE.has(s))) return false;
  let node: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node) ? !/^\d+$/.test(seg) : !Object.hasOwn(node, seg)) return false;
    node = (node as Record<string, unknown>)[seg];
  }
  const last = segs[segs.length - 1]!;
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(last) || Number(last) >= node.length) return false;
  } else if (!Object.hasOwn(node, last)) return false;
  (node as Record<string, unknown>)[last] = value;
  return true;
}

// 01 §9: apply the value to the veteran, recompute the fingerprint (409 on collision), resolve.
reviews.post('/review-items/:id/resolve', async (c) => {
  const db = c.env.DB;
  const { value } = await parseBody(c, ResolveReviewRequest);
  if (value === undefined) {
    throw validationError([{ path: '/value', message: 'value is required' }]);
  }
  const item = await db
    .prepare('SELECT id, veteran_id, path, status FROM review_items WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; veteran_id: string; path: string; status: string }>();
  if (!item) throw new ApiError(404, 'Not Found', 'No such review item');
  if (item.status !== 'open') {
    throw new ApiError(409, 'Conflict', `Review item is already ${item.status}`);
  }
  const detail = await loadVeteranDetail(db, item.veteran_id);
  if (!detail)
    throw new ApiError(404, 'Not Found', 'The veteran of this review item no longer exists');

  // Apply the value to a copy of the `veteran` object.
  const draft = structuredClone(toVeteran(detail)) as unknown as Record<string, unknown>;
  const owner = OWNER_PSEUDO.exec(item.path)?.[1];
  if (owner) {
    // Pseudo-pointer "/sparks/<owner>" (CaptureField.path): the value is that owner's whole spark set.
    const parsed = z.array(SparkWithoutOwner).min(1).safeParse(value);
    if (!parsed.success) {
      throw validationError(
        zodProblems(parsed.error).map((e) => ({ ...e, path: `/value${e.path}` })),
        `Expected the ${owner} spark list: [{sparkId, type, stars}]`,
      );
    }
    const sparks = draft.sparks as { owner: string }[];
    draft.sparks = [
      ...sparks.filter((s) => s.owner !== owner),
      ...parsed.data.map((s) => ({ owner, ...s })),
    ];
  } else if (item.path === '/trainMode' || !setAtPointer(draft, item.path, value)) {
    throw validationError(
      [{ path: item.path, message: 'this field cannot be corrected through a review item' }],
      'Unresolvable review path',
    );
  }

  const parsed = Veteran.safeParse(draft);
  if (!parsed.success) {
    throw validationError(
      zodProblems(parsed.error).map((e) => ({ ...e, path: `/veteran${e.path}` })),
    );
  }
  const veteran = parsed.data;
  const master = await c.var.deps.master(detail.masterVersion, c.env);
  if (!master) {
    throw new ApiError(
      500,
      'Internal Server Error',
      `Master data ${detail.masterVersion} is unavailable`,
    );
  }
  const unknown = checkMasterIds(veteran, master);
  if (unknown.length > 0) {
    throw validationError(
      unknown.map((u) => ({
        path: `/veteran${u.path}`,
        kind: u.kind,
        id: u.id,
        message: `unknown ${u.kind} ID "${u.id}" in master data ${detail.masterVersion}`,
      })),
      'Unknown master-data IDs',
    );
  }

  const newFingerprint = await fingerprint(veteran);
  const clash = await db
    .prepare('SELECT id FROM veterans WHERE fingerprint = ? AND id <> ?')
    .bind(newFingerprint, detail.id)
    .first<{ id: string }>();
  if (clash) {
    throw new ApiError(409, 'Conflict', 'The corrected veteran duplicates an existing one', [
      { message: 'fingerprint collision', veteranId: clash.id },
    ]);
  }

  const now = nowIso(c);
  const { capture_id: captureId } = (await db
    .prepare('SELECT capture_id FROM veterans WHERE id = ?')
    .bind(detail.id)
    .first<{ capture_id: string }>())!;
  const trainMode =
    detail.modeSource === 'override' ? detail.trainMode : deriveTrainMode(veteran.epithet);
  const oldPair: [string, string] = [detail.characterId, detail.outfitId];
  const newPair: [string, string] = [veteran.characterId, veteran.outfitId];
  try {
    await db.batch([
      ...writeVeteranStatements(
        db,
        { ...veteran, trainMode },
        {
          id: detail.id,
          fingerprint: newFingerprint,
          masterVersion: detail.masterVersion,
          captureId,
          capturedAt: detail.capturedAt,
          minConfidence: detail.minConfidence,
          trainMode,
          modeSource: detail.modeSource,
          now,
        },
        'id',
      ),
      db
        .prepare(
          `UPDATE capture_fields SET value_json = ?, status = 'corrected' WHERE veteran_id = ? AND path = ?`,
        )
        .bind(JSON.stringify(value), detail.id, item.path),
      db
        .prepare(
          `UPDATE review_items SET status = 'resolved', resolved_value_json = ?, resolved_at = ? WHERE id = ?`,
        )
        .bind(JSON.stringify(value), now, item.id),
      matchParentsStatement(db, detail.id, [oldPair, newPair]),
    ]);
  } catch (e) {
    // A concurrent ingest can take the new fingerprint between the check and the batch.
    if (String(e).includes('UNIQUE')) {
      throw new ApiError(409, 'Conflict', 'The corrected veteran duplicates an existing one');
    }
    throw e;
  }

  const row = await db.prepare(`${SELECT_REVIEW} WHERE r.id = ?`).bind(item.id).first<ReviewRow>();
  return c.json(toReviewItem(row!));
});
