import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IngestResponse,
  RosterVeteran,
  RosterVeteranDetail,
  RULE,
  type VeteranCapture,
} from '@uma/schema';
import mcqueen from './fixtures/mcqueen.json' with { type: 'json' };
import {
  barrierEnv,
  countingEnv,
  makeCapture,
  makeHarness,
  problem,
  resetDb,
} from './helpers/harness.ts';

beforeEach(resetDb);

const roster = async (h = makeHarness()) =>
  RosterVeteran.array().parse(await (await h.call('GET', '/roster')).json());

describe('POST /veterans — golden ingest (fixture from the McQueen screenshots)', () => {
  it('creates the veteran (201) and the roster returns exactly the captured veteran', async () => {
    const h = makeHarness();
    const capture = await makeCapture();
    const res = await h.call('POST', '/veterans', capture);
    expect(res.status).toBe(201);
    const body = IngestResponse.parse(await res.json());
    expect(body.created).toBe(true);
    expect(body.reviewItemIds).toBeUndefined();

    const [v] = await roster(h);
    const { id, fingerprint, modeSource, minConfidence, hasLowConfidence, capturedAt, ...veteran } = v!;
    expect(id).toBe(body.veteranId);
    expect(fingerprint).toBe(capture.fingerprint);
    expect(modeSource).toBe('epithet');
    expect(capturedAt).toBe(capture.capturedAt);
    expect(minConfidence).toBe(0.99);
    expect(hasLowConfidence).toBe(false); // T17: emitted on every row, derived from field status
    // Everything else round-trips, including array order (sparks/skills), booleans and nulls.
    expect(veteran).toEqual({
      ...capture.veteran,
      parents: capture.veteran.parents.map((p) => ({ ...p, matchedVeteranId: null })),
    });
    expect(veteran.stats).toEqual({ spd: 894, sta: 938, pow: 740, gut: 559, wit: 635 });
    expect(veteran.deck[5]!.borrowed).toBe(true);
    expect(veteran.parents[1]).toMatchObject({ isGuest: true, guestTrainer: 'Yuuki' });
    expect(veteran.skills[0]).toEqual({ skillId: 'skill:the-duty-of-dignity-calls', level: 5 });
  });

  it('GET /veterans/:id returns the veteran plus its fields', async () => {
    const h = makeHarness();
    const { veteranId } = IngestResponse.parse(
      await (await h.call('POST', '/veterans', await makeCapture())).json(),
    );
    const res = await h.call('GET', `/veterans/${veteranId}`);
    const detail = RosterVeteranDetail.parse(await res.json());
    expect(detail.fields.map((f) => f.path)).toContain('/stats/spd');
    expect(detail.fields.find((f) => f.path === '/rating')).toMatchObject({
      rawText: '13,471',
      value: 13471,
      status: 'ok',
    });
    await problem(await h.call('GET', '/veterans/01J8Z3K4M5N6P7Q8R9S0T1V2W9'), 404);
  });

  it('derives train mode from the epithet on the server (01 §6)', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.veteran.epithet = ' independent LEARNER ';
      c.veteran.trainMode = 'manual';
    });
    await h.call('POST', '/veterans', capture);
    expect((await roster(h))[0]!.trainMode).toBe('independent');
    const other = await makeCapture((c) => {
      c.veteran.epithet = 'Champion';
      c.veteran.stats.spd = 901;
    });
    await h.call('POST', '/veterans', other);
    const modes = (await roster(h)).map((v) => [v.stats.spd, v.trainMode]);
    expect(modes).toContainEqual([901, 'manual']);
  });
});

describe('POST /veterans — idempotency and overrides', () => {
  it('re-ingesting the same fingerprint returns 200 created:false and updates the fields', async () => {
    const h = makeHarness();
    const first = IngestResponse.parse(
      await (await h.call('POST', '/veterans', await makeCapture())).json(),
    );
    h.tick();
    const again = await makeCapture((c) => {
      c.captureId = '01J8Z3K4M5N6P7Q8R9S0T1V2W5';
      c.capturedAt = '2026-09-30T01:00:00Z';
      c.veteran.rating = 13999; // not part of the fingerprint
      c.veteran.skills.pop();
    });
    const res = await h.call('POST', '/veterans', again);
    expect(res.status).toBe(200);
    expect(IngestResponse.parse(await res.json())).toEqual({
      veteranId: first.veteranId,
      created: false,
    });

    const rows = await roster(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(13999);
    expect(rows[0]!.skills).toHaveLength(13);
    expect(rows[0]!.capturedAt).toBe('2026-09-30T01:00:00Z');
    const counts = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM veteran_sparks) sp, (SELECT COUNT(*) FROM veteran_deck) dk, (SELECT COUNT(*) FROM capture_fields) f',
    ).first<{ sp: number; dk: number; f: number }>();
    expect(counts).toEqual({ sp: mcqueen.veteran.sparks.length, dk: 6, f: mcqueen.fields.length });
  });

  it('a manual train-mode override survives a later capture', async () => {
    const h = makeHarness();
    const { veteranId } = IngestResponse.parse(
      await (await h.call('POST', '/veterans', await makeCapture())).json(),
    );
    const patched = await h.call('PATCH', `/veterans/${veteranId}`, { trainMode: 'manual' });
    expect(patched.status).toBe(200);
    const detail = RosterVeteranDetail.parse(await patched.json());
    expect(detail).toMatchObject({ trainMode: 'manual', modeSource: 'override' });

    const res = await h.call('POST', '/veterans', await makeCapture());
    expect(res.status).toBe(200);
    expect((await roster(h))[0]).toMatchObject({ trainMode: 'manual', modeSource: 'override' });
  });

  it('PATCH validates its body and 404s for unknown veterans', async () => {
    const h = makeHarness();
    await problem(
      await h.call('PATCH', '/veterans/01J8Z3K4M5N6P7Q8R9S0T1V2W9', { trainMode: 'manual' }),
      404,
    );
    await problem(
      await h.call('PATCH', '/veterans/01J8Z3K4M5N6P7Q8R9S0T1V2W9', { trainMode: 'auto' }),
      422,
    );
    await problem(await h.call('PATCH', '/veterans/x', { nope: 1 }), 422);
  });

  it('DELETE removes the veteran, its child rows and its crops, then 404s', async () => {
    const h = makeHarness();
    await env.CROPS.put('crops/01J8Z3K4M5N6P7Q8R9S0T1V2W3/%2Fstats%2Fspd.png', new Uint8Array([1]));
    const capture = await makeCapture((c) => {
      c.fields[0]!.cropKey = 'crops/01J8Z3K4M5N6P7Q8R9S0T1V2W3/%2Fstats%2Fspd.png';
    });
    const { veteranId } = IngestResponse.parse(
      await (await h.call('POST', '/veterans', capture)).json(),
    );
    const res = await h.call('DELETE', `/veterans/${veteranId}`);
    expect(res.status).toBe(204);
    expect(await roster(h)).toEqual([]);
    for (const t of [
      'veteran_skills',
      'veteran_sparks',
      'veteran_deck',
      'veteran_parents',
      'capture_fields',
    ]) {
      const r = await env.DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first<{ n: number }>();
      expect(r!.n, t).toBe(0);
    }
    expect((await env.CROPS.list()).objects).toHaveLength(0);
    await problem(await h.call('DELETE', `/veterans/${veteranId}`), 404);
  });
});

describe('POST /veterans — validation (422) and problem+json', () => {
  it('rejects a schema violation with per-field errors', async () => {
    const h = makeHarness();
    const capture = await makeCapture(
      (c) => {
        c.veteran.stats.spd = 0;
      },
      { refingerprint: false },
    );
    const p = await problem(await h.call('POST', '/veterans', capture), 422);
    expect(p.errors!.some((e) => e.path === '/veteran/stats/spd')).toBe(true);
  });

  it('rejects a non-JSON body with 400', async () => {
    const h = makeHarness();
    const res = await h.call('POST', '/veterans', undefined, { body: 'nope' });
    await problem(res, 400);
  });

  it('rejects a fingerprint that does not match the payload', async () => {
    const h = makeHarness();
    const capture = await makeCapture(
      (c) => {
        c.veteran.stats.spd = 895;
      },
      { refingerprint: false },
    );
    const p = await problem(await h.call('POST', '/veterans', capture), 422);
    expect(p.title).toBe('Unprocessable Content');
    expect(p.detail).toBe('Fingerprint mismatch');
    expect(p.errors![0]!.path).toBe('/fingerprint');
    expect((await roster(h)).length).toBe(0);
  });

  it('rejects parents that break the parent rules, with the contract message verbatim', async () => {
    const h = makeHarness();
    const same = await makeCapture((c) => {
      c.veteran.parents[1]!.characterId = c.veteran.parents[0]!.characterId;
    });
    const p1 = await problem(await h.call('POST', '/veterans', same), 422);
    expect(p1.errors!.map((e) => e.message)).toContain(RULE.parentsDiffer);

    const self = await makeCapture((c) => {
      c.veteran.parents[0]!.characterId = c.veteran.characterId;
    });
    const p2 = await problem(await h.call('POST', '/veterans', self), 422);
    expect(p2.errors!.map((e) => e.message)).toContain(RULE.parentNotSelf);
  });

  it('rejects unreadable parent sparks that are not flagged, accepts them when flagged', async () => {
    const h = makeHarness();
    const unflagged = await makeCapture((c) => {
      c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== 'parent2');
    });
    const p = await problem(await h.call('POST', '/veterans', unflagged), 422);
    expect(p.errors![0]!.message).toBe(`${RULE.parentSparksUnreadable} (owner parent2)`);

    const flagged = await makeCapture((c) => {
      c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== 'parent2');
      c.fields.push({
        path: '/sparks/parent2',
        rawText: null,
        value: null,
        confidence: 0,
        status: 'low_confidence',
        candidates: [],
        cropKey: null,
      });
    });
    const res = await h.call('POST', '/veterans', flagged);
    expect(res.status).toBe(201);
    const body = IngestResponse.parse(await res.json());
    expect(body.reviewItemIds).toHaveLength(1);
    const items = (await (await h.call('GET', '/review-items?status=open')).json()) as {
      path: string;
    }[];
    expect(items.map((i) => i.path)).toEqual(['/sparks/parent2']);
  });

  it('returns unknown master IDs as {kind, path, id} (T01b hand-off) and stores nothing', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.veteran.skills[1]!.skillId = 'skill:does-not-exist';
      c.veteran.deck[2]!.cardId = 'card:nope';
      c.veteran.rank = 'ZZ';
    });
    const p = await problem(await h.call('POST', '/veterans', capture), 422);
    expect(p.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ranks', id: 'ZZ', path: '/veteran/rank' }),
        expect.objectContaining({
          kind: 'skills',
          id: 'skill:does-not-exist',
          path: '/veteran/skills/1/skillId',
        }),
        expect.objectContaining({ kind: 'cards', id: 'card:nope', path: '/veteran/deck/2/cardId' }),
      ]),
    );
    expect(p.errors).toHaveLength(3);
    expect(await roster(h)).toEqual([]);
  });

  it('rejects an unknown masterVersion', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.masterVersion = 'nope-9';
    });
    const p = await problem(await h.call('POST', '/veterans', capture), 422);
    expect(p.errors![0]!.path).toBe('/masterVersion');
  });

  it('rejects duplicate skills, duplicate field paths and malformed crop keys', async () => {
    const h = makeHarness();
    const dupSkill = await makeCapture((c) => {
      c.veteran.skills.push({ ...c.veteran.skills[1]! });
    });
    expect((await problem(await h.call('POST', '/veterans', dupSkill), 422)).errors![0]!.path).toBe(
      '/veteran/skills/14/skillId',
    );
    const dupField = await makeCapture((c) => {
      c.fields.push({ ...c.fields[0]! });
    });
    expect((await problem(await h.call('POST', '/veterans', dupField), 422)).errors![0]!.path).toBe(
      `/fields/${mcqueen.fields.length}/path`,
    );
    const badCrop = await makeCapture((c) => {
      c.fields[0]!.cropKey = '../../etc/passwd';
    });
    expect((await problem(await h.call('POST', '/veterans', badCrop), 422)).errors![0]!.path).toBe(
      '/fields/0/cropKey',
    );
  });
});

describe('review items created at ingest', () => {
  const lowSpd = (c: VeteranCapture) => {
    c.fields[0] = {
      path: '/stats/spd',
      rawText: '8g4',
      value: 894,
      confidence: 0.4,
      status: 'low_confidence',
      candidates: [
        { value: 894, score: 0.6 },
        { value: 884, score: 0.3 },
      ],
      cropKey: null,
    };
  };

  it('creates one open item per low-confidence path and does not duplicate it on re-ingest', async () => {
    const h = makeHarness();
    const first = IngestResponse.parse(
      await (await h.call('POST', '/veterans', await makeCapture(lowSpd))).json(),
    );
    expect(first.reviewItemIds).toHaveLength(1);
    const again = IngestResponse.parse(
      await (await h.call('POST', '/veterans', await makeCapture(lowSpd))).json(),
    );
    expect(again.created).toBe(false);
    expect(again.reviewItemIds).toEqual(first.reviewItemIds);
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM review_items').first<{ n: number }>();
    expect(n!.n).toBe(1);
    expect((await roster(h))[0]!).toMatchObject({ minConfidence: 0.4, hasLowConfidence: true });
  });
});

describe('concurrent identical ingests (B1)', () => {
  const counts = async () => {
    const q = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
    return {
      veterans: await q('SELECT COUNT(*) n FROM veterans'),
      orphanChildren: await q(
        `SELECT (SELECT COUNT(*) FROM veteran_skills WHERE veteran_id NOT IN (SELECT id FROM veterans))
              + (SELECT COUNT(*) FROM veteran_sparks WHERE veteran_id NOT IN (SELECT id FROM veterans))
              + (SELECT COUNT(*) FROM veteran_deck WHERE veteran_id NOT IN (SELECT id FROM veterans))
              + (SELECT COUNT(*) FROM veteran_parents WHERE veteran_id NOT IN (SELECT id FROM veterans))
              + (SELECT COUNT(*) FROM capture_fields WHERE veteran_id NOT IN (SELECT id FROM veterans)) AS n`,
      ),
      orphanReviews: await q(
        'SELECT COUNT(*) n FROM review_items WHERE veteran_id NOT IN (SELECT id FROM veterans)',
      ),
      reviews: await q('SELECT COUNT(*) n FROM review_items'),
      sparks: await q('SELECT COUNT(*) n FROM veteran_sparks'),
    };
  };

  it('Promise.all of identical POSTs: one veteran, no orphans, one review set, ≤ 1 created:true', async () => {
    const h = makeHarness();
    const capture = await makeCapture((c) => {
      c.fields[0]!.status = 'low_confidence';
    });
    const single = makeHarness();
    await single.call('POST', '/veterans', capture);
    const expectedSparks = (await counts()).sparks;
    await resetDb();

    const responses = await Promise.all([1, 2, 3].map(() => h.call('POST', '/veterans', capture)));
    const bodies = await Promise.all(
      responses.map((r) => r.json().then((b) => IngestResponse.parse(b))),
    );
    expect(bodies.filter((b) => b.created).length).toBeLessThanOrEqual(1);
    expect(responses.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(responses.filter((r) => r.status === 201).length).toBe(
      bodies.filter((b) => b.created).length,
    );
    const stored = await env.DB.prepare('SELECT id FROM veterans').all<{ id: string }>();
    expect(stored.results).toHaveLength(1);
    for (const b of bodies) expect(b.veteranId).toBe(stored.results[0]!.id);
    const c = await counts();
    expect(c).toMatchObject({ veterans: 1, orphanChildren: 0, orphanReviews: 0, reviews: 1 });
    expect(c.sparks).toBe(expectedSparks);
    // Every returned review id is the one persisted open item.
    const items = await env.DB.prepare('SELECT id FROM review_items').all<{ id: string }>();
    for (const b of bodies) expect(b.reviewItemIds).toEqual([items.results[0]!.id]);
    const open = await (await h.call('GET', '/review-items?status=open')).json();
    expect(open).toHaveLength(1);
  });
});

describe('D1 statement budget (40 §4)', () => {
  it('ingest uses ≤ 15 statements (create and re-ingest with review items), roster ≤ 6', async () => {
    const counted = countingEnv(env);
    const h = makeHarness({}, counted.env);
    const capture = await makeCapture((c) => {
      c.fields[0]!.status = 'low_confidence';
    });
    counted.reset();
    expect((await h.call('POST', '/veterans', capture)).status).toBe(201);
    const create = counted.count();
    counted.reset();
    expect((await h.call('POST', '/veterans', capture)).status).toBe(200);
    const reingest = counted.count();
    counted.reset();
    expect((await h.call('GET', '/roster')).status).toBe(200);
    const rosterRead = counted.count();
    console.log(`statements: create=${create} re-ingest=${reingest} roster=${rosterRead}`);
    expect(create).toBeLessThanOrEqual(15);
    expect(reingest).toBeLessThanOrEqual(15);
    expect(rosterRead).toBeLessThanOrEqual(6);
    expect(create).toBeGreaterThan(5);
    expect(create).toBeLessThanOrEqual(15); // guards against the counter silently counting nothing
  });

  it('worst-case resolve (owner replacement with remap) and PATCH stay ≤ 50 statements (T04b r1 S3)', async () => {
    const counted = countingEnv(env);
    const h = makeHarness({}, counted.env);
    // Every child table non-empty, a shrinking parent1 block (10 → 3) so the remap statement runs,
    // plus an index-based item after the block that it moves.
    const capture = await makeCapture((c) => {
      for (const path of ['/sparks/parent1', '/sparks/25/stars']) {
        c.fields.push({
          path,
          rawText: null,
          value: null,
          confidence: 0.2,
          status: 'low_confidence',
          candidates: [],
          cropKey: null,
        });
      }
    });
    const ingested = IngestResponse.parse(
      await (await h.call('POST', '/veterans', capture)).json(),
    );
    const [ownerItem, movedItem] = ingested.reviewItemIds!;
    counted.reset();
    const res = await h.call('POST', `/review-items/${ownerItem}/resolve`, {
      value: [
        { sparkId: 'spark:power', type: 'blue', stars: 1 },
        { sparkId: 'spark:medium', type: 'pink', stars: 1 },
        { sparkId: 'spark:arima-kinen', type: 'white', stars: 1 },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const resolve = counted.count();
    // The remap really ran: the later item moved by -7.
    const moved = await env.DB.prepare('SELECT path FROM review_items WHERE id = ?')
      .bind(movedItem)
      .first<{ path: string }>();
    expect(moved!.path).toBe('/sparks/18/stars');
    counted.reset();
    const patched = await h.call('PATCH', `/veterans/${ingested.veteranId}`, {
      trainMode: 'manual',
    });
    expect(patched.status).toBe(200);
    const patch = counted.count();
    console.log(`statements: resolve(owner+remap)=${resolve} patch=${patch}`);
    expect(resolve).toBeGreaterThan(15); // the counter saw the whole batch
    expect(resolve).toBeLessThanOrEqual(50);
    expect(patch).toBeGreaterThan(1);
    expect(patch).toBeLessThanOrEqual(50);
  });

  it('a stale owner resolve that returns 409 also stays ≤ 50 statements (T04b r2 S4)', async () => {
    const counted = countingEnv(env);
    const barrier = barrierEnv(counted.env);
    const h = makeHarness({}, barrier.env);
    const competitor = makeHarness();
    const capture = await makeCapture((c) =>
      c.fields.push({
        path: '/sparks/parent1',
        rawText: null,
        value: null,
        confidence: 0.2,
        status: 'low_confidence',
        candidates: [],
        cropKey: null,
      }),
    );
    const ingested = IngestResponse.parse(
      await (await competitor.call('POST', '/veterans', capture)).json(),
    );
    barrier.on('before', 'review_items', async () => {
      expect(
        (await competitor.call('PATCH', `/veterans/${ingested.veteranId}`, { trainMode: 'manual' }))
          .status,
      ).toBe(200);
    });
    counted.reset();
    await problem(
      await h.call('POST', `/review-items/${ingested.reviewItemIds![0]}/resolve`, {
        value: [
          { sparkId: 'spark:power', type: 'blue', stars: 1 },
          { sparkId: 'spark:medium', type: 'pink', stars: 1 },
        ],
      }),
      409,
    );
    const stale = counted.count();
    console.log(`statements: stale resolve=${stale}`);
    expect(barrier.fired()).toBe(1);
    expect(stale).toBeGreaterThan(15);
    expect(stale).toBeLessThanOrEqual(50);
  });
});
