/**
 * Data layer against MOCK HTTP (an in-test fetch double; labelled, no live API or Cloudflare):
 * ETag/304 roster caching, problem+json errors, snapshot 404 → null, crop URLs; master data
 * latest.json → sha256-checked files cached with an in-memory Cache API double; fixture source
 * isolation.
 */
import { describe, expect, it } from 'vitest';
import { httpSource } from '../src/api/http.ts';
import { HttpError, NetworkError, errorText } from '../src/api/errors.ts';
import { fixtureSource } from '../src/api/fixture.ts';
import { loadMaster, MasterDataError, type CacheLike } from '../src/master/load.ts';
import { goldenRoster, goldenTargets, latest, latestBytes, masterFileBytes } from './fixtures.ts';

type Call = { url: string; init?: RequestInit };

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

describe('httpSource (MOCK HTTP)', () => {
  it('roster: stores the ETag, sends If-None-Match, and returns the cached array on 304', async () => {
    const roster = goldenRoster().slice(0, 2);
    const { fn, calls } = mockFetch((_u, init) => {
      const inm = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
      if (inm === '"r1"') return new Response(null, { status: 304, headers: { ETag: '"r1"' } });
      return new Response(JSON.stringify(roster), { status: 200, headers: { ETag: '"r1"' } });
    });
    const s = httpSource(fn);
    const first = await s.roster();
    expect(first).toMatchObject({ etag: '"r1"', notModified: false });
    const second = await s.roster({ etag: first.etag!, roster: first.roster });
    expect(second.notModified).toBe(true);
    expect(second.roster).toBe(first.roster);
    expect(calls[0]!.init?.credentials).toBe('include');
    expect((calls[1]!.init?.headers as Record<string, string>)['If-None-Match']).toBe('"r1"');
  });

  it('turns problem+json into HttpError with the problem body', async () => {
    const { fn } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ title: 'Conflict', status: 409, detail: 'The corrected veteran duplicates an existing one' }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    );
    const err = await httpSource(fn).resolveReviewItem('01KGQZ0000G01DENCM00000001', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).problem?.detail).toMatch(/duplicates/);
  });

  it('a fetch rejection is a NetworkError with the copy.md text', async () => {
    const s = httpSource(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await s.ownedCards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(errorText(err)).toBe("Couldn't reach the server. Check your connection and retry.");
    expect(errorText(new HttpError(401, null, 'x'))).toMatch(/session has expired/);
  });

  it('latestSnapshot: 404 is "no snapshot yet" (null); kind filter is passed through', async () => {
    const { fn, calls } = mockFetch(() => new Response('{"status":404}', { status: 404 }));
    expect(await httpSource(fn).latestSnapshot('training-v2')).toBeNull();
    expect(calls[0]!.url).toBe('/api/v1/model-snapshots?kind=training-v2');
  });

  it('owned cards are the array the API returns (Q-71)', async () => {
    const rows = [{ cardId: 'card:x', lb: 4, level: 50, confidence: 1, syncedAt: '2026-09-27T21:14:00.000Z' }];
    const { fn } = mockFetch(() => new Response(JSON.stringify(rows)));
    expect(await httpSource(fn).ownedCards()).toEqual(rows);
  });

  it('crop URL keeps the stored key verbatim', () => {
    expect(httpSource().cropUrl('crops/01KGQZ0000G01DENCM00000001/%2Fstats%2Fgut.png')).toBe(
      '/api/v1/crops/crops/01KGQZ0000G01DENCM00000001/%2Fstats%2Fgut.png',
    );
  });
});

function memoryCache(): CacheLike & { store: Map<string, ArrayBuffer> } {
  const store = new Map<string, ArrayBuffer>();
  return {
    store,
    match: async (u) => (store.has(u) ? new Response(store.get(u)!.slice(0)) : undefined),
    put: async (u, r) => void store.set(u, await r.arrayBuffer()),
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (u) => store.delete(u),
  };
}

function masterFetch(tamper?: string) {
  return mockFetch((url) => {
    if (url === '/master/latest.json') return new Response(new Uint8Array(latestBytes()));
    const file = url.split('/').pop()!;
    const bytes = masterFileBytes(file);
    return new Response(new Uint8Array(file === tamper ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes));
  });
}

describe('master data loader', () => {
  it('fetches latest.json (revalidated), checks every sha256, caches, then serves from cache', async () => {
    const cache = memoryCache();
    cache.store.set('http://t/master/old-version/skills.json', new ArrayBuffer(1));
    const first = masterFetch();
    const m1 = await loadMaster({ fetch: first.fn, cache, origin: 'http://t' });
    expect(m1.version).toBe(latest.version);
    expect(first.calls[0]).toMatchObject({ url: '/master/latest.json', init: { cache: 'no-cache' } });
    expect(Object.values(m1.sources).every((s) => s === 'network')).toBe(true);
    expect([...cache.store.keys()].some((k) => k.includes('old-version'))).toBe(false);
    const second = masterFetch();
    const m2 = await loadMaster({ fetch: second.fn, cache, origin: 'http://t' });
    expect(Object.values(m2.sources).every((s) => s === 'cache')).toBe(true);
    expect(second.calls).toHaveLength(1); // only latest.json
    expect(m2.outfits.size).toBe(m1.outfits.size);
  });

  it('a file that does not match its published sha256 is rejected', async () => {
    const err = await loadMaster({ fetch: masterFetch('rules.json').fn, cache: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MasterDataError);
    expect((err as Error).message).toMatch(/rules\.json: sha256/);
  });
});

describe('fixtureSource (SYNTHETIC golden fixtures, MOCK writes)', () => {
  const files: Record<string, unknown> = { roster: goldenRoster(), 'cm-targets': goldenTargets() };
  const fetchFixture = async (u: string) => {
    const name = u.replace('/fixtures/', '').replace('.json', '');
    return name in files ? new Response(JSON.stringify(files[name])) : new Response('', { status: 404 });
  };
  const make = () =>
    fixtureSource({
      fetch: fetchFixture,
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      random: () => 0.5,
      masterVersion: async () => latest.version,
    });

  it('serves the golden roster with an ETag that changes after a mock write', async () => {
    const s = make();
    const r1 = await s.roster();
    expect(r1.roster).toHaveLength(260);
    const r2 = await s.roster({ etag: r1.etag!, roster: r1.roster });
    expect(r2.notModified).toBe(true);
    const id = r1.roster[0]!.id;
    const patched = await s.patchVeteran(id, { trainMode: 'manual' });
    expect(patched).toMatchObject({ trainMode: 'manual', modeSource: 'override', fields: [] });
    const r3 = await s.roster({ etag: r1.etag!, roster: r1.roster });
    expect(r3.notModified).toBe(false);
  });

  it('target CRUD is an isolated in-memory mock (never reaches the fixture file)', async () => {
    const s = make();
    const t = await s.createTarget({ ...goldenTargets()[0]!, id: undefined, name: 'mine' });
    expect(t.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect((await s.targets()).map((x) => x.name)).toEqual(['golden-cm-1', 'mine']);
    await s.deleteTarget(t.id);
    expect(await make().targets()).toHaveLength(1); // a fresh source starts from the file again
    expect(files['cm-targets']).toHaveLength(1);
  });

  it('has no review items, crops or owned cards (none in the golden data)', async () => {
    const s = make();
    expect(await s.reviewItems('open')).toEqual([]);
    expect(await s.ownedCards()).toEqual([]);
    expect(s.cropUrl('crops/x')).toBeNull();
  });
});
