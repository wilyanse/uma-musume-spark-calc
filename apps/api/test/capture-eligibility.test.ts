import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IngestResponse,
  ReviewItem,
  RosterVeteran,
  RosterVeteranDetail,
  type VeteranCapture,
} from '@uma/schema';
import { buildMasterIndex } from '../src/master.ts';
import { barrierEnv, makeCapture, makeHarness, resetDb } from './helpers/harness.ts';
// Retained integration-readiness-review-1 probe payload: the C# Agent Core assembly of the REAL
// screenshot fixtures 01–07 + 09/10 (190 fields, all `ok`, weakest 0.875). It is a FIXTURE
// capture, not a real-roster import (H4 still pending). Copied verbatim from the IR1 scratch dir.
import agentCapture from './fixtures/agent-capture-ir1.json' with { type: 'json' };
// Published master the probe was matched against (read-only).
import characters from '../../web/public/master/global-20260930/characters.json' with { type: 'json' };
import outfits from '../../web/public/master/global-20260930/outfits.json' with { type: 'json' };
import skills from '../../web/public/master/global-20260930/skills.json' with { type: 'json' };
import sparks from '../../web/public/master/global-20260930/sparks.json' with { type: 'json' };
import cards from '../../web/public/master/global-20260930/cards.json' with { type: 'json' };
import affinity from '../../web/public/master/global-20260930/affinity.json' with { type: 'json' };
import scenarios from '../../web/public/master/global-20260930/scenarios.json' with { type: 'json' };
import ranks from '../../web/public/master/global-20260930/ranks.json' with { type: 'json' };
import vocab from '../../web/public/master/global-20260930/vocab.json' with { type: 'json' };
import rules from '../../web/public/master/global-20260930/rules.json' with { type: 'json' };

// T17 / 63 / ADR-0003: the API derives `hasLowConfidence` from CURRENT capture_fields status
// (any `low_confidence`), keeps `minConfidence` as the raw minimum score, and the engine's
// confidence-only gate follows the flag.

beforeEach(resetDb);
type H = ReturnType<typeof makeHarness>;

// The engine's REAL source, loaded at runtime for a TEST-ONLY cross-module regression (no new
// package dependency): capture → real API routes/D1 → `GET /roster` → the engine's own
// eligibility code. The specifier is a variable so the API typecheck (Workers lib) does not pull
// in engine sources typed for another lib; the surface used is typed locally below.
interface EngineSurface {
  loadContext(master: unknown, rules: unknown): unknown;
  prepareRow(
    ctx: unknown,
    v: RosterVeteran,
    byId: ReadonlyMap<string, RosterVeteran>,
  ): { row: unknown } | { reason: string; detail: string };
}
const ENGINE_FIT = new URL('../../../packages/engine/src/model/fit.ts', import.meta.url).href;
const ENGINE_INDEX = new URL('../../../packages/engine/src/index.ts', import.meta.url).href;
const engine: EngineSurface = {
  ...((await import(/* @vite-ignore */ ENGINE_INDEX)) as Pick<EngineSurface, 'loadContext'>),
  ...((await import(/* @vite-ignore */ ENGINE_FIT)) as Pick<EngineSurface, 'prepareRow'>),
};

const PUBLISHED = 'global-20260930';
const bundle = {
  version: PUBLISHED,
  characters,
  outfits,
  skills,
  sparks,
  cards,
  affinity,
  scenarios,
  ranks,
  vocab,
  rules,
};
const engineCtx = engine.loadContext(bundle, bundle.rules);
const publishedIndex = buildMasterIndex({ characters, outfits, skills, sparks, cards, ranks, scenarios });
const publishedHarness = (e: Env = env) =>
  makeHarness({ master: async (v) => (v === PUBLISHED ? publishedIndex : null) }, e);

const agent = () => structuredClone(agentCapture) as unknown as VeteranCapture;
const lowField = (path: string, value: unknown, confidence = 0.3) => ({
  path,
  rawText: 'x',
  value,
  confidence,
  status: 'low_confidence' as const,
  candidates: [{ value, score: 0.5 }],
  cropKey: null,
});
const setLow = (c: VeteranCapture, path: string, value: unknown, confidence = 0.3) => {
  c.fields = c.fields.filter((f) => f.path !== path);
  c.fields.push(lowField(path, value, confidence));
};

const ingest = async (h: H, c: VeteranCapture) => {
  const res = await h.call('POST', '/veterans', c);
  expect([200, 201], await res.clone().text()).toContain(res.status);
  return IngestResponse.parse(await res.json());
};
const getRoster = async (h: H) => {
  const res = await h.call('GET', '/roster');
  return { etag: res.headers.get('ETag'), roster: RosterVeteran.array().parse(await res.json()) };
};
const detail = async (h: H, id: string) =>
  RosterVeteranDetail.parse(await (await h.call('GET', `/veterans/${id}`)).json());
const openItems = async (h: H) =>
  ReviewItem.array().parse(await (await h.call('GET', '/review-items?status=open')).json());
const resolve = (h: H, id: string, value: unknown) =>
  h.call('POST', `/review-items/${id}/resolve`, { value });

/** The engine's verdict on one API roster row (the published production context). */
const engineVerdict = (roster: RosterVeteran[], id: string) => {
  const byId = new Map(roster.map((v) => [v.id, v]));
  const r = engine.prepareRow(engineCtx, byId.get(id)!, byId);
  return 'row' in r ? 'eligible' : `${r.reason}: ${r.detail}`;
};

/** Flag and raw score as list, detail and PATCH responses report them (must agree). */
async function metaEverywhere(h: H, id: string) {
  const { roster } = await getRoster(h);
  const row = roster.find((v) => v.id === id)!;
  const d = await detail(h, id);
  expect(d.hasLowConfidence).toBe(row.hasLowConfidence);
  expect(d.minConfidence).toBe(row.minConfidence);
  return { hasLowConfidence: row.hasLowConfidence, minConfidence: row.minConfidence, roster, detail: d };
}

describe('cross-module: retained real-fixture agent capture → API → engine (B1)', () => {
  it('all-ok capture with raw min 0.875: hasLowConfidence=false, score kept, engine passes the confidence gate', async () => {
    const h = publishedHarness();
    const c = agent();
    expect(c.fields).toHaveLength(190);
    expect(c.fields.every((f) => f.status === 'ok')).toBe(true);
    const body = await ingest(h, c);
    expect(body.created).toBe(true);
    expect(body.reviewItemIds).toBeUndefined();
    const m = await metaEverywhere(h, body.veteranId);
    expect(m).toMatchObject({ hasLowConfidence: false, minConfidence: 0.875 });
    expect(engineVerdict(m.roster, body.veteranId)).toBe('eligible');
    // Simulate a consumer whose older schema stripped the flag: the legacy gate still excludes.
    const legacy = m.roster.map(({ hasLowConfidence: _h, ...v }) => v as RosterVeteran);
    expect(engineVerdict(legacy, body.veteranId)).toMatch(/^low-confidence: legacy row/);
  });

  it('a low 0.3 field excludes; resolving the last one makes it eligible without changing any score', async () => {
    const h = publishedHarness();
    const c = agent();
    setLow(c, '/stats/spd', c.veteran.stats.spd);
    const { veteranId, reviewItemIds } = await ingest(h, c);
    expect(reviewItemIds).toHaveLength(1);
    let m = await metaEverywhere(h, veteranId);
    expect(m).toMatchObject({ hasLowConfidence: true, minConfidence: 0.3 });
    expect(engineVerdict(m.roster, veteranId)).toMatch(/^low-confidence: hasLowConfidence/);
    const before = (await getRoster(h)).etag;

    h.tick();
    expect((await resolve(h, reviewItemIds![0]!, c.veteran.stats.spd)).status).toBe(200);
    m = await metaEverywhere(h, veteranId);
    expect(m).toMatchObject({ hasLowConfidence: false, minConfidence: 0.3 });
    const field = m.detail.fields.find((f) => f.path === '/stats/spd')!;
    expect(field).toMatchObject({ status: 'corrected', confidence: 0.3 });
    expect(engineVerdict(m.roster, veteranId)).toBe('eligible');
    // The status change is visible to conditional GETs: the ETag moved.
    const after = await getRoster(h);
    expect(after.etag).not.toBe(before);
    const cond = await h.call('GET', '/roster', undefined, { headers: { 'If-None-Match': before! } });
    expect(cond.status).toBe(200);
  });

  it('true wins over a high raw score: a low_confidence field scored 0.95 excludes', async () => {
    const h = publishedHarness();
    const c = agent();
    for (const f of c.fields) f.confidence = Math.max(f.confidence, 0.95);
    setLow(c, '/stats/wit', c.veteran.stats.wit, 0.95);
    const { veteranId } = await ingest(h, c);
    const m = await metaEverywhere(h, veteranId);
    expect(m).toMatchObject({ hasLowConfidence: true, minConfidence: 0.95 });
    expect(engineVerdict(m.roster, veteranId)).toMatch(/^low-confidence: hasLowConfidence/);
  });

  it('false never bypasses other exclusions: an unread parent spark block stays excluded', async () => {
    const h = publishedHarness();
    const c = agent();
    // Unread guest-parent block: no parent2 sparks and the T01b pseudo-field, resolved below.
    c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== 'parent2');
    c.fields = c.fields.filter((f) => !/^\/sparks\/\d+/.test(f.path));
    c.fields.push(lowField('/sparks/parent2', null));
    const { fingerprint: fp } = await import('@uma/schema');
    c.fingerprint = await fp(c.veteran);
    const { veteranId } = await ingest(h, c);
    let m = await metaEverywhere(h, veteranId);
    expect(m.hasLowConfidence).toBe(true);
    expect(engineVerdict(m.roster, veteranId)).toMatch(/^low-confidence/);
    // Dismissing the item directly (no route does this; models an external dismissal) is not a correction.
    await env.DB.prepare("UPDATE review_items SET status = 'dismissed'").run();
    m = await metaEverywhere(h, veteranId);
    expect(m.hasLowConfidence).toBe(true);
    // Even if the flag were false, the empty parent block keeps the row out.
    const forced = m.roster.map((v) => ({ ...v, hasLowConfidence: false }));
    expect(engineVerdict(forced, veteranId)).toMatch(/^parent-sparks-unread/);
  });
});

describe('status derivation across review/ingest paths (test-1 fixture capture)', () => {
  const twoLow = () =>
    makeCapture((c) => {
      setLow(c, '/stats/spd', c.veteran.stats.spd);
      setLow(c, '/stats/sta', c.veteran.stats.sta);
    });

  it('partial resolution stays true; resolving the last flips false; scores stay raw', async () => {
    const h = makeHarness();
    const { veteranId, reviewItemIds } = await ingest(h, await twoLow());
    expect(await metaEverywhere(h, veteranId)).toMatchObject({ hasLowConfidence: true, minConfidence: 0.3 });
    h.tick();
    expect((await resolve(h, reviewItemIds![0]!, 894)).status).toBe(200);
    expect(await metaEverywhere(h, veteranId)).toMatchObject({ hasLowConfidence: true, minConfidence: 0.3 });
    h.tick();
    expect((await resolve(h, reviewItemIds![1]!, 938)).status).toBe(200);
    expect(await metaEverywhere(h, veteranId)).toMatchObject({ hasLowConfidence: false, minConfidence: 0.3 });
  });

  it('a dismissed item whose field is still low_confidence keeps the flag true', async () => {
    const h = makeHarness();
    const { veteranId, reviewItemIds } = await ingest(h, await twoLow());
    h.tick();
    expect((await resolve(h, reviewItemIds![0]!, 894)).status).toBe(200);
    await env.DB.prepare("UPDATE review_items SET status = 'dismissed' WHERE id = ?")
      .bind(reviewItemIds![1]!)
      .run();
    expect(await openItems(h)).toEqual([]);
    expect((await metaEverywhere(h, veteranId)).hasLowConfidence).toBe(true);
  });

  it('re-ingest supersedes: a corrected veteran re-captured as low is true again; re-captured ok is false', async () => {
    const h = makeHarness();
    const low1 = await makeCapture((c) => setLow(c, '/stats/spd', c.veteran.stats.spd));
    const { veteranId, reviewItemIds } = await ingest(h, low1);
    h.tick();
    expect((await resolve(h, reviewItemIds![0]!, low1.veteran.stats.spd)).status).toBe(200);
    expect((await metaEverywhere(h, veteranId)).hasLowConfidence).toBe(false);
    h.tick();
    const again = await ingest(h, low1);
    expect(again).toMatchObject({ veteranId, created: false });
    expect(again.reviewItemIds).toHaveLength(1);
    expect(await metaEverywhere(h, veteranId)).toMatchObject({ hasLowConfidence: true, minConfidence: 0.3 });
    h.tick();
    await ingest(h, await makeCapture()); // all ok: the open item is dismissed, field ok
    expect(await metaEverywhere(h, veteranId)).toMatchObject({ hasLowConfidence: false, minConfidence: 0.99 });
    expect(await openItems(h)).toEqual([]);
  });

  it('re-ingest that reorders skills retires the old index item but the new low field keeps true', async () => {
    const h = makeHarness();
    const first = await makeCapture((c) => setLow(c, '/skills/1/skillId', c.veteran.skills[1]!.skillId));
    const { veteranId, reviewItemIds } = await ingest(h, first);
    const reordered = await makeCapture((c) => {
      c.veteran.skills = [c.veteran.skills[0]!, c.veteran.skills[2]!, c.veteran.skills[1]!, ...c.veteran.skills.slice(3)];
      setLow(c, '/skills/1/skillId', c.veteran.skills[1]!.skillId);
    });
    h.tick();
    const again = await ingest(h, reordered);
    expect(again.reviewItemIds).toHaveLength(1);
    expect(again.reviewItemIds![0]).not.toBe(reviewItemIds![0]);
    const old = await env.DB.prepare('SELECT status FROM review_items WHERE id = ?')
      .bind(reviewItemIds![0]!)
      .first<{ status: string }>();
    expect(old!.status).toBe('dismissed');
    expect((await metaEverywhere(h, veteranId)).hasLowConfidence).toBe(true);
  });

  it('owner-block remap: dropped low fields stop counting; a moved low field still counts until resolved', async () => {
    const h = makeHarness();
    const c = await makeCapture((cap) => {
      const s = cap.veteran.sparks;
      cap.fields.push(
        lowField('/sparks/12/stars', s[12]!.stars), // inside parent1 (9–18): dropped by the owner fix
        lowField('/sparks/25/stars', s[25]!.stars), // parent2: moves with its spark
        lowField('/sparks/parent1', null),
      );
    });
    const { veteranId } = await ingest(h, c);
    const items = Object.fromEntries((await openItems(h)).map((i) => [i.path, i.id]));
    h.tick();
    const fix = [
      { sparkId: 'spark:power', type: 'blue', stars: 1 },
      { sparkId: 'spark:medium', type: 'pink', stars: 1 },
      { sparkId: 'spark:arima-kinen', type: 'white', stars: 1 },
    ];
    expect((await resolve(h, items['/sparks/parent1']!, fix)).status).toBe(200);
    let m = await metaEverywhere(h, veteranId);
    expect(m.hasLowConfidence).toBe(true); // /sparks/25 moved to /sparks/18, still low
    expect(m.detail.fields.filter((f) => f.status === 'low_confidence').map((f) => f.path)).toEqual(['/sparks/18/stars']);
    const moved = (await openItems(h)).find((i) => i.path === '/sparks/18/stars')!;
    h.tick();
    expect((await resolve(h, moved.id, m.detail.sparks[18]!.stars)).status).toBe(200);
    m = await metaEverywhere(h, veteranId);
    expect(m).toMatchObject({ hasLowConfidence: false, minConfidence: 0.3 });
  });

  it('PATCH responds with the same derived metadata and does not change it', async () => {
    const h = makeHarness();
    const { veteranId } = await ingest(h, await twoLow());
    const res = await h.call('PATCH', `/veterans/${veteranId}`, { trainMode: 'manual' });
    const patched = RosterVeteranDetail.parse(await res.json());
    expect(patched).toMatchObject({ hasLowConfidence: true, minConfidence: 0.3, modeSource: 'override' });
    expect((await metaEverywhere(h, veteranId)).hasLowConfidence).toBe(true);
  });

  it('race: a re-ingest that reads the field ok inside the resolve window wins (409) and the flag follows the committed fields', async () => {
    const barrier = barrierEnv(env);
    const h = makeHarness({}, barrier.env);
    const { veteranId, reviewItemIds } = await ingest(h, await twoLow());
    const staOnly = await makeCapture((c) => setLow(c, '/stats/sta', c.veteran.stats.sta));
    barrier.on('before', "UPDATE review_items SET status = 'resolved'", async () => {
      expect((await h.call('POST', '/veterans', staOnly)).status).toBe(200);
    });
    expect((await resolve(h, reviewItemIds![0]!, 884)).status).toBe(409);
    let m = await metaEverywhere(h, veteranId);
    expect(m.hasLowConfidence).toBe(true); // sta still low
    expect(m.detail.stats.spd).toBe(894); // correction not applied
    h.tick();
    expect((await resolve(h, reviewItemIds![1]!, 938)).status).toBe(200);
    m = await metaEverywhere(h, veteranId);
    expect(m).toMatchObject({ hasLowConfidence: false, minConfidence: 0.3 });
  });

  it('race: PATCH inside the resolve window → 409, flag unchanged; the retried resolve flips it', async () => {
    const barrier = barrierEnv(env);
    const h = makeHarness({}, barrier.env);
    const c = await makeCapture((cap) => setLow(cap, '/stats/spd', cap.veteran.stats.spd));
    const { veteranId, reviewItemIds } = await ingest(h, c);
    barrier.on('before', "UPDATE review_items SET status = 'resolved'", async () => {
      expect((await h.call('PATCH', `/veterans/${veteranId}`, { trainMode: 'manual' })).status).toBe(200);
    });
    expect((await resolve(h, reviewItemIds![0]!, 894)).status).toBe(409);
    expect((await metaEverywhere(h, veteranId)).hasLowConfidence).toBe(true);
    h.tick();
    expect((await resolve(h, reviewItemIds![0]!, 894)).status).toBe(200);
    expect((await metaEverywhere(h, veteranId)).hasLowConfidence).toBe(false);
  });
});
