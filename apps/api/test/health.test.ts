import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@uma/schema';

describe('GET /api/v1/health', () => {
  it('is unauthenticated and matches the HealthResponse contract', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/health');
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.ok).toBe(true);
  });

  it('returns 404 for unknown API routes', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/nope');
    expect(res.status).toBe(404);
  });
});
