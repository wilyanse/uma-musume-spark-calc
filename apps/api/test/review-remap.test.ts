import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IngestResponse,
  ReviewItem,
  RosterVeteranDetail,
  fingerprint,
  type VeteranCapture,
} from '@uma/schema';
import { REMAP_REVIEW_PATHS_SQL } from '../src/routes/reviews.ts';
import { makeCapture, makeHarness, problem, resetDb } from './helpers/harness.ts';

// T04b review r1 B2/S1/S2: `/sparks/<owner>` corrections that shrink or grow an existing owner
// block, through the real resolve route and REMAP_REVIEW_PATHS_SQL.
//
// Fixture sparks (mcqueen.json): self 0–8, parent1 9–18 (10 sparks), parent2 19–33 (15 sparks).

beforeEach(resetDb);
type H = ReturnType<typeof makeHarness>;

const low = (path: string, value: unknown) => ({
  path,
  rawText: 'x',
  value,
  confidence: 0.3,
  status: 'low_confidence' as const,
  candidates: [],
  cropKey: null,
});

const PARENT1_SHRUNK = [
  { sparkId: 'spark:power', type: 'blue', stars: 1 },
  { sparkId: 'spark:medium', type: 'pink', stars: 1 },
  { sparkId: 'spark:arima-kinen', type: 'white', stars: 1 },
] as const;
const PARENT1_GROWN = [
  { sparkId: 'spark:power', type: 'blue', stars: 2 },
  { sparkId: 'spark:medium', type: 'pink', stars: 2 },
  { sparkId: 'spark:shooting-star', type: 'green', stars: 3 },
  ...[
    'spark:nhk-mile-c',
    'spark:arima-kinen',
    'spark:hanshin-racecourse',
    'spark:uma-stan',
    'spark:head-on',
    'spark:my-true-strength',
    'spark:our-grand-concert',
    'spark:osaka-hai',
    'spark:unity-cup',
    'spark:firm-conditions',
  ].map((sparkId) => ({ sparkId, type: 'white', stars: 1 })),
] as const; // 13 sparks: parent1 grows by 3

const ingest = async (h: H, c: VeteranCapture) => {
  const res = await h.call('POST', '/veterans', c);
  expect(res.status, await res.clone().text()).toBe(201);
  return IngestResponse.parse(await res.json());
};
const listItems = async (h: H, status?: string) =>
  ReviewItem.array().parse(
    await (await h.call('GET', `/review-items${status ? `?status=${status}` : ''}`)).json(),
  );
const detailOf = async (h: H, id: string) =>
  RosterVeteranDetail.parse(await (await h.call('GET', `/veterans/${id}`)).json());
const rawItems = async () =>
  (
    await env.DB.prepare(
      'SELECT id, path, status, resolved_value_json, retired FROM review_items ORDER BY rowid',
    ).all<{
      id: string;
      path: string;
      status: string;
      resolved_value_json: string | null;
      retired: number;
    }>()
  ).results;

/**
 * A veteran with open index-based review items before (3, self), inside (12, parent1) and after
 * (19, 25, 33: parent2; two-digit indices) the parent1 block, plus `/stats/spd` and the parent1
 * owner pseudo-pointer. Field values equal what the veteran stores, so a field's value identifies
 * the spark it describes.
 */
async function setup() {
  const h = makeHarness();
  const capture = await makeCapture((c) => {
    const s = c.veteran.sparks;
    c.fields.push(
      low('/sparks/3/stars', s[3]!.stars),
      low('/sparks/12/stars', s[12]!.stars),
      low('/sparks/19/stars', s[19]!.stars),
      low('/sparks/25/stars', s[25]!.stars),
      low('/sparks/33/stars', s[33]!.stars),
      low('/sparks/parent1', null),
    );
    c.fields = c.fields.filter((f) => f.path !== '/stats/spd');
    c.fields.push(low('/stats/spd', c.veteran.stats.spd));
  });
  const { veteranId, reviewItemIds } = await ingest(h, capture);
  const all = await listItems(h, 'open');
  const byPath = Object.fromEntries(all.map((i) => [i.path, i]));
  expect(reviewItemIds).toHaveLength(7);
  return { h, capture, veteranId, byPath, sparks: capture.veteran.sparks };
}

/** Every index-based field describes the spark now at its index (value = stored spark data). */
function expectFieldsFollowSparks(detail: RosterVeteranDetail) {
  for (const f of detail.fields) {
    const m = /^\/sparks\/(\d+)\/(stars|sparkId)$/.exec(f.path);
    if (!m) continue;
    const spark = detail.sparks[Number(m[1])];
    expect(spark, f.path).toBeDefined();
    expect(f.value, f.path).toBe(spark![m[2] as 'stars' | 'sparkId']);
  }
}

describe('/sparks/<owner> corrections remap index-based review paths (B2)', () => {
  for (const [name, value, delta] of [
    ['SHRINKING', PARENT1_SHRUNK, -7],
    ['GROWING', PARENT1_GROWN, +3],
  ] as const) {
    it(`${name} parent1 (10 → ${10 + delta}): items keep their sparkId, removed ones are dismissed`, async () => {
      const { h, veteranId, byPath, sparks } = await setup();
      const spdBefore = byPath['/stats/spd']!;
      const res = await h.call('POST', `/review-items/${byPath['/sparks/parent1']!.id}/resolve`, {
        value,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const detail = await detailOf(h, veteranId);
      expect(detail.sparks).toHaveLength(sparks.length + delta);
      expect(detail.sparks.slice(9, 9 + value.length)).toEqual(
        value.map((s) => ({ owner: 'parent1', ...s })),
      );
      expect(detail.fingerprint).toBe(await fingerprint(detail));

      const rows = Object.fromEntries((await rawItems()).map((r) => [r.id, r]));
      // Before the block: untouched.
      expect(rows[byPath['/sparks/3/stars']!.id]).toMatchObject({
        path: '/sparks/3/stars',
        status: 'open',
        retired: 0,
      });
      // Inside the block: dismissed and retired; its path is kept, never rewritten.
      expect(rows[byPath['/sparks/12/stars']!.id]).toMatchObject({
        path: '/sparks/12/stars',
        status: 'dismissed',
        retired: 1,
      });
      // After the block: moved by `delta`, still open and still the same parent2 spark.
      for (const old of [19, 25, 33]) {
        const row = rows[byPath[`/sparks/${old}/stars`]!.id]!;
        expect(row).toMatchObject({
          path: `/sparks/${old + delta}/stars`,
          status: 'open',
          retired: 0,
        });
        expect(detail.sparks[old + delta]).toEqual(sparks[old]);
      }
      // The owner item is resolved; the unrelated item is exactly as it was.
      expect(rows[byPath['/sparks/parent1']!.id]).toMatchObject({
        path: '/sparks/parent1',
        status: 'resolved',
      });
      const open = await listItems(h, 'open');
      expect(open.find((i) => i.id === spdBefore.id)).toEqual(spdBefore);

      // Field rows: the removed block's field is gone, moved ones follow their spark.
      const fieldPaths = detail.fields.map((f) => f.path).filter((p) => p.startsWith('/sparks/'));
      expect(fieldPaths.sort()).toEqual(
        [
          '/sparks/3/stars',
          `/sparks/${19 + delta}/stars`,
          `/sparks/${25 + delta}/stars`,
          `/sparks/${33 + delta}/stars`,
          '/sparks/parent1',
        ].sort(),
      );
      expect(detail.fields.find((f) => f.path === '/sparks/parent1')).toMatchObject({
        status: 'corrected',
        value,
      });
      expectFieldsFollowSparks(detail);
      // Every listed open item joins the field of the spark it was created for.
      for (const item of open) {
        const m = /^\/sparks\/(\d+)\/(stars|sparkId)$/.exec(item.path);
        if (m) expect(item.field.value).toBe(detail.sparks[Number(m[1])]![m[2] as 'stars']);
      }
      expect(open.map((i) => i.path).sort()).toEqual(
        [
          '/sparks/3/stars',
          `/sparks/${19 + delta}/stars`,
          `/sparks/${25 + delta}/stars`,
          `/sparks/${33 + delta}/stars`,
          '/stats/spd',
        ].sort(),
      );
    });
  }

  it('resolving a moved item edits only the intended spark', async () => {
    const { h, veteranId, byPath, sparks } = await setup();
    expect(
      (
        await h.call('POST', `/review-items/${byPath['/sparks/parent1']!.id}/resolve`, {
          value: PARENT1_SHRUNK,
        })
      ).status,
    ).toBe(200);
    const before = await detailOf(h, veteranId);
    // Old /sparks/33/stars (parent2 unity-cup, 3★) is now /sparks/26/stars.
    const moved = (await listItems(h, 'open')).find(
      (i) => i.id === byPath['/sparks/33/stars']!.id,
    )!;
    expect(moved.path).toBe('/sparks/26/stars');
    const res = await h.call('POST', `/review-items/${moved.id}/resolve`, { value: 1 });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await detailOf(h, veteranId);
    const expected = structuredClone(before.sparks);
    expected[26] = { ...sparks[33]!, stars: 1 };
    expect(after.sparks).toEqual(expected);
    expect(after.sparks[26]).toMatchObject({ owner: 'parent2', sparkId: 'spark:unity-cup' });
    expect(after.fields.find((f) => f.path === '/sparks/26/stars')).toMatchObject({
      status: 'corrected',
      value: 1,
    });
    expect(after.fingerprint).toBe(await fingerprint(after));
    expectFieldsFollowSparks(after);
  });

  it('S1: closed items are never rewritten into the owner list, and never join another spark’s field', async () => {
    const { h, veteranId, byPath, sparks } = await setup();
    // Close items inside (12, resolved) and after (25, resolved) the block before the owner fix.
    const inBlock = byPath['/sparks/12/stars']!;
    const after = byPath['/sparks/25/stars']!;
    expect(
      (await h.call('POST', `/review-items/${inBlock.id}/resolve`, { value: sparks[12]!.stars }))
        .status,
    ).toBe(200);
    expect(
      (await h.call('POST', `/review-items/${after.id}/resolve`, { value: sparks[25]!.stars }))
        .status,
    ).toBe(200);
    expect(
      (
        await h.call('POST', `/review-items/${byPath['/sparks/parent1']!.id}/resolve`, {
          value: PARENT1_SHRUNK,
        })
      ).status,
    ).toBe(200);
    const rows = Object.fromEntries((await rawItems()).map((r) => [r.id, r]));
    // The removed spark's resolved item keeps its path, status and scalar value (audit record)…
    expect(rows[inBlock.id]).toEqual({
      id: inBlock.id,
      path: '/sparks/12/stars',
      status: 'resolved',
      resolved_value_json: JSON.stringify(sparks[12]!.stars),
      retired: 1,
    });
    // …and is not listed: index 12 is now another spark, whose (moved) field it must not show.
    const detail = await detailOf(h, veteranId);
    expect(detail.fields.find((f) => f.path === '/sparks/12/stars')).toMatchObject({
      value: sparks[19]!.stars, // old /sparks/19/stars moved here
    });
    const resolved = await listItems(h, 'resolved');
    expect(resolved.map((i) => i.id).sort()).toEqual(
      [after.id, byPath['/sparks/parent1']!.id].sort(),
    );
    const ownerRows = (await rawItems()).filter((r) => r.path === '/sparks/parent1');
    expect(ownerRows).toHaveLength(1); // no second item on the owner pseudo-path
    // A closed item on a surviving spark follows it and still shows that spark's field.
    const moved = resolved.find((i) => i.id === after.id)!;
    expect(moved.path).toBe('/sparks/18/stars');
    expect(moved.resolvedValue).toBe(sparks[25]!.stars);
    expect(moved.field).toMatchObject({ status: 'corrected', value: sparks[25]!.stars });
    expect(detail.sparks[18]).toEqual(sparks[25]);
    // The retired item isn't in the unfiltered list either, and stays closed.
    expect((await listItems(h)).some((i) => i.id === inBlock.id)).toBe(false);
    await problem(
      await h.call('POST', `/review-items/${inBlock.id}/resolve`, { value: 'spark:guts' }),
      409,
    );
  });
});

describe('REMAP_REVIEW_PATHS_SQL (direct)', () => {
  it('parses one- and two-digit indices exactly, leaves other paths alone, retires removed targets', async () => {
    const v = '01J8Z3K4M5N6P7Q8R9S0T1V2W5';
    const other = '01J8Z3K4M5N6P7Q8R9S0T1V2W6';
    const rows: [string, string, string, string][] = [
      ['A1', v, '/sparks/1/stars', 'open'], // 1 → 1 (must not be read as 10/12/…)
      ['A2', v, '/sparks/10', 'open'], // 10 → -1: dismissed + retired, path kept
      ['A3', v, '/sparks/12/stars', 'open'], // 12 → 3
      ['A4', v, '/sparks/12/stars', 'resolved'], // closed, surviving: moves, stays resolved
      ['A5', v, '/sparks/11/stars', 'resolved'], // closed, removed: path/status kept, retired
      ['A6', v, '/sparks/99/stars', 'open'], // past the old array: treated as removed
      ['A7', v, '/sparks/parent1', 'open'], // pseudo-pointer: untouched
      ['A8', v, '/skills/10/level', 'open'], // other array: untouched
      ['A9', v, '/sparks/1x/stars', 'open'], // not an index: untouched
      ['B1', other, '/sparks/12/stars', 'open'], // other veteran: untouched
    ];
    await env.DB.batch(
      rows.map(([id, vet, path, status]) =>
        env.DB.prepare(
          `INSERT INTO review_items (id, veteran_id, path, status, resolved_value_json, created_at)
           VALUES (?, ?, ?, ?, ?, '2026-09-30T00:00:00.000Z')`,
        ).bind(id, vet, path, status, status === 'resolved' ? '3' : null),
      ),
    );
    // Old indices 0..12: 0–2 stay; 3–11 are the removed owner block; 12 moves to 3.
    const map = [0, 1, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3];
    await env.DB.prepare(REMAP_REVIEW_PATHS_SQL)
      .bind(v, JSON.stringify(map), '2026-09-30T00:00:09.000Z')
      .run();
    const got = (
      await env.DB.prepare(
        'SELECT id, path, status, resolved_value_json, resolved_at, retired FROM review_items ORDER BY id',
      ).all()
    ).results;
    const t = '2026-09-30T00:00:09.000Z';
    expect(got).toEqual([
      {
        id: 'A1',
        path: '/sparks/1/stars',
        status: 'open',
        resolved_value_json: null,
        resolved_at: null,
        retired: 0,
      },
      {
        id: 'A2',
        path: '/sparks/10',
        status: 'dismissed',
        resolved_value_json: null,
        resolved_at: t,
        retired: 1,
      },
      {
        id: 'A3',
        path: '/sparks/3/stars',
        status: 'open',
        resolved_value_json: null,
        resolved_at: null,
        retired: 0,
      },
      {
        id: 'A4',
        path: '/sparks/3/stars',
        status: 'resolved',
        resolved_value_json: '3',
        resolved_at: null,
        retired: 0,
      },
      {
        id: 'A5',
        path: '/sparks/11/stars',
        status: 'resolved',
        resolved_value_json: '3',
        resolved_at: null,
        retired: 1,
      },
      {
        id: 'A6',
        path: '/sparks/99/stars',
        status: 'dismissed',
        resolved_value_json: null,
        resolved_at: t,
        retired: 1,
      },
      {
        id: 'A7',
        path: '/sparks/parent1',
        status: 'open',
        resolved_value_json: null,
        resolved_at: null,
        retired: 0,
      },
      {
        id: 'A8',
        path: '/skills/10/level',
        status: 'open',
        resolved_value_json: null,
        resolved_at: null,
        retired: 0,
      },
      {
        id: 'A9',
        path: '/sparks/1x/stars',
        status: 'open',
        resolved_value_json: null,
        resolved_at: null,
        retired: 0,
      },
      {
        id: 'B1',
        path: '/sparks/12/stars',
        status: 'open',
        resolved_value_json: null,
        resolved_at: null,
        retired: 0,
      },
    ]);
    // A second run with the identity map is a no-op for live items and never un-retires.
    await env.DB.prepare(REMAP_REVIEW_PATHS_SQL)
      .bind(v, JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), t)
      .run();
    expect(
      (await env.DB.prepare('SELECT id, path, retired FROM review_items ORDER BY id').all())
        .results,
    ).toEqual(got.map((r) => ({ id: r.id, path: r.path, retired: r.retired })));
  });
});

describe('same-fingerprint re-ingest reordering sparks', () => {
  it('retires old open and closed index targets before replacing fields without extra statements', async () => {
    const h = makeHarness();
    const original = await makeCapture((c) => {
      for (const n of [19, 25])
        c.fields.push(low(`/sparks/${n}/stars`, c.veteran.sparks[n]!.stars));
    });
    const first = await ingest(h, original);
    const [oldOpen, oldClosed] = first.reviewItemIds!;
    const oldSparks = original.veteran.sparks;
    expect(
      (
        await h.call('POST', `/review-items/${oldClosed}/resolve`, {
          value: oldSparks[25]!.stars,
        })
      ).status,
    ).toBe(200);
    const reordered = await makeCapture((c) => {
      [c.veteran.sparks[19], c.veteran.sparks[25]] = [c.veteran.sparks[25]!, c.veteran.sparks[19]!];
      for (const n of [19, 25])
        c.fields.push(low(`/sparks/${n}/stars`, c.veteran.sparks[n]!.stars));
    });
    expect(reordered.fingerprint).toBe(original.fingerprint); // sorting hides order changes
    const response = await h.call('POST', '/veterans', reordered);
    expect(response.status, await response.clone().text()).toBe(200);
    const second = IngestResponse.parse(await response.json());
    expect(second.veteranId).toBe(first.veteranId);
    const rows = Object.fromEntries((await rawItems()).map((r) => [r.id, r]));
    expect(rows[oldOpen!]).toMatchObject({
      path: '/sparks/19/stars',
      status: 'dismissed',
      retired: 1,
    });
    expect(rows[oldClosed!]).toMatchObject({
      path: '/sparks/25/stars',
      status: 'resolved',
      retired: 1,
    });
    expect(second.reviewItemIds).toHaveLength(2);
    for (const id of second.reviewItemIds!) {
      expect(id).not.toBe(oldOpen);
      expect(id).not.toBe(oldClosed);
      expect(rows[id]).toMatchObject({ status: 'open', retired: 0 });
    }
    const detail = await detailOf(h, first.veteranId);
    expect(detail.fingerprint).toBe(await fingerprint(detail));
    expect(detail.sparks[19]!.sparkId).toBe(oldSparks[25]!.sparkId);
    expect(detail.sparks[25]!.sparkId).toBe(oldSparks[19]!.sparkId);
    expectFieldsFollowSparks(detail);
    expect((await listItems(h, 'resolved')).some((i) => i.id === oldClosed)).toBe(false);
    for (const item of await listItems(h, 'open')) {
      const index = Number(/^\/sparks\/(\d+)\//.exec(item.path)![1]);
      expect(item.field.value).toBe(detail.sparks[index]!.stars);
    }
  });
});

describe('array-restructuring corrections are refused (S2)', () => {
  const UNSAFE = [
    '/sparks',
    '/sparks/3',
    '/sparks/25',
    '/sparks/25/owner',
    '/skills',
    '/skills/2',
    '/deck/0',
    '/deck/0/slot',
    '/parents/0/slot',
    '/parents/1',
    '/parents',
  ];

  it('ingest rejects them as low_confidence paths but stores them as ok provenance', async () => {
    const h = makeHarness();
    for (const path of UNSAFE) {
      const p = await problem(
        await h.call(
          'POST',
          '/veterans',
          await makeCapture((c) => {
            c.fields.push(low(path, null));
          }),
        ),
        422,
      );
      expect(p.errors, path).toEqual([
        expect.objectContaining({
          message: 'a low_confidence field must point at a correctable part of the veteran',
        }),
      ]);
    }
    // Leaf values stay correctable.
    for (const path of ['/sparks/25/stars', '/sparks/3/stars', '/skills/2/level', '/deck/0/lb']) {
      await resetDb();
      const res = await h.call(
        'POST',
        '/veterans',
        await makeCapture((c) => {
          c.fields.push(low(path, null));
        }),
      );
      expect(res.status, path).toBe(201);
    }
    // ok provenance fields are stored as-is (never applied), even for unsafe pointers (N4).
    await resetDb();
    const res = await h.call(
      'POST',
      '/veterans',
      await makeCapture((c) => {
        for (const path of [...UNSAFE, '/__proto__/polluted'])
          c.fields.push({ ...low(path, 'x'), status: 'ok', confidence: 1 });
      }),
    );
    expect(res.status).toBe(201);
    const { veteranId } = IngestResponse.parse(await res.json());
    const detail = await detailOf(h, veteranId);
    expect(detail.fields.filter((f) => UNSAFE.includes(f.path))).toHaveLength(UNSAFE.length);
    expect(await listItems(h)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('resolve refuses an open item on such a path (e.g. created before this rule) and changes nothing', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.fields.push(low('/sparks/25/stars', c.veteran.sparks[25]!.stars));
    });
    const { veteranId } = await ingest(h, capture);
    const target = (await listItems(h, 'open'))[0]!;
    // Legacy rows as a pre-rule ingest could have stored them.
    const legacy = ['/sparks', '/sparks/3', '/sparks/9/owner', '/skills/2'];
    await env.DB.batch(
      legacy.flatMap((path, i) => [
        env.DB.prepare(
          `INSERT INTO capture_fields (veteran_id, path, raw_text, value_json, confidence, status, candidates_json, crop_key)
           VALUES (?, ?, 'x', 'null', 0.3, 'low_confidence', '[]', NULL)`,
        ).bind(veteranId, path),
        env.DB.prepare(
          `INSERT INTO review_items (id, veteran_id, path, status, created_at)
           VALUES (?, ?, ?, 'open', '2026-09-30T00:00:00.000Z')`,
        ).bind(`01J8Z3K4M5N6P7Q8R9S0T1V3A${i}`, veteranId, path),
      ]),
    );
    const before = await detailOf(h, veteranId);
    const values: Record<string, unknown> = {
      '/sparks': capture.veteran.sparks.slice(0, 20),
      '/sparks/3': capture.veteran.sparks[4],
      '/sparks/9/owner': 'parent2',
      '/skills/2': capture.veteran.skills[5],
    };
    for (const [i, path] of legacy.entries()) {
      const p = await problem(
        await h.call('POST', `/review-items/01J8Z3K4M5N6P7Q8R9S0T1V3A${i}/resolve`, {
          value: values[path],
        }),
        422,
      );
      expect(p.errors![0]).toMatchObject({
        path,
        message: 'this field cannot be corrected through a review item',
      });
    }
    expect(await detailOf(h, veteranId)).toEqual(before);
    // The index-based item still targets the same spark.
    expect((await listItems(h, 'open')).find((i) => i.id === target.id)!.path).toBe(
      '/sparks/25/stars',
    );
    expect(before.sparks[25]).toEqual(capture.veteran.sparks[25]);
  });
});
