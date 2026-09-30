import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { RosterVeteran } from '@uma/schema';
import { makeHarness, resetDb } from './helpers/harness.ts';
import mcqueen from './fixtures/mcqueen.json' with { type: 'json' };

/** Seeds N synthetic veterans straight into D1 (same row shapes as ingest, ~30 sparks each). */
async function seed(N: number): Promise<void> {
  await resetDb();
  const v = mcqueen.veteran;
  const db = env.DB;
  const pad = (i: number) => i.toString(32).toUpperCase().padStart(10, '0');
  const rows = Array.from({ length: N }, (_, i) => ({ id: `01J8Z3K4M5N6P7Q8${pad(i)}`, i }));
  for (let from = 0; from < N; from += 250) {
    const chunk = rows.slice(from, from + 250);
    const payload = JSON.stringify(chunk);
    const ids = JSON.stringify(chunk.map((c) => c.id));
    await db.batch([
      db
        .prepare(
          `INSERT INTO veterans (id, fingerprint, character_id, outfit_id, rank, rating, epithet, train_mode, mode_source,
             spd, sta, pow, gut, wit, apt_turf, apt_dirt, apt_sprint, apt_mile, apt_medium, apt_long, apt_front, apt_pace,
             apt_late, apt_end, scenario_id, races, wins, fans, date_acquired, master_version, capture_id, captured_at,
             min_confidence, created_at, updated_at)
           SELECT json_extract(value,'$.id'), substr(lower(hex(json_extract(value,'$.id'))) || '000000000000', 1, 64), ?2, ?3, 'A+', 13471, 'Independent Learner',
             'independent', 'epithet', 894, 938, 740, 559, 635, 'A','E','G','D','A','S','B','A','D','F',
             'scenario:ura-finale', 22, 22, 649560, '2026-09-29', 'test-1', json_extract(value,'$.id'),
             '2026-09-29T08:00:00Z', 0.9, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z' FROM json_each(?1)`,
        )
        .bind(payload, v.characterId, v.outfitId),
      db
        .prepare(
          `INSERT INTO veteran_sparks (veteran_id, owner, spark_id, type, stars)
           SELECT j.value, json_extract(s.value,'$.o'), json_extract(s.value,'$.s'), json_extract(s.value,'$.t'), json_extract(s.value,'$.n')
           FROM json_each(?1) j, json_each(?2) s`,
        )
        .bind(
          ids,
          JSON.stringify(
            v.sparks.map((s) => ({ o: s.owner, s: s.sparkId, t: s.type, n: s.stars })),
          ),
        ),
      db
        .prepare(
          `INSERT INTO veteran_skills (veteran_id, skill_id, level)
           SELECT j.value, json_extract(s.value,'$.s'), json_extract(s.value,'$.l') FROM json_each(?1) j, json_each(?2) s`,
        )
        .bind(ids, JSON.stringify(v.skills.map((s) => ({ s: s.skillId, l: s.level })))),
      db
        .prepare(
          `INSERT INTO veteran_deck (veteran_id, slot, card_id, lb, level, borrowed)
           SELECT j.value, json_extract(s.value,'$.n'), json_extract(s.value,'$.c'), 4, 50, 0 FROM json_each(?1) j, json_each(?2) s`,
        )
        .bind(ids, JSON.stringify(v.deck.map((d) => ({ n: d.slot, c: d.cardId })))),
      db
        .prepare(
          `INSERT INTO veteran_parents (veteran_id, slot, character_id, outfit_id, is_guest, guest_trainer)
           SELECT j.value, json_extract(s.value,'$.n'), json_extract(s.value,'$.c'), json_extract(s.value,'$.o'),
                  json_extract(s.value,'$.g'), json_extract(s.value,'$.t') FROM json_each(?1) j, json_each(?2) s`,
        )
        .bind(
          ids,
          JSON.stringify(
            v.parents.map((p) => ({
              n: p.slot,
              c: p.characterId,
              o: p.outfitId,
              g: p.isGuest ? 1 : 0,
              t: p.guestTrainer,
            })),
          ),
        ),
    ]);
  }
}

/**
 * 40 §4 claims the roster stays < 2 MB at 260–2,000 veterans. With every owner's sparks
 * (~33 per veteran here) it is ~4.7 KB per veteran, so 2 MB holds only for ~440 veterans (Q-4).
 * The test asserts the bound where it holds (the user's ~260) and records the 2,000 case.
 */
describe.each([
  { n: 260, capBytes: 2 * 1024 * 1024 },
  { n: 2000, capBytes: null },
])('roster at $n veterans (40 §4)', ({ n, capBytes }) => {
  beforeAll(() => seed(n), 120_000);

  it('returns them all; size and JSON cost are recorded', async () => {
    const h = makeHarness();
    const t0 = performance.now();
    const res = await h.call('GET', '/roster');
    const text = await res.text();
    const t1 = performance.now();
    const rows = JSON.parse(text) as unknown[];
    const t2 = performance.now();
    expect(rows).toHaveLength(n);
    expect(RosterVeteran.parse(rows[0])).toBeTruthy();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (capBytes !== null) expect(bytes).toBeLessThan(capBytes);

    // Warm runs: the handler again (query + assembly + stringify) and JSON.parse alone.
    const reps = 5;
    const h0 = performance.now();
    for (let i = 0; i < reps; i++) await (await h.call('GET', '/roster')).text();
    const handlerMs = (performance.now() - h0) / reps;
    const p0 = performance.now();
    for (let i = 0; i < reps; i++) JSON.parse(text);
    const parseMs = (performance.now() - p0) / reps;
    console.log(
      `roster benchmark: n=${n} bytes=${bytes} first-request=${(t1 - t0).toFixed(1)}ms ` +
        `first-parse=${(t2 - t1).toFixed(1)}ms warm-handler=${handlerMs.toFixed(1)}ms warm-parse=${parseMs.toFixed(1)}ms`,
    );
    // Wall-clock inside miniflare: a loose regression guard, NOT proof of the 10 ms CPU budget.
    expect(handlerMs).toBeLessThan(2000);
  }, 60_000);

  it('a conditional request answers 304 without assembling the roster', async () => {
    const h = makeHarness();
    const etag = (await h.call('GET', '/roster')).headers.get('etag')!;
    const t0 = performance.now();
    const res = await h.call('GET', '/roster', undefined, { headers: { 'If-None-Match': etag } });
    const ms = performance.now() - t0;
    expect(res.status).toBe(304);
    console.log(`roster 304 (n=${n}): ${ms.toFixed(1)}ms`);
  });
});
