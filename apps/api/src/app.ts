import { Hono } from 'hono';
import type { HealthResponse } from '@uma/schema';
import { accessAuth } from './auth.ts';
import { defaultDeps, type Deps } from './deps.ts';
import { ApiError, problemResponse } from './problem.ts';
import type { AppEnv } from './http.ts';
import { veterans } from './routes/veterans.ts';
import { reviews } from './routes/reviews.ts';
import { ownedCards } from './routes/owned-cards.ts';
import { crops } from './routes/crops.ts';
import { cmTargets } from './routes/cm-targets.ts';
import { modelSnapshots } from './routes/model-snapshots.ts';

/** Number of the last file in `migrations/` (kept in step by a test). */
export const DB_SCHEMA_VERSION = 2;

export function createApp(deps: Deps = defaultDeps) {
  const app = new Hono<AppEnv>().basePath('/api/v1');

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  // 40 §3: every route except health sits behind the Access JWT check.
  app.use('*', accessAuth(deps));

  app.get('/health', (c) => {
    const body: HealthResponse = {
      ok: true,
      masterVersion: c.env.MASTER_VERSION,
      dbSchemaVersion: DB_SCHEMA_VERSION,
    };
    return c.json(body);
  });

  app.route('/', veterans);
  app.route('/', reviews);
  app.route('/', ownedCards);
  app.route('/', crops);
  app.route('/', cmTargets);
  app.route('/', modelSnapshots);

  // RFC 9457 problem+json for everything that isn't a success (40 §4; T02 review N2).
  app.notFound(() => problemResponse(404, 'Not Found', 'No such API route'));
  app.onError((err) => {
    if (err instanceof ApiError) {
      return problemResponse(err.status, err.title, err.message, err.errors, err.headers);
    }
    if (err instanceof Error && 'getResponse' in err) {
      const res = (err as { getResponse(): Response }).getResponse();
      return problemResponse(res.status, 'Request error', err.message);
    }
    console.error(err);
    return problemResponse(500, 'Internal Server Error');
  });
  return app;
}
