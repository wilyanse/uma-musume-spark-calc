import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@uma/schema';
import { DB_SCHEMA_VERSION } from '../src/app.ts';

describe('GET /api/v1/health', () => {
  it('is unauthenticated and matches the HealthResponse contract', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/health');
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.ok).toBe(true);
  });

  it('reports the number of the last migration as dbSchemaVersion', () => {
    const last = env.TEST_MIGRATIONS.at(-1)!.name;
    expect(DB_SCHEMA_VERSION).toBe(Number.parseInt(last.split('_')[0]!, 10));
  });

  it('returns RFC 9457 problem+json for unknown API routes through the real entry point', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({
      title: 'Not Found',
      status: 404,
      type: 'about:blank',
    });
  });
});
