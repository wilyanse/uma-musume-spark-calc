import { beforeEach, expect, it } from 'vitest';
import { IngestResponse, ReviewItem, RosterVeteranDetail, fingerprint } from '@uma/schema';
import { makeCapture, makeHarness, problem, resetDb } from './helpers/harness.ts';

beforeEach(resetDb);
const low = (path: string, value: unknown) => ({
  path,
  value,
  rawText: 'uncertain',
  confidence: 0.3,
  status: 'low_confidence' as const,
  candidates: [],
  cropKey: null,
});

it('corrects an uncertain spark ID without moving sibling targets and rejects duplicates', async () => {
  const h = makeHarness();
  const capture = await makeCapture((c) => {
    c.fields.push(low('/sparks/25/sparkId', c.veteran.sparks[25]!.sparkId));
    c.fields.push(low('/sparks/25/stars', c.veteran.sparks[25]!.stars));
    c.fields.push(low('/sparks/26/stars', c.veteran.sparks[26]!.stars));
  });
  const response = await h.call('POST', '/veterans', capture);
  expect(response.status, await response.clone().text()).toBe(201);
  const { veteranId, reviewItemIds } = IngestResponse.parse(await response.json());
  const [idItem, sameElement, nextElement] = reviewItemIds!;
  await problem(
    await h.call('POST', `/review-items/${idItem}/resolve`, {
      value: capture.veteran.sparks[26]!.sparkId,
    }),
    422,
  );
  const before = RosterVeteranDetail.parse(
    await (await h.call('GET', `/veterans/${veteranId}`)).json(),
  );
  expect(before.sparks).toEqual(capture.veteran.sparks);
  expect(before.fingerprint).toBe(capture.fingerprint);
  const corrected = await h.call('POST', `/review-items/${idItem}/resolve`, {
    value: 'spark:arima-kinen',
  });
  expect(corrected.status, await corrected.clone().text()).toBe(200);
  expect(ReviewItem.parse(await corrected.json()).field).toMatchObject({
    path: '/sparks/25/sparkId',
    value: 'spark:arima-kinen',
    status: 'corrected',
  });
  const detail = RosterVeteranDetail.parse(
    await (await h.call('GET', `/veterans/${veteranId}`)).json(),
  );
  expect(detail.sparks).toEqual(
    capture.veteran.sparks.map((s, i) => (i === 25 ? { ...s, sparkId: 'spark:arima-kinen' } : s)),
  );
  expect(detail.fingerprint).not.toBe(capture.fingerprint);
  expect(detail.fingerprint).toBe(await fingerprint(detail));
  const open = ReviewItem.array().parse(
    await (await h.call('GET', '/review-items?status=open')).json(),
  );
  expect(open.map((i) => ({ id: i.id, path: i.path }))).toEqual([
    { id: sameElement, path: '/sparks/25/stars' },
    { id: nextElement, path: '/sparks/26/stars' },
  ]);
  expect((await h.call('POST', `/review-items/${nextElement}/resolve`, { value: 3 })).status).toBe(
    200,
  );
  const after = RosterVeteranDetail.parse(
    await (await h.call('GET', `/veterans/${veteranId}`)).json(),
  );
  expect(after.sparks[25]).toEqual(detail.sparks[25]);
  expect(after.sparks[26]).toEqual({ ...capture.veteran.sparks[26], stars: 3 });
});
