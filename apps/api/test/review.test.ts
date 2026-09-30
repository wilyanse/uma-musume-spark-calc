import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IngestResponse,
  ReviewItem,
  RosterVeteranDetail,
  fingerprint,
  type VeteranCapture,
} from '@uma/schema';
import { fixtureMaster, makeCapture, makeHarness, problem, resetDb } from './helpers/harness.ts';

beforeEach(resetDb);
type H = ReturnType<typeof makeHarness>;

const low = (path: string, value: unknown, rawText: string) => ({
  path,
  rawText,
  value,
  confidence: 0.3,
  status: 'low_confidence' as const,
  candidates: [{ value, score: 0.5 }],
  cropKey: null,
});
const withLow = (path: string, value: unknown, rawText: string) => (c: VeteranCapture) => {
  c.fields = c.fields.filter((f) => f.path !== path);
  c.fields.push(low(path, value, rawText));
};

const ingest = async (h: H, c: VeteranCapture) =>
  IngestResponse.parse(await (await h.call('POST', '/veterans', c)).json());
const openItems = async (h: H) =>
  ReviewItem.array().parse(await (await h.call('GET', '/review-items?status=open')).json());

describe('review queue', () => {
  it('lists open items joined with field and crop key; filters by status; validates the filter', async () => {
    const h = makeHarness();
    const crop = 'crops/01J8Z3K4M5N6P7Q8R9S0T1V2W3/%2Fstats%2Fspd.png';
    const c = await makeCapture((cap) => {
      withLow('/stats/spd', 894, '8g4')(cap);
      cap.fields.find((f) => f.path === '/stats/spd')!.cropKey = crop;
    });
    const { veteranId } = await ingest(h, c);
    const items = await openItems(h);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      veteranId,
      path: '/stats/spd',
      status: 'open',
      cropKey: crop,
      resolvedAt: null,
      field: { rawText: '8g4', status: 'low_confidence', candidates: [{ value: 894, score: 0.5 }] },
    });
    expect(
      ReviewItem.array().parse(await (await h.call('GET', '/review-items?status=resolved')).json()),
    ).toEqual([]);
    await problem(await h.call('GET', '/review-items?status=bogus'), 422);
  });

  it('resolve applies the value, recomputes the fingerprint, marks field corrected and item resolved', async () => {
    const h = makeHarness();
    const original = await makeCapture(withLow('/stats/spd', 894, '8g4'));
    const { veteranId } = await ingest(h, original);
    const [item] = await openItems(h);
    h.tick();
    const res = await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 884 });
    expect(res.status).toBe(200);
    const resolved = ReviewItem.parse(await res.json());
    expect(resolved).toMatchObject({ status: 'resolved', resolvedValue: 884 });
    expect(resolved.resolvedAt).toBe('2026-09-30T00:00:01.000Z');
    expect(resolved.field).toMatchObject({ status: 'corrected', value: 884 });

    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    expect(detail.stats.spd).toBe(884);
    const corrected = structuredClone(original.veteran);
    corrected.stats.spd = 884;
    expect(detail.fingerprint).toBe(await fingerprint(corrected));
    expect(detail.fingerprint).not.toBe(original.fingerprint);
    expect(detail.sparks).toEqual(original.veteran.sparks); // child rows preserved in order
    expect(detail.fields.find((f) => f.path === '/stats/spd')!.status).toBe('corrected');
    expect(await openItems(h)).toEqual([]);

    // Resolving twice is a conflict; the corrected veteran re-ingests idempotently by its new fingerprint.
    await problem(await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 884 }), 409);
    const again = await makeCapture((c) => {
      c.veteran.stats.spd = 884;
    });
    expect((await h.call('POST', '/veterans', again)).status).toBe(200);
  });

  it('resolves an array-indexed pointer (/sparks/3/stars) and re-validates the result', async () => {
    const h = makeHarness();
    const original = await makeCapture(withLow('/sparks/3/stars', 1, 'x'));
    const { veteranId } = await ingest(h, original);
    const [item] = await openItems(h);
    await problem(await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 4 }), 422);
    expect((await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 3 })).status).toBe(
      200,
    );
    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    expect(detail.sparks[3]!.stars).toBe(3);
  });

  it('rejects a value for an unknown master ID, and one that breaks a rule, leaving the veteran untouched', async () => {
    const h = makeHarness();
    const { veteranId } = await ingest(
      h,
      await makeCapture(withLow('/scenarioId', 'scenario:ura-finale', 'x')),
    );
    const [item] = await openItems(h);
    const p = await problem(
      await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 'scenario:nope' }),
      422,
    );
    expect(p.errors![0]).toMatchObject({
      kind: 'scenarios',
      id: 'scenario:nope',
      path: '/veteran/scenarioId',
    });
    await problem(await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 5 }), 422);
    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    expect(detail.scenarioId).toBe('scenario:ura-finale');
    expect((await openItems(h)).length).toBe(1);
  });

  it('409s when the corrected fingerprint collides with another veteran', async () => {
    const h = makeHarness();
    const other = await ingest(
      h,
      await makeCapture((c) => {
        c.veteran.stats.spd = 884;
        c.captureId = '01J8Z3K4M5N6P7Q8R9S0T1V2W8';
      }),
    );
    await ingest(h, await makeCapture(withLow('/stats/spd', 894, '8g4')));
    const [item] = await openItems(h);
    const p = await problem(
      await h.call('POST', `/review-items/${item!.id}/resolve`, { value: 884 }),
      409,
    );
    expect(p.errors![0]).toMatchObject({ veteranId: other.veteranId });
    expect((await openItems(h)).length).toBe(1);
  });

  it('handles the /sparks/<owner> pseudo-pointer: the value is that owner’s whole spark list', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== 'parent2');
      c.fields.push(low('/sparks/parent2', null, ''));
    });
    const { veteranId } = await ingest(h, capture);
    const [item] = await openItems(h);
    expect(item!.path).toBe('/sparks/parent2');

    // A spark list that breaks the one-blue/one-pink rule is refused, with the contract message.
    await problem(
      await h.call('POST', `/review-items/${item!.id}/resolve`, {
        value: [{ sparkId: 'spark:stamina', type: 'blue', stars: 3 }],
      }),
      422,
    );
    const value = [
      { sparkId: 'spark:stamina', type: 'blue', stars: 3 },
      { sparkId: 'spark:long', type: 'pink', stars: 3 },
    ];
    expect((await h.call('POST', `/review-items/${item!.id}/resolve`, { value })).status).toBe(200);
    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    expect(detail.sparks.filter((s) => s.owner === 'parent2')).toEqual(
      value.map((s) => ({ owner: 'parent2', ...s })),
    );
    expect(detail.sparks.filter((s) => s.owner !== 'parent2')).toHaveLength(
      capture.veteran.sparks.length,
    );
    expect(detail.fingerprint).toBe(
      await fingerprint({ ...capture.veteran, sparks: detail.sparks }),
    );
  });

  it('rejects unresolvable field paths at ingest (S3c), incl. prototype-pollution pointers', async () => {
    const h = makeHarness();
    for (const path of ['/nope/deeper', '/__proto__/polluted', '/trainMode', '/sparks/99/stars']) {
      const res = await h.call(
        'POST',
        '/veterans',
        await makeCapture((c) => {
          c.fields.push(low(path, 1, 'x'));
        }),
      );
      const p = await problem(res, 422);
      expect(p.errors![0]!.path).toMatch(/^\/fields\/\d+\/path$/);
    }
    expect(await openItems(h)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('re-ingest dismisses open items whose field is now ok or gone (S3a/b)', async () => {
    const h = makeHarness();
    const both = async () =>
      makeCapture((c) => {
        withLow('/stats/spd', 894, 'x')(c);
        withLow('/stats/sta', 700, 'x')(c);
      });
    await ingest(h, await both());
    expect(await openItems(h)).toHaveLength(2);
    // Same veteran (fields aren't part of the fingerprint): spd is now read ok, sta is absent.
    const again = await makeCapture((c) => {
      c.fields = c.fields.filter((f) => f.path !== '/stats/sta');
    });
    const r = await ingest(h, again);
    expect(r.created).toBe(false);
    expect(r.reviewItemIds).toBeUndefined();
    expect(await openItems(h)).toEqual([]);
    const all = ReviewItem.array().parse(await (await h.call('GET', '/review-items')).json());
    // The dismissed 'sta' item has no field row any more; it is hidden but never 'open'.
    expect(all.filter((i) => i.status === 'open')).toHaveLength(0);
    const rows = await env.DB.prepare('SELECT path, status FROM review_items ORDER BY path').all();
    expect(rows.results).toEqual([
      { path: '/stats/spd', status: 'dismissed' },
      { path: '/stats/sta', status: 'dismissed' },
    ]);
    // A later low-confidence read of spd opens a fresh item.
    const third = await ingest(h, await both());
    expect(third.reviewItemIds).toHaveLength(2);
    expect(await openItems(h)).toHaveLength(2);
  });

  it('S2: resolving to a duplicate skill is a 422 (not a misleading 409) and changes nothing', async () => {
    const h = makeHarness();
    const capture = await makeCapture(withLow('/skills/2/skillId', 'skill:x', 'x'));
    const { veteranId } = await ingest(h, capture);
    const [item] = await openItems(h);
    const dup = capture.veteran.skills[1]!.skillId;
    const p = await problem(
      await h.call('POST', `/review-items/${item!.id}/resolve`, { value: dup }),
      422,
    );
    expect(p.errors![0]).toMatchObject({ path: '/veteran/skills/2/skillId' });
    expect((await openItems(h)).length).toBe(1);
    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    expect(detail.skills).toHaveLength(capture.veteran.skills.length);
  });

  it('guards two coordinated resolves: one commits and the stale one stays open', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let active = false;
    let masterCalls = 0;
    const h = makeHarness({
      master: async () => {
        if (!active) return fixtureMaster;
        masterCalls += 1;
        if (masterCalls === 2) release();
        await gate;
        return fixtureMaster;
      },
    });
    const capture = await makeCapture((c) => {
      withLow('/stats/spd', c.veteran.stats.spd, 'x')(c);
      withLow('/stats/sta', c.veteran.stats.sta, 'x')(c);
    });
    const { veteranId } = await ingest(h, capture);
    active = true;
    const items = await openItems(h);
    expect(items).toHaveLength(2);
    const responses = await Promise.all(
      [
        [items[0]!.id, 884],
        [items[1]!.id, 700],
      ].map(([id, value]) => h.call('POST', `/review-items/${id}/resolve`, { value })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    expect([detail.stats.spd, detail.stats.sta]).toContain(884);
    expect(await openItems(h)).toHaveLength(1);
  });

  it('accepts an ok provenance field for /trainMode but rejects it when low-confidence', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.fields.push({
        path: '/trainMode',
        rawText: 'Independent Learner',
        value: 'independent',
        confidence: 1,
        status: 'ok',
        candidates: [],
        cropKey: null,
      });
    });
    expect((await h.call('POST', '/veterans', capture)).status).toBe(201);
    const rejected = await makeCapture((c) => {
      c.fields.push(low('/trainMode', 'independent', 'x'));
    });
    await problem(await h.call('POST', '/veterans', rejected), 422);
  });

  it('N4: resolving /sparks/<owner> keeps the owner block in place', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== 'parent1');
      c.fields.push(low('/sparks/parent1', null, ''));
    });
    const { veteranId } = await ingest(h, capture);
    const [item] = await openItems(h);
    const before = capture.veteran.sparks.map((s) => s.owner);
    const resolvedResponse = await h.call('POST', `/review-items/${item!.id}/resolve`, {
      value: [
        { sparkId: capture.veteran.sparks[0]!.sparkId, type: 'blue', stars: 1 },
        { sparkId: capture.veteran.sparks[1]!.sparkId, type: 'pink', stars: 1 },
      ],
    });
    expect(resolvedResponse.status, await resolvedResponse.clone().text()).toBe(200);
    const detail = RosterVeteranDetail.parse(
      await (await h.call('GET', `/veterans/${veteranId}`)).json(),
    );
    // Untouched owners keep their relative order; the absent owner's replacement is appended.
    expect(detail.sparks.filter((s) => s.owner !== 'parent1').map((s) => s.owner)).toEqual(
      before.filter((owner) => owner !== 'parent1'),
    );
    expect(detail.sparks.filter((s) => s.owner === 'parent1')).toHaveLength(2);
    expect(detail.sparks.findIndex((s) => s.owner === 'parent1')).toBeGreaterThan(
      detail.sparks.findIndex((s) => s.owner === 'parent2'),
    );
  });

  it('404s for an unknown item and 422s for a missing value', async () => {
    const h = makeHarness();
    await problem(
      await h.call('POST', '/review-items/01J8Z3K4M5N6P7Q8R9S0T1V2W9/resolve', { value: 1 }),
      404,
    );
    await ingest(h, await makeCapture(withLow('/stats/spd', 894, 'x')));
    const [item] = await openItems(h);
    await problem(await h.call('POST', `/review-items/${item!.id}/resolve`, {}), 422);
  });
});
