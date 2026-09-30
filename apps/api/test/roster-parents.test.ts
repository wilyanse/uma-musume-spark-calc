import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { IngestResponse, RosterVeteran, type VeteranCapture } from '@uma/schema';
import { makeCapture, makeHarness, resetDb } from './helpers/harness.ts';

beforeEach(resetDb);

const ingest = async (h: ReturnType<typeof makeHarness>, c: VeteranCapture) =>
  IngestResponse.parse(await (await h.call('POST', '/veterans', c)).json());
const roster = async (h: ReturnType<typeof makeHarness>) =>
  RosterVeteran.array().parse(await (await h.call('GET', '/roster')).json());

describe('GET /roster ETag', () => {
  it('returns [] for an empty roster with an ETag, and 304 on If-None-Match', async () => {
    const h = makeHarness();
    const res = await h.call('GET', '/roster');
    expect(await res.json()).toEqual([]);
    const etag = res.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const cached = await h.call('GET', '/roster', undefined, {
      headers: { 'If-None-Match': etag },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  it('changes after an ingest, a train-mode patch and a delete; is stable otherwise', async () => {
    const h = makeHarness();
    const etags: string[] = [];
    const tag = async () => (await h.call('GET', '/roster')).headers.get('etag')!;
    etags.push(await tag());
    expect(await tag()).toBe(etags[0]);
    h.tick();
    const { veteranId } = await ingest(h, await makeCapture());
    etags.push(await tag());
    h.tick();
    await h.call('PATCH', `/veterans/${veteranId}`, { trainMode: 'manual' });
    etags.push(await tag());
    h.tick();
    await h.call('DELETE', `/veterans/${veteranId}`);
    etags.push(await tag());
    expect(new Set(etags).size).toBe(3);
    // Deleting brings the roster back to empty (3 distinct states), which hashes like the initial one.
    expect(etags[3]).toBe(etags[0]);
  });

  it('serves the new body after a change even when the client sends a stale ETag', async () => {
    const h = makeHarness();
    const stale = (await h.call('GET', '/roster')).headers.get('etag')!;
    h.tick();
    await ingest(h, await makeCapture());
    const res = await h.call('GET', '/roster', undefined, { headers: { 'If-None-Match': stale } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
});

describe('parent matching (40 §4)', () => {
  // The fixture child (McQueen) shows parent1 = Special Week with sparks
  // power★2 (blue), medium★2 (pink), shooting-star★3 (green), ...whites. The candidate parent needs
  // its own self sparks to be a superset of those, so give it exactly that set.
  const asParent = (edit?: (c: VeteranCapture) => void) =>
    makeCapture((c) => {
      const child = structuredClone(c.veteran);
      c.captureId = '01J8Z3K4M5N6P7Q8R9S0T1V2W6';
      c.veteran.characterId = 'character:special-week';
      c.veteran.outfitId = 'outfit:special-week-base';
      c.veteran.stats.spd = 1000;
      c.veteran.parents = [
        {
          slot: 1,
          characterId: 'character:mejiro-mcqueen',
          outfitId: null,
          isGuest: false,
          guestTrainer: null,
        },
        {
          slot: 2,
          characterId: 'character:tm-opera-o',
          outfitId: null,
          isGuest: false,
          guestTrainer: null,
        },
      ];
      c.veteran.sparks = child.sparks
        .filter((s) => s.owner === 'parent1')
        .map((s) => ({ ...s, owner: 'self' as const }));
      // This veteran's own parents' sparks weren't read: flagged, as 01 §3 requires.
      for (const owner of ['parent1', 'parent2']) {
        c.fields.push({
          path: `/sparks/${owner}`,
          rawText: null,
          value: null,
          confidence: 0,
          status: 'low_confidence',
          candidates: [],
          cropKey: null,
        });
      }
      edit?.(c);
    });

  it('links child → parent when exactly one roster veteran matches, whichever arrives first', async () => {
    // child first
    const h = makeHarness();
    const child = await ingest(h, await makeCapture());
    expect((await roster(h))[0]!.parents.map((p) => p.matchedVeteranId)).toEqual([null, null]);
    h.tick();
    const parent = await ingest(h, await asParent());
    const rows = await roster(h);
    const c = rows.find((r) => r.id === child.veteranId)!;
    expect(c.parents.map((p) => p.matchedVeteranId)).toEqual([parent.veteranId, null]);
    // The guest parent (slot 2) is never matched.
    expect(c.parents[1]!.isGuest).toBe(true);
  });

  it('parent first, then child', async () => {
    const h = makeHarness();
    const parent = await ingest(h, await asParent());
    h.tick();
    const child = await ingest(h, await makeCapture());
    const rows = await roster(h);
    const c = rows.find((r) => r.id === child.veteranId)!;
    expect(c.parents[0]!.matchedVeteranId).toBe(parent.veteranId);
  });

  it('does not match when the roster veteran lacks one of the shown sparks', async () => {
    const h = makeHarness();
    await ingest(h, await makeCapture());
    await ingest(
      h,
      await asParent((c) => {
        c.veteran.sparks = c.veteran.sparks.filter((s) => s.sparkId !== 'spark:head-on');
      }),
    );
    expect(
      (await roster(h)).find((r) => r.characterId === 'character:mejiro-mcqueen')!.parents[0]!
        .matchedVeteranId,
    ).toBeNull();
  });

  it('does not match when the star count differs', async () => {
    const h = makeHarness();
    await ingest(h, await makeCapture());
    await ingest(
      h,
      await asParent((c) => {
        c.veteran.sparks.find((s) => s.sparkId === 'spark:power')!.stars = 1;
      }),
    );
    expect(
      (await roster(h)).find((r) => r.characterId === 'character:mejiro-mcqueen')!.parents[0]!
        .matchedVeteranId,
    ).toBeNull();
  });

  it('leaves the match NULL when two roster veterans qualify (ambiguous)', async () => {
    const h = makeHarness();
    await ingest(h, await makeCapture());
    await ingest(h, await asParent());
    h.tick();
    await ingest(
      h,
      await asParent((c) => {
        c.captureId = '01J8Z3K4M5N6P7Q8R9S0T1V2W7';
        c.veteran.stats.spd = 1001; // a different veteran of the same character/outfit
      }),
    );
    const child = (await roster(h)).find((r) => r.characterId === 'character:mejiro-mcqueen')!;
    expect(child.parents[0]!.matchedVeteranId).toBeNull();
  });

  it('a match change alone moves the roster ETag (trigger bumps the child updated_at)', async () => {
    const h = makeHarness();
    await ingest(h, await makeCapture());
    const before = (await h.call('GET', '/roster')).headers.get('etag');
    // Same wall-clock: only the parent's arrival changes the child's match, and the count also
    // changes, so compare the child's stamp directly.
    const stamp = () =>
      env.DB.prepare('SELECT updated_at FROM veterans WHERE character_id = ?')
        .bind('character:mejiro-mcqueen')
        .first<{ updated_at: string }>();
    const t0 = (await stamp())!.updated_at;
    await ingest(h, await asParent());
    expect((await stamp())!.updated_at > t0).toBe(true);
    expect((await h.call('GET', '/roster')).headers.get('etag')).not.toBe(before);
  });

  it('clears the link when the matched parent is deleted', async () => {
    const h = makeHarness();
    await ingest(h, await makeCapture());
    const parent = await ingest(h, await asParent());
    h.tick();
    await h.call('DELETE', `/veterans/${parent.veteranId}`);
    const child = (await roster(h))[0]!;
    expect(child.parents[0]!.matchedVeteranId).toBeNull();
  });

  it('never matches a parent whose sparks were unreadable', async () => {
    const h = makeHarness();
    await ingest(h, await asParent());
    const flagged = await makeCapture((c) => {
      c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== 'parent1');
      c.fields.push({
        path: '/sparks/parent1',
        rawText: null,
        value: null,
        confidence: 0,
        status: 'low_confidence',
        candidates: [],
        cropKey: null,
      });
    });
    await ingest(h, flagged);
    const child = (await roster(h)).find((r) => r.characterId === 'character:mejiro-mcqueen')!;
    expect(child.parents[0]!.matchedVeteranId).toBeNull();
  });
});
