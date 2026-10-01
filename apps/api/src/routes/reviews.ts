import { Hono } from 'hono';
import { z } from 'zod';
import {
  ReviewStatus,
  ResolveReviewRequest,
  Veteran,
  VeteranSpark,
  checkMasterIds,
  fingerprint,
  type CaptureField,
  type ReviewItem,
} from '@uma/schema';
import { ApiError, validationError, zodProblems } from '../problem.ts';
import { ARRAY_INDEX_SQL, OWNER_PSEUDO, correctionTarget, extraVeteranChecks } from '../checks.ts';
import { nowIso, parseBody, parseQuery, type AppEnv } from '../http.ts';
import {
  deriveTrainMode,
  fieldFromRow,
  insertFieldsStatement,
  isStaleWrite,
  loadVeteranDetail,
  matchParentsStatement,
  toVeteran,
  writeGuardStatement,
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

// Items are listed joined with their field (01 §9), so an item whose field row is gone is not
// listed, and neither is a `retired` one (migration 0003): a closed item whose spark was removed by
// a `/sparks/<owner>` correction. Its path still names the old index, which now holds another
// spark (or nothing); joining it would show that spark's field as its own (T04b review r1 S1).
const SELECT_REVIEW = `SELECT r.id, r.veteran_id, r.path, r.status AS review_status, r.resolved_value_json,
    r.created_at, r.resolved_at, f.raw_text, f.value_json, f.confidence, f.status, f.candidates_json, f.crop_key
  FROM review_items r JOIN capture_fields f ON f.veteran_id = r.veteran_id AND f.path = r.path
  WHERE r.retired = 0`;

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
      ? c.env.DB.prepare(`${SELECT_REVIEW} ORDER BY r.created_at, r.rowid`)
      : c.env.DB.prepare(`${SELECT_REVIEW} AND r.status = ? ORDER BY r.created_at, r.rowid`).bind(
          status,
        );
  const { results } = await stmt.all<ReviewRow>();
  return c.json(results.map(toReviewItem));
});

const SparkWithoutOwner = VeteranSpark.omit({ owner: true });

/** `/sparks/<n>` or `/sparks/<n>/…`: an index-based pointer into the spark array. */
const SPARK_INDEX_PATH = /^\/sparks\/(\d+)(\/.*)?$/;

/**
 * Index remapping after a `/sparks/<owner>` replacement. `map[i]` is the new index of old spark
 * `i`, or -1 when it belonged to the replaced owner (it no longer exists as such). Paths that
 * index past the old array are treated like replaced ones: they pointed at nothing before.
 */
function remapSparkPath(path: string, map: number[]): string | null | undefined {
  const m = SPARK_INDEX_PATH.exec(path);
  if (!m) return undefined; // not index-based: unchanged
  const to = map[Number(m[1])] ?? -1;
  return to < 0 ? null : `/sparks/${to}${m[2] ?? ''}`;
}

/**
 * The same remapping for the veteran's review items, in SQL so items whose field row is gone are
 * covered too (exported for tests). For each index-based item (`/sparks/<n>` or `/sparks/<n>/…`):
 * - the spark survived (`map[n] >= 0`): the path follows it to `/sparks/<map[n]>/…`, open or
 *   closed, so the item keeps joining the field of the same spark (whose path moves identically
 *   in JS). Closed items keep their status and resolved value, which still describe that spark.
 * - the spark was removed (`map[n] < 0`, or `n` past the old array): the path is left as it was
 *   (it is never rewritten to the owner pseudo-path, whose field is a whole spark list; review
 *   r1 S1), the item is marked `retired` so it is no longer listed, and an open one is dismissed:
 *   the owner's whole list was just corrected, which supersedes it.
 * ?1 veteran id, ?2 JSON index map (old index → new index or -1), ?3 now.
 */
const idx = ARRAY_INDEX_SQL;
const to = `COALESCE(json_extract(?2, '$[' || CAST(${idx} AS INTEGER) || ']'), -1)`;
export const REMAP_REVIEW_PATHS_SQL = `UPDATE review_items SET
    path = CASE WHEN ${to} < 0 THEN path ELSE '/sparks/' || ${to} || substr(path, 9 + length(${idx})) END,
    retired = CASE WHEN ${to} < 0 THEN 1 ELSE retired END,
    status = CASE WHEN ${to} < 0 AND status = 'open' THEN 'dismissed' ELSE status END,
    resolved_at = CASE WHEN ${to} < 0 AND status = 'open' THEN ?3 ELSE resolved_at END
  WHERE veteran_id = ?1 AND retired = 0 AND path LIKE '/sparks/%' AND ${idx} <> ''
    AND ${idx} NOT GLOB '*[^0-9]*'`;

// 01 §9: apply the value to the veteran, recompute the fingerprint (409 on collision), resolve.
// Read-modify-write under optimistic concurrency (T04b): the batch starts with a write guard that
// aborts the whole D1 transaction unless the veteran still has the `updated_at` loaded here and
// the item is still open, so a concurrent resolve, PATCH, ingest or delete can't be overwritten,
// resurrected or half-applied. The losing request gets 409 (or 404 when the veteran is gone).
reviews.post('/review-items/:id/resolve', async (c) => {
  const db = c.env.DB;
  const { value } = await parseBody(c, ResolveReviewRequest);
  if (value === undefined) {
    throw validationError([{ path: '/value', message: 'value is required' }]);
  }
  const itemId = c.req.param('id');
  const item = await db
    .prepare('SELECT id, veteran_id, path, status FROM review_items WHERE id = ?')
    .bind(itemId)
    .first<{ id: string; veteran_id: string; path: string; status: string }>();
  if (!item) throw new ApiError(404, 'Not Found', 'No such review item');
  if (item.status !== 'open') {
    throw new ApiError(409, 'Conflict', `Review item is already ${item.status}`);
  }
  const detail = await loadVeteranDetail(db, item.veteran_id);
  if (!detail)
    throw new ApiError(404, 'Not Found', 'The veteran of this review item no longer exists');
  const { internal } = detail;

  // Apply the value to a copy of the `veteran` object.
  const draft = structuredClone(toVeteran(detail)) as unknown as Record<string, unknown>;
  const owner = OWNER_PSEUDO.exec(item.path)?.[1];
  let sparkMap: number[] | null = null;
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
    const replacement = parsed.data.map((s) => ({ owner, ...s }));
    // The owner's block goes where its first spark was (at the end when it had none). Every other
    // spark keeps its relative order; `sparkMap` records where each one moved, so index-based
    // fields and review items can follow it (T04 review N4).
    const at = sparks.findIndex((s) => s.owner === owner);
    const rest = sparks.filter((s) => s.owner !== owner);
    const insertAt = at === -1 ? rest.length : at; // every spark before `at` stays in `rest`
    draft.sparks = [...rest.slice(0, insertAt), ...replacement, ...rest.slice(insertAt)];
    let kept = 0;
    sparkMap = sparks.map((s) => {
      if (s.owner === owner) return -1;
      const next = kept < insertAt ? kept : kept + replacement.length;
      kept += 1;
      return next;
    });
  } else {
    // Leaf values only: whole arrays/elements and spark owner/ID leaves are refused, because
    // they could move or replace sparks under sibling index-based items (review r1 S2; Q-110).
    const at = correctionTarget(draft, item.path);
    if (at) at.node[at.key] = value;
    else
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
  const extra = extraVeteranChecks(veteran, '/veteran');
  if (extra.length > 0) throw validationError(extra);
  const master = await c.var.deps.master(internal.masterVersion, c.env);
  if (!master) {
    throw new ApiError(
      500,
      'Internal Server Error',
      `Master data ${internal.masterVersion} is unavailable`,
    );
  }
  const unknown = checkMasterIds(veteran, master);
  if (unknown.length > 0) {
    throw validationError(
      unknown.map((u) => ({
        path: `/veteran${u.path}`,
        kind: u.kind,
        id: u.id,
        message: `unknown ${u.kind} ID "${u.id}" in master data ${internal.masterVersion}`,
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

  // Capture fields are rewritten from the loaded snapshot (the guard proves it is current): the
  // resolved one becomes `corrected`, index-based ones follow their spark, and ones that pointed
  // into the replaced owner block are dropped (they described sparks that no longer exist).
  const fields: CaptureField[] = [];
  for (const f of detail.fields) {
    if (f.path === item.path) {
      fields.push({ ...f, value, status: 'corrected' });
      continue;
    }
    const moved = sparkMap ? remapSparkPath(f.path, sparkMap) : undefined;
    if (moved === null) continue;
    fields.push(moved === undefined ? f : { ...f, path: moved });
  }
  const remapped = sparkMap !== null && sparkMap.some((to, from) => to !== from);

  const now = nowIso(c);
  const trainMode =
    detail.modeSource === 'override' ? detail.trainMode : deriveTrainMode(veteran.epithet);
  const oldPair: [string, string] = [detail.characterId, detail.outfitId];
  const newPair: [string, string] = [veteran.characterId, veteran.outfitId];
  try {
    await db.batch([
      writeGuardStatement(db, detail.id, internal.updatedAt, item.id),
      ...writeVeteranStatements(
        db,
        { ...veteran, trainMode },
        {
          id: detail.id,
          fingerprint: newFingerprint,
          masterVersion: internal.masterVersion,
          captureId: internal.captureId,
          capturedAt: detail.capturedAt,
          minConfidence: detail.minConfidence,
          trainMode,
          modeSource: detail.modeSource,
          now,
        },
        'update',
      ),
      db.prepare('DELETE FROM capture_fields WHERE veteran_id = ?').bind(detail.id),
      ...insertFieldsStatement(db, newFingerprint, fields),
      ...(remapped
        ? [db.prepare(REMAP_REVIEW_PATHS_SQL).bind(detail.id, JSON.stringify(sparkMap), now)]
        : []),
      db
        .prepare(
          `UPDATE review_items SET status = 'resolved', resolved_value_json = ?, resolved_at = ? WHERE id = ?`,
        )
        .bind(JSON.stringify(value), now, item.id),
      matchParentsStatement(db, { id: detail.id }, [oldPair, newPair]),
    ]);
  } catch (e) {
    if (isStaleWrite(e)) throw await staleResolveError(db, item.id);
    // A concurrent ingest can take the new fingerprint between the check and the batch.
    if (String(e).includes('UNIQUE') && String(e).includes('veterans.fingerprint')) {
      throw new ApiError(409, 'Conflict', 'The corrected veteran duplicates an existing one');
    }
    throw e;
  }

  const row = await db.prepare(`${SELECT_REVIEW} AND r.id = ?`).bind(item.id).first<ReviewRow>();
  // Only a delete landing right after the commit can make it disappear.
  if (!row) throw new ApiError(404, 'Not Found', 'The veteran of this review item was deleted');
  return c.json(toReviewItem(row));
});

/** Why the write guard refused the batch: the item/veteran is gone (404) or changed (409). */
async function staleResolveError(db: D1Database, itemId: string): Promise<ApiError> {
  const now = await db
    .prepare(
      `SELECT r.status, EXISTS (SELECT 1 FROM veterans v WHERE v.id = r.veteran_id) AS alive
       FROM review_items r WHERE r.id = ?`,
    )
    .bind(itemId)
    .first<{ status: string; alive: number }>();
  if (!now || now.alive === 0) {
    return new ApiError(404, 'Not Found', 'The veteran of this review item no longer exists');
  }
  if (now.status !== 'open') {
    return new ApiError(409, 'Conflict', `Review item is already ${now.status}`);
  }
  return new ApiError(
    409,
    'Conflict',
    'The veteran changed while this correction was being applied; reload and try again',
  );
}
