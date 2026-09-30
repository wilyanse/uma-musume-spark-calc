import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IngestResponse,
  ReviewItem,
  RosterVeteranDetail,
  fingerprint,
  type VeteranCapture,
} from '@uma/schema';
import { barrierEnv, makeCapture, makeHarness, problem, resetDb } from './helpers/harness.ts';

// T04b review r1 B1/N3: deterministic resolve races. `barrierEnv` runs the competing request to
// completion at an exact point of the resolve (after all its reads, just before its guarded
// batch, or just after that batch commits), so the winner is chosen by the test, never by
// Promise/microtask order. No sleeps.

beforeEach(resetDb);

type H = ReturnType<typeof makeHarness>;
/** SQL only the resolve batch contains (ingest/PATCH/DELETE never set an item `resolved`). */
const RESOLVE_BATCH = "UPDATE review_items SET status = 'resolved'";

const low = (path: string, value: unknown) => ({
  path,
  rawText: 'x',
  value,
  confidence: 0.3,
  status: 'low_confidence' as const,
  candidates: [{ value, score: 0.5 }],
  cropKey: null,
});
const setLow = (c: VeteranCapture, path: string, value: unknown) => {
  c.fields = c.fields.filter((f) => f.path !== path);
  c.fields.push(low(path, value));
};

/** spd (894) and sta (938) both read with low confidence; values as stored. */
const twoLow = () =>
  makeCapture((c) => {
    setLow(c, '/stats/spd', c.veteran.stats.spd);
    setLow(c, '/stats/sta', c.veteran.stats.sta);
  });

async function setup() {
  const barrier = barrierEnv(env);
  const h = makeHarness({}, barrier.env);
  const capture = await twoLow();
  const res = await h.call('POST', '/veterans', capture);
  expect(res.status).toBe(201);
  const { veteranId, reviewItemIds } = IngestResponse.parse(await res.json());
  const [spdItem, staItem] = reviewItemIds!;
  return { barrier, h, capture, veteranId, spdItem: spdItem!, staItem: staItem! };
}

const resolve = (h: H, id: string, value: unknown) =>
  h.call('POST', `/review-items/${id}/resolve`, { value });

const q = async <T>(sql: string, ...bind: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...bind)
      .all<T>()
  ).results;

/** Everything the matrix asserts on, read straight from D1. */
async function snapshot(veteranId: string) {
  const [counts] = await q<{ veterans: number; orphans: number }>(
    `SELECT (SELECT COUNT(*) FROM veterans) AS veterans,
       (SELECT COUNT(*) FROM veteran_skills WHERE veteran_id NOT IN (SELECT id FROM veterans))
     + (SELECT COUNT(*) FROM veteran_sparks WHERE veteran_id NOT IN (SELECT id FROM veterans))
     + (SELECT COUNT(*) FROM veteran_deck WHERE veteran_id NOT IN (SELECT id FROM veterans))
     + (SELECT COUNT(*) FROM veteran_parents WHERE veteran_id NOT IN (SELECT id FROM veterans))
     + (SELECT COUNT(*) FROM capture_fields WHERE veteran_id NOT IN (SELECT id FROM veterans))
     + (SELECT COUNT(*) FROM review_items WHERE veteran_id NOT IN (SELECT id FROM veterans)) AS orphans`,
  );
  const [row] = await q<{
    spd: number;
    sta: number;
    rating: number;
    train_mode: string;
    mode_source: string;
    fingerprint: string;
  }>(
    'SELECT spd, sta, rating, train_mode, mode_source, fingerprint FROM veterans WHERE id = ?',
    veteranId,
  );
  const fields = Object.fromEntries(
    (
      await q<{ path: string; status: string; value_json: string }>(
        'SELECT path, status, value_json FROM capture_fields WHERE veteran_id = ?',
        veteranId,
      )
    ).map((f) => [f.path, { status: f.status, value: JSON.parse(f.value_json) as unknown }]),
  );
  const items = Object.fromEntries(
    (
      await q<{ id: string; status: string; resolved_value_json: string | null }>(
        'SELECT id, status, resolved_value_json FROM review_items',
      )
    ).map((i) => [i.id, { status: i.status, resolved: i.resolved_value_json }]),
  );
  return { ...counts!, row, fields, items };
}

/** The stored fingerprint is `fingerprint(veteran)` of the persisted veteran (01 §5). */
async function expectFingerprintConsistent(h: H, veteranId: string) {
  const res = await h.call('GET', `/veterans/${veteranId}`);
  expect(res.status).toBe(200);
  const detail = RosterVeteranDetail.parse(await res.json());
  expect(detail.fingerprint).toBe(await fingerprint(detail));
  const [row] = await q<{ fingerprint: string }>(
    'SELECT fingerprint FROM veterans WHERE id = ?',
    veteranId,
  );
  expect(row!.fingerprint).toBe(detail.fingerprint);
  return detail;
}

describe('resolve races (hook-injected, winner controlled by the test)', () => {
  it('DELETE commits inside the resolve window: 404, nothing resurrected, zero orphans, retry 404', async () => {
    const { barrier, h, veteranId, spdItem } = await setup();
    let deleted = 0;
    barrier.on('before', RESOLVE_BATCH, async () => {
      deleted = (await h.call('DELETE', `/veterans/${veteranId}`)).status;
    });
    const p = await problem(await resolve(h, spdItem, 884), 404);
    expect(barrier.fired()).toBe(1);
    expect(deleted).toBe(204);
    expect(p.detail).toBe('The veteran of this review item no longer exists');
    const s = await snapshot(veteranId);
    expect(s).toMatchObject({ veterans: 0, orphans: 0, row: undefined, fields: {}, items: {} });
    // The loser can't be "retried" into existence either.
    await problem(await resolve(h, spdItem, 884), 404);
    expect((await snapshot(veteranId)).veterans).toBe(0);
  });

  it('DELETE right after the resolve commits: 404 response, the delete still removes everything', async () => {
    const { barrier, h, veteranId, spdItem } = await setup();
    let deleted = 0;
    barrier.on('after', RESOLVE_BATCH, async () => {
      deleted = (await h.call('DELETE', `/veterans/${veteranId}`)).status;
    });
    const p = await problem(await resolve(h, spdItem, 884), 404);
    expect(barrier.fired()).toBe(1);
    expect(deleted).toBe(204);
    expect(p.detail).toBe('The veteran of this review item was deleted');
    expect(await snapshot(veteranId)).toMatchObject({ veterans: 0, orphans: 0, items: {} });
  });

  it('PATCH commits inside the resolve window: 409, override kept, correction not applied; retry succeeds', async () => {
    const { barrier, h, capture, veteranId, spdItem, staItem } = await setup();
    let patched = 0;
    barrier.on('before', RESOLVE_BATCH, async () => {
      patched = (await h.call('PATCH', `/veterans/${veteranId}`, { trainMode: 'manual' })).status;
    });
    const p = await problem(await resolve(h, spdItem, 884), 409);
    expect(barrier.fired()).toBe(1);
    expect(patched).toBe(200);
    expect(p.detail).toMatch(/veteran changed/);
    let s = await snapshot(veteranId);
    expect(s).toMatchObject({ veterans: 1, orphans: 0 });
    expect(s.row).toMatchObject({ spd: 894, train_mode: 'manual', mode_source: 'override' });
    expect(s.row!.fingerprint).toBe(capture.fingerprint);
    expect(s.fields['/stats/spd']).toEqual({ status: 'low_confidence', value: 894 });
    expect(s.items[spdItem]).toEqual({ status: 'open', resolved: null });
    expect(s.items[staItem]).toEqual({ status: 'open', resolved: null });
    await expectFingerprintConsistent(h, veteranId);

    // The item is still open, so re-submitting the correction now succeeds and keeps the override.
    expect((await resolve(h, spdItem, 884)).status).toBe(200);
    s = await snapshot(veteranId);
    expect(s.row).toMatchObject({ spd: 884, train_mode: 'manual', mode_source: 'override' });
    expect(s.fields['/stats/spd']).toEqual({ status: 'corrected', value: 884 });
    expect(s.items[spdItem]).toEqual({ status: 'resolved', resolved: '884' });
    expect(s).toMatchObject({ veterans: 1, orphans: 0 });
    const detail = await expectFingerprintConsistent(h, veteranId);
    expect(detail.fingerprint).not.toBe(capture.fingerprint);
  });

  it('re-ingest commits inside the resolve window: 409, ingest data and override kept; retry succeeds', async () => {
    const { barrier, h, capture, veteranId, spdItem } = await setup();
    // An override set beforehand must survive both the ingest and the retried resolve (01 §6).
    expect((await h.call('PATCH', `/veterans/${veteranId}`, { trainMode: 'manual' })).status).toBe(
      200,
    );
    const again = await twoLow();
    again.veteran.rating = 13472; // not part of the fingerprint: same veteran, new data
    let ingested = 0;
    barrier.on('before', RESOLVE_BATCH, async () => {
      ingested = (await h.call('POST', '/veterans', again)).status;
    });
    const p = await problem(await resolve(h, spdItem, 884), 409);
    expect(barrier.fired()).toBe(1);
    expect(ingested).toBe(200);
    expect(p.detail).toMatch(/veteran changed/);
    let s = await snapshot(veteranId);
    expect(s).toMatchObject({ veterans: 1, orphans: 0 });
    expect(s.row).toMatchObject({
      spd: 894,
      rating: 13472,
      train_mode: 'manual',
      mode_source: 'override',
      fingerprint: capture.fingerprint,
    });
    expect(s.fields['/stats/spd']).toEqual({ status: 'low_confidence', value: 894 });
    expect(s.items[spdItem]).toEqual({ status: 'open', resolved: null }); // still low: same item
    await expectFingerprintConsistent(h, veteranId);

    expect((await resolve(h, spdItem, 884)).status).toBe(200);
    s = await snapshot(veteranId);
    expect(s.row).toMatchObject({
      spd: 884,
      rating: 13472,
      train_mode: 'manual',
      mode_source: 'override',
    });
    expect(s.fields['/stats/spd']).toEqual({ status: 'corrected', value: 884 });
    expect(s.items[spdItem]!.status).toBe('resolved');
    expect(s).toMatchObject({ veterans: 1, orphans: 0 });
    await expectFingerprintConsistent(h, veteranId);
  });

  it('re-ingest that reads the field ok dismisses the item inside the window: 409 stays a conflict', async () => {
    const { barrier, h, capture, veteranId, spdItem, staItem } = await setup();
    const clean = await makeCapture((c) => setLow(c, '/stats/sta', c.veteran.stats.sta));
    let ingested = 0;
    barrier.on('before', RESOLVE_BATCH, async () => {
      ingested = (await h.call('POST', '/veterans', clean)).status;
    });
    const p = await problem(await resolve(h, spdItem, 884), 409);
    expect(barrier.fired()).toBe(1);
    expect(ingested).toBe(200);
    expect(p.detail).toBe('Review item is already dismissed');
    const s = await snapshot(veteranId);
    expect(s).toMatchObject({ veterans: 1, orphans: 0 });
    expect(s.row).toMatchObject({ spd: 894, train_mode: 'independent', mode_source: 'epithet' });
    expect(s.row!.fingerprint).toBe(capture.fingerprint);
    expect(s.fields['/stats/spd']).toEqual({ status: 'ok', value: 894 });
    expect(s.items[spdItem]).toEqual({ status: 'dismissed', resolved: null });
    expect(s.items[staItem]).toEqual({ status: 'open', resolved: null });
    // A closed item is never retried as if it were open.
    const retry = await problem(await resolve(h, spdItem, 884), 409);
    expect(retry.detail).toBe('Review item is already dismissed');
    expect((await snapshot(veteranId)).row).toMatchObject({ spd: 894 });
    await expectFingerprintConsistent(h, veteranId);
  });

  for (const winner of ['spd', 'sta'] as const) {
    it(`two resolves of different items, ${winner} explicitly wins: loser 409, untouched, retry succeeds`, async () => {
      const { barrier, h, veteranId, spdItem, staItem } = await setup();
      const plan = {
        spd: { id: spdItem, path: '/stats/spd', col: 'spd', from: 894, to: 884 },
        sta: { id: staItem, path: '/stats/sta', col: 'sta', from: 938, to: 700 },
      } as const;
      const win = plan[winner];
      const lose = plan[winner === 'spd' ? 'sta' : 'spd'];
      let inner = 0;
      barrier.on('before', RESOLVE_BATCH, async () => {
        inner = (await resolve(h, win.id, win.to)).status;
      });
      const p = await problem(await resolve(h, lose.id, lose.to), 409);
      expect(barrier.fired()).toBe(1);
      expect(inner).toBe(200);
      expect(p.detail).toMatch(/veteran changed/);
      let s = await snapshot(veteranId);
      expect(s).toMatchObject({ veterans: 1, orphans: 0 });
      expect(s.row).toMatchObject({
        [win.col]: win.to,
        [lose.col]: lose.from,
        train_mode: 'independent',
        mode_source: 'epithet',
      });
      expect(s.fields[win.path]).toEqual({ status: 'corrected', value: win.to });
      expect(s.fields[lose.path]).toEqual({ status: 'low_confidence', value: lose.from });
      expect(s.items[win.id]).toEqual({ status: 'resolved', resolved: String(win.to) });
      expect(s.items[lose.id]).toEqual({ status: 'open', resolved: null });
      await expectFingerprintConsistent(h, veteranId);

      expect((await resolve(h, lose.id, lose.to)).status).toBe(200);
      s = await snapshot(veteranId);
      expect(s.row).toMatchObject({ [win.col]: win.to, [lose.col]: lose.to });
      expect(s.fields[lose.path]).toEqual({ status: 'corrected', value: lose.to });
      expect(s.items[lose.id]!.status).toBe('resolved');
      expect(s).toMatchObject({ veterans: 1, orphans: 0 });
      await expectFingerprintConsistent(h, veteranId);
    });
  }

  it('two resolves of the SAME item: the injected one wins, the other is a 409 and stays one', async () => {
    const { barrier, h, veteranId, spdItem, staItem } = await setup();
    let inner = 0;
    barrier.on('before', RESOLVE_BATCH, async () => {
      inner = (await resolve(h, spdItem, 700)).status;
    });
    const p = await problem(await resolve(h, spdItem, 884), 409);
    expect(barrier.fired()).toBe(1);
    expect(inner).toBe(200);
    expect(p.detail).toBe('Review item is already resolved');
    const s = await snapshot(veteranId);
    expect(s).toMatchObject({ veterans: 1, orphans: 0 });
    expect(s.row).toMatchObject({ spd: 700, train_mode: 'independent', mode_source: 'epithet' });
    expect(s.fields['/stats/spd']).toEqual({ status: 'corrected', value: 700 });
    expect(s.items[spdItem]).toEqual({ status: 'resolved', resolved: '700' });
    expect(s.items[staItem]).toEqual({ status: 'open', resolved: null });
    const listed = ReviewItem.array().parse(
      await (await h.call('GET', '/review-items?status=resolved')).json(),
    );
    expect(listed.map((i) => [i.id, i.resolvedValue])).toEqual([[spdItem, 700]]);
    // Resolved is final: the losing value is refused again rather than applied.
    const retry = await problem(await resolve(h, spdItem, 884), 409);
    expect(retry.detail).toBe('Review item is already resolved');
    expect((await snapshot(veteranId)).row).toMatchObject({ spd: 700 });
    await expectFingerprintConsistent(h, veteranId);
  });
});
