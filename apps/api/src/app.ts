import { Hono } from 'hono';
import type { HealthResponse } from '@uma/schema';

export const DB_SCHEMA_VERSION = 0; // no migrations yet (T04 owns the schema)

export const app = new Hono<{ Bindings: Env }>().basePath('/api/v1');

// Unauthenticated (40 §3). Every other route added by T04 must sit behind the Access JWT check.
app.get('/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    masterVersion: c.env.MASTER_VERSION,
    dbSchemaVersion: DB_SCHEMA_VERSION,
  };
  return c.json(body);
});
