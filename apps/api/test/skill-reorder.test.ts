import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import { IngestResponse, ReviewItem } from '@uma/schema';
import { makeCapture, makeHarness, resetDb } from './helpers/harness.ts';

beforeEach(resetDb);

it('retires skill review history when a same-fingerprint re-ingest reorders skills', async () => {
  const h = makeHarness();
  const first = await makeCapture((c) =>
    c.fields.push({
      path: '/skills/0/level',
      rawText: '5',
      value: 5,
      confidence: 0.3,
      status: 'low_confidence',
      candidates: [],
      cropKey: null,
    }),
  );
  const created = IngestResponse.parse(await (await h.call('POST', '/veterans', first)).json());
  const item = created.reviewItemIds![0]!;
  expect((await h.call('POST', `/review-items/${item}/resolve`, { value: 4 })).status).toBe(200);

  const reordered = await makeCapture((c) => c.veteran.skills.reverse());
  expect(reordered.fingerprint).toBe(first.fingerprint);
  expect((await h.call('POST', '/veterans', reordered)).status).toBe(200);

  const resolved = ReviewItem.array().parse(
    await (await h.call('GET', '/review-items?status=resolved')).json(),
  );
  expect(resolved.some((r) => r.id === item)).toBe(false);
  const row = await env.DB.prepare('SELECT path, status, retired FROM review_items WHERE id = ?')
    .bind(item)
    .first();
  expect(row).toEqual({ path: '/skills/0/level', status: 'resolved', retired: 1 });
});
