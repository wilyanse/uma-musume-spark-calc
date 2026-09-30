import { Hono } from 'hono';
import { CmTarget, Ulid } from '@uma/schema';
import { ApiError, validationError } from '../problem.ts';
import { nowIso, parseBody, type AppEnv } from '../http.ts';

export const cmTargets = new Hono<AppEnv>();

/** POST/PUT body: a CmTarget whose `id` is optional (the server owns it). */
const CmTargetInput = CmTarget.omit({ id: true }).extend({ id: Ulid.optional() });

interface Row {
  id: string;
  body_json: string;
}
const toTarget = (r: Row): CmTarget => ({ ...JSON.parse(r.body_json), id: r.id });
/** `id` lives in its own column, not in body_json. */
const toBody = (t: Omit<CmTarget, 'id'> & { id?: string }) => {
  const body: Partial<typeof t> = { ...t };
  delete body.id;
  return JSON.stringify(body);
};

cmTargets.get('/cm-targets', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, body_json FROM cm_targets ORDER BY created_at, id',
  ).all<Row>();
  return c.json(results.map(toTarget));
});

cmTargets.get('/cm-targets/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT id, body_json FROM cm_targets WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Row>();
  if (!row) throw new ApiError(404, 'Not Found', 'No such CM target');
  return c.json(toTarget(row));
});

cmTargets.post('/cm-targets', async (c) => {
  const input = await parseBody(c, CmTargetInput);
  const now = nowIso(c);
  const id = input.id ?? c.var.deps.newId(c.var.deps.now().getTime());
  const res = await c.env.DB.prepare(
    `INSERT INTO cm_targets (id, name, body_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(id) DO NOTHING`,
  )
    .bind(id, input.name, toBody(input), now)
    .run();
  if (res.meta.changes === 0)
    throw new ApiError(409, 'Conflict', 'A CM target with this id exists');
  return c.json({ ...input, id }, 201);
});

cmTargets.put('/cm-targets/:id', async (c) => {
  const input = await parseBody(c, CmTargetInput);
  const id = c.req.param('id');
  if (input.id !== undefined && input.id !== id) {
    throw validationError([{ path: '/id', message: 'body id must match the URL id' }]);
  }
  const res = await c.env.DB.prepare(
    'UPDATE cm_targets SET name = ?, body_json = ?, updated_at = ? WHERE id = ?',
  )
    .bind(input.name, toBody(input), nowIso(c), id)
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, 'Not Found', 'No such CM target');
  return c.json({ ...input, id });
});

cmTargets.delete('/cm-targets/:id', async (c) => {
  const res = await c.env.DB.prepare('DELETE FROM cm_targets WHERE id = ?')
    .bind(c.req.param('id'))
    .run();
  if (res.meta.changes === 0) throw new ApiError(404, 'Not Found', 'No such CM target');
  return c.body(null, 204);
});
