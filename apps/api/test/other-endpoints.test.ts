import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { CmTarget, ModelSnapshot, OWNED_CARDS_SYNC_RULES, type OwnedCardsSync } from '@uma/schema';
import { makeHarness, problem, resetDb } from './helpers/harness.ts';

beforeEach(resetDb);

const sync = (over: Partial<OwnedCardsSync> = {}): OwnedCardsSync => ({
  schemaVersion: 1,
  capturedAt: '2026-09-30T00:00:00Z',
  masterVersion: 'test-1',
  heldCount: 2,
  cards: [
    { cardId: 'card:fixture-card-1', lb: 4, level: 50, confidence: 0.99 },
    { cardId: 'card:kitasan-black-ssr', lb: 0, level: 1, confidence: 0.9 },
  ],
  ...over,
});

describe('owned cards (01 §4)', () => {
  it('syncs, lists, and replaces the whole table on the next sync', async () => {
    const h = makeHarness();
    expect((await h.call('GET', '/owned-cards')).status).toBe(200);
    const res = await h.call('PUT', '/owned-cards', sync());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 2, partial: false });
    const list = (await (await h.call('GET', '/owned-cards')).json()) as {
      cardId: string;
      lb: number;
    }[];
    expect(list.map((c) => c.cardId)).toEqual(['card:fixture-card-1', 'card:kitasan-black-ssr']);

    await h.call(
      'PUT',
      '/owned-cards',
      sync({
        heldCount: 1,
        cards: [{ cardId: 'card:fixture-card-2', lb: 1, level: 20, confidence: 1 }],
      }),
    );
    const after = (await (await h.call('GET', '/owned-cards')).json()) as { cardId: string }[];
    expect(after.map((c) => c.cardId)).toEqual(['card:fixture-card-2']);
  });

  it('rejects cards.length != heldCount with the contract message verbatim, and keeps the old table', async () => {
    const h = makeHarness();
    await h.call('PUT', '/owned-cards', sync());
    const p = await problem(await h.call('PUT', '/owned-cards', sync({ heldCount: 3 })), 422);
    expect(p.errors![0]).toEqual({
      path: '/heldCount',
      message: OWNED_CARDS_SYNC_RULES[1].message,
    });
    const list = (await (await h.call('GET', '/owned-cards')).json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it('accepts a mismatch with ?partial=1', async () => {
    const h = makeHarness();
    const res = await h.call('PUT', '/owned-cards?partial=1', sync({ heldCount: 200 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 2, partial: true });
  });

  it('rejects duplicate cardIds, unknown card IDs and unknown master versions', async () => {
    const h = makeHarness();
    const dup = sync({ cards: [sync().cards[0]!, sync().cards[0]!] });
    const p1 = await problem(await h.call('PUT', '/owned-cards', dup), 422);
    expect(p1.errors![0]!.message).toBe(OWNED_CARDS_SYNC_RULES[0].message);
    const p2 = await problem(
      await h.call(
        'PUT',
        '/owned-cards',
        sync({ heldCount: 1, cards: [{ ...sync().cards[0]!, cardId: 'card:zzz' }] }),
      ),
      422,
    );
    expect(p2.errors![0]).toMatchObject({ path: '/cards/0/cardId', id: 'card:zzz' });
    await problem(await h.call('PUT', '/owned-cards', sync({ masterVersion: 'nope' })), 422);
  });

  it('an empty sync with heldCount 0 clears the table', async () => {
    const h = makeHarness();
    await h.call('PUT', '/owned-cards', sync());
    expect((await h.call('PUT', '/owned-cards', sync({ heldCount: 0, cards: [] }))).status).toBe(
      200,
    );
    expect(await (await h.call('GET', '/owned-cards')).json()).toEqual([]);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const CAPTURE = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';

describe('crops (01 §8)', () => {
  it('uploads a PNG and downloads it by the returned key', async () => {
    const h = makeHarness();
    const up = await h.call(
      'PUT',
      `/crops/${CAPTURE}?path=${encodeURIComponent('/stats/spd')}`,
      PNG,
    );
    expect(up.status).toBe(200);
    const { cropKey } = (await up.json()) as { cropKey: string };
    expect(cropKey).toBe(`crops/${CAPTURE}/%2Fstats%2Fspd.png`);
    const down = await h.call('GET', `/crops/${cropKey}`);
    expect(down.status).toBe(200);
    expect(down.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await down.arrayBuffer())).toEqual(PNG);
    // The key also works as one encoded path segment.
    expect((await h.call('GET', `/crops/${encodeURIComponent(cropKey)}`)).status).toBe(200);
  });

  it('rejects oversize, non-PNG, bad ids and bad paths; 404s for missing crops', async () => {
    const h = makeHarness();
    const big = new Uint8Array(60 * 1024 + 1);
    big.set(PNG);
    await problem(await h.call('PUT', `/crops/${CAPTURE}?path=%2Fa`, big), 413);
    await problem(
      await h.call(
        'PUT',
        `/crops/${CAPTURE}?path=%2Fa`,
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      ),
      415,
    );
    await problem(await h.call('PUT', `/crops/not-a-ulid?path=%2Fa`, PNG), 422);
    await problem(await h.call('PUT', `/crops/${CAPTURE}?path=nope`, PNG), 422);
    await problem(await h.call('PUT', `/crops/${CAPTURE}`, PNG), 422);
    await problem(await h.call('GET', `/crops/crops/${CAPTURE}/missing.png`), 404);
    await problem(await h.call('GET', '/crops/crops/..%2F..%2Fsecret'), 400);
    await problem(await h.call('GET', '/crops/etc/passwd'), 400);
  });

  it('accepts exactly 60 KB', async () => {
    const h = makeHarness();
    const max = new Uint8Array(60 * 1024);
    max.set(PNG);
    expect((await h.call('PUT', `/crops/${CAPTURE}?path=%2Fa`, max)).status).toBe(200);
  });
});

const target = (over: Record<string, unknown> = {}) => ({
  name: 'Libra Cup',
  course: { surface: 'turf', distance: 'medium', meters: 2000 },
  style: 'pace',
  minStats: { spd: 1000, sta: 800 },
  minAptitudes: { turf: 'A', medium: 'A', pace: 'A' },
  requiredSkills: ['skill:hydrate'],
  optionalSkills: [{ skillId: 'skill:groundwork', weight: 2 }],
  ...over,
});

describe('cm-targets (01 §10)', () => {
  it('CRUD round-trips a CmTarget', async () => {
    const h = makeHarness();
    const created = await h.call('POST', '/cm-targets', target());
    expect(created.status).toBe(201);
    const t = CmTarget.parse(await created.json());
    expect(t.name).toBe('Libra Cup');

    expect(CmTarget.parse(await (await h.call('GET', `/cm-targets/${t.id}`)).json())).toEqual(t);
    expect(CmTarget.array().parse(await (await h.call('GET', '/cm-targets')).json())).toEqual([t]);

    const put = await h.call(
      'PUT',
      `/cm-targets/${t.id}`,
      target({ name: 'Renamed', style: 'late' }),
    );
    expect(CmTarget.parse(await put.json())).toMatchObject({
      id: t.id,
      name: 'Renamed',
      style: 'late',
    });
    expect(CmTarget.parse(await (await h.call('GET', `/cm-targets/${t.id}`)).json()).style).toBe(
      'late',
    );

    expect((await h.call('DELETE', `/cm-targets/${t.id}`)).status).toBe(204);
    await problem(await h.call('GET', `/cm-targets/${t.id}`), 404);
    await problem(await h.call('DELETE', `/cm-targets/${t.id}`), 404);
  });

  it('validates bodies, honours a client ULID once, and guards id mismatches', async () => {
    const h = makeHarness();
    await problem(await h.call('POST', '/cm-targets', target({ style: 'sprint' })), 422);
    await problem(await h.call('POST', '/cm-targets', target({ minStats: { spd: 5000 } })), 422);
    const id = '01J8Z3K4M5N6P7Q8R9S0T1V2WA';
    expect((await h.call('POST', '/cm-targets', target({ id }))).status).toBe(201);
    await problem(await h.call('POST', '/cm-targets', target({ id })), 409);
    await problem(
      await h.call('PUT', `/cm-targets/${id}`, target({ id: '01J8Z3K4M5N6P7Q8R9S0T1V2WB' })),
      422,
    );
    await problem(await h.call('PUT', '/cm-targets/01J8Z3K4M5N6P7Q8R9S0T1V2WC', target()), 404);
  });
});

const snapshot = (id: string, trainedAt: string, nSamples = 100): ModelSnapshot => {
  const stat = { coef: [0.1], intercept: 1, sigma: 2 };
  const beta = { '*': { a: 1, b: 1 } };
  return {
    id,
    kind: 'training-v1',
    masterVersion: 'test-1',
    trainedAt,
    nSamples,
    params: {
      features: ['x'],
      perStat: { spd: stat, sta: stat, pow: stat, gut: stat, wit: stat },
      residualCov: Array.from({ length: 5 }, (_, i) =>
        Array.from({ length: 5 }, (_, j) => (i === j ? 1 : 0)),
      ),
      skillAcquire: { independent: beta, manual: beta },
      holdout: { mae: { spd: 1, sta: 1, pow: 1, gut: 1, wit: 1 }, coverage80: 0.8 },
    },
  };
};

describe('model-snapshots (01 §13)', () => {
  it('404s when empty, stores snapshots, returns the latest by trainedAt', async () => {
    const h = makeHarness();
    await problem(await h.call('GET', '/model-snapshots'), 404);
    const older = snapshot('01J8Z3K4M5N6P7Q8R9S0T1V2W1', '2026-09-01T00:00:00Z', 10);
    const newer = snapshot('01J8Z3K4M5N6P7Q8R9S0T1V2W2', '2026-09-02T00:00:00Z', 20);
    expect((await h.call('POST', '/model-snapshots', newer)).status).toBe(201);
    expect((await h.call('POST', '/model-snapshots', older)).status).toBe(201);
    const latest = ModelSnapshot.parse(await (await h.call('GET', '/model-snapshots')).json());
    expect(latest).toEqual(newer);
    expect(
      ModelSnapshot.parse(await (await h.call('GET', '/model-snapshots?kind=training-v1')).json())
        .id,
    ).toBe(newer.id);
    await problem(await h.call('GET', '/model-snapshots?kind=other'), 422);
    await problem(await h.call('POST', '/model-snapshots', newer), 409);
    await problem(await h.call('POST', '/model-snapshots', { ...newer, nSamples: -1 }), 422);
  });

  it('prunes to the newest 20 per kind', async () => {
    const h = makeHarness();
    for (let i = 0; i < 22; i++) {
      const id = `01J8Z3K4M5N6P7Q8R9S0T1V${String(i).padStart(3, '0')}`;
      const day = String(i + 1).padStart(2, '0');
      await h.call('POST', '/model-snapshots', snapshot(id, `2026-08-${day}T00:00:00Z`));
    }
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM model_snapshots').first<{ n: number }>();
    expect(n!.n).toBe(20);
    const latest = ModelSnapshot.parse(await (await h.call('GET', '/model-snapshots')).json());
    expect(latest.trainedAt).toBe('2026-08-22T00:00:00Z');
  });
});
