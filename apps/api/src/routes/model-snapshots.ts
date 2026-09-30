import { Hono } from 'hono';
import { z } from 'zod';
import { ModelSnapshot } from '@uma/schema';
import { ApiError } from '../problem.ts';
import { parseBody, parseQuery, type AppEnv } from '../http.ts';

export const modelSnapshots = new Hono<AppEnv>();

/** Snapshots kept per kind; older ones are pruned on insert to bound D1 storage. */
const KEEP_PER_KIND = 20;

interface Row {
  id: string;
  kind: 'training-v1';
  master_version: string;
  trained_at: string;
  n_samples: number;
  params_json: string;
}
const toSnapshot = (r: Row): ModelSnapshot => ({
  id: r.id,
  kind: r.kind,
  masterVersion: r.master_version,
  trainedAt: r.trained_at,
  nSamples: r.n_samples,
  params: JSON.parse(r.params_json),
});

// The latest snapshot (optionally of one kind); 404 when there is none yet.
modelSnapshots.get('/model-snapshots', async (c) => {
  const { kind } = parseQuery(c, z.object({ kind: ModelSnapshot.shape.kind.optional() }));
  const stmt =
    kind === undefined
      ? c.env.DB.prepare('SELECT * FROM model_snapshots ORDER BY trained_at DESC, id DESC LIMIT 1')
      : c.env.DB.prepare(
          'SELECT * FROM model_snapshots WHERE kind = ? ORDER BY trained_at DESC, id DESC LIMIT 1',
        ).bind(kind);
  const row = await stmt.first<Row>();
  if (!row) throw new ApiError(404, 'Not Found', 'No model snapshot has been stored yet');
  return c.json(toSnapshot(row));
});

modelSnapshots.post('/model-snapshots', async (c) => {
  const snap = await parseBody(c, ModelSnapshot);
  const db = c.env.DB;
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO model_snapshots (id, kind, master_version, trained_at, n_samples, params_json)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        snap.id,
        snap.kind,
        snap.masterVersion,
        snap.trainedAt,
        snap.nSamples,
        JSON.stringify(snap.params),
      ),
    db
      .prepare(
        `DELETE FROM model_snapshots WHERE kind = ?1 AND id NOT IN
           (SELECT id FROM model_snapshots WHERE kind = ?1 ORDER BY trained_at DESC, id DESC LIMIT ?2)`,
      )
      .bind(snap.kind, KEEP_PER_KIND),
  ]);
  if (insert!.meta.changes === 0)
    throw new ApiError(409, 'Conflict', 'A snapshot with this id exists');
  return c.json(snap, 201);
});
