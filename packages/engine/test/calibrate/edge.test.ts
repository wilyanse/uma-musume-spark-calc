/**
 * T15 edge cases: eligibility and exclusion accounting, insufficient data, typed input errors,
 * non-finite inputs, aptitude/skill contradictions, deterministic selection and rule immutability.
 */
import { describe, expect, it } from 'vitest';
import type { RosterVeteran } from '@uma/schema';
import { calibrateRules, ModelInputError, withBlueStatGainMultiplier } from '../../src/index.ts';
import { buildGrid, selectArgmin } from '../../src/calibrate/grid.ts';
import {
  calibrationRoster,
  deepFreeze,
  goldenCtx,
  opts,
  publishedCtx,
  storedSplit,
} from './helpers.ts';

const byId = new Map(calibrationRoster.map((v) => [v.id, v]));
const guestGuest = calibrationRoster.filter(
  (v) => v.minConfidence >= 0.9 && v.parents.every((p) => p.isGuest),
);
const matchedPair = calibrationRoster.find(
  (v) =>
    v.minConfidence >= 0.9 &&
    v.parents.every((p) => p.matchedVeteranId !== null && byId.has(p.matchedVeteranId)),
)!;

describe('empty, small and insufficient rosters never fabricate a score', () => {
  it('empty roster: every check unavailable, denominators 0', () => {
    const r = calibrateRules(goldenCtx(), [], opts({ split: undefined }));
    expect(r.population).toMatchObject({ rosterRows: 0, used: 0, excluded: [] });
    expect(r.status).toBe('unavailable');
    expect(r.aptitude.status).toBe('insufficient-data');
    expect(r.aptitude.logLik).toBeNull();
    expect(r.stats.status).toBe('insufficient-data');
    expect(r.stats.selected).toBeNull();
    expect(r.skills.status).toBe('insufficient-data');
    expect(r.candidates.every((c) => c.status !== 'fitted')).toBe(true);
    expect(r.suggestions).toEqual([]);
  });

  it('three usable rows: aptitude check runs, stat/skill checks are insufficient-data', () => {
    const rows = guestGuest.slice(0, 3);
    const r = calibrateRules(goldenCtx(), rows, opts({ split: undefined }));
    expect(r.population.used).toBe(3);
    expect(r.aptitude.status).toBe('ok');
    expect(r.aptitude.rows).toBe(3);
    expect(r.stats.status).toBe('insufficient-data');
    expect(r.stats.insufficient).toMatch(/≥ 5 train rows/);
    expect(r.skills.status).toBe('insufficient-data');
    expect(r.status).toBe('partial');
    expect(r.suggestions).toEqual([]);
  });
});

describe('eligibility: matched-or-guest parents, exclusions all counted', () => {
  it('unmatched, matched-missing, unread guest sparks, illegal lineage, low confidence, non-finite stats', () => {
    const base = guestGuest.slice(0, 8).map((v) => structuredClone(v));
    // 0: matched parent id absent from the supplied roster -> matched-missing.
    base[0]!.parents[0]!.isGuest = false;
    base[0]!.parents[0]!.guestTrainer = null;
    base[0]!.parents[0]!.matchedVeteranId = '01ZZZZZZZZZZZZZZZZZZZZZZZZ';
    // 1: unmatched non-guest parent.
    base[1]!.parents[1]!.isGuest = false;
    base[1]!.parents[1]!.guestTrainer = null;
    // 2: guest parent with no recorded sparks (lineage unknown, Q-140).
    base[2]!.sparks = base[2]!.sparks.filter((s) => s.owner !== 'parent1');
    // 3: illegal lineage (parent = trainee character).
    base[3]!.parents[0]!.characterId = base[3]!.characterId;
    // 4: low confidence; 5: NaN confidence; 6: non-finite stat.
    base[4]!.minConfidence = 0.5;
    base[5]!.minConfidence = Number.NaN;
    base[6]!.stats.spd = Number.POSITIVE_INFINITY;
    const r = calibrateRules(goldenCtx(), base, opts({ split: undefined }));
    const reasons = Object.fromEntries(r.population.excluded.map((e) => [e.reason, e.count]));
    expect(reasons).toEqual({
      'parent-not-matched-or-guest': 2,
      'parent-sparks-unread': 1,
      'illegal-lineage': 1,
      'low-confidence': 2,
      'non-finite-stat': 1,
    });
    expect(r.population.used).toBe(1);
    const row0 = r.population.rows.find((x) => x.id === base[0]!.id)!;
    expect(row0).toMatchObject({ included: false, reason: 'parent-not-matched-or-guest' });
    expect(row0.detail).toMatch(/matched-missing/);
    expect(r.population.used + r.population.excluded.reduce((s, e) => s + e.count, 0)).toBe(8);
  });

  it('a matched parent present in the roster is used with its own parents as grandparents', () => {
    const p = matchedPair.parents.map((x) => byId.get(x.matchedVeteranId!)!);
    const r = calibrateRules(goldenCtx(), [matchedPair, ...p], opts({ split: undefined }));
    const row = r.population.rows.find((x) => x.id === matchedPair.id)!;
    expect(row).toMatchObject({ included: true, parents: ['matched', 'matched'] });
  });

  it('duplicate ids are a typed input error', () => {
    const v = guestGuest[0]!;
    expect(() => calibrateRules(goldenCtx(), [v, v], opts({ split: undefined }))).toThrow(
      ModelInputError,
    );
  });

  it('explicit split: unknown or overlapping ids are typed errors; ineligible ids are dropped and counted', () => {
    const ids = guestGuest.slice(0, 10).map((v) => v.id);
    const rows = guestGuest.slice(0, 10);
    expect(() =>
      calibrateRules(goldenCtx(), rows, opts({ split: { trainIds: ['nope'], holdoutIds: ids } })),
    ).toThrow(/split-unknown/);
    expect(() =>
      calibrateRules(
        goldenCtx(),
        rows,
        opts({ split: { trainIds: ids.slice(0, 6), holdoutIds: ids.slice(5) } }),
      ),
    ).toThrow(/split-overlap/);
    const low = structuredClone(rows);
    low[0]!.minConfidence = 0.1;
    const r = calibrateRules(
      goldenCtx(),
      low,
      opts({ split: { trainIds: ids.slice(0, 7), holdoutIds: ids.slice(7) }, bootstrap: 0 }),
    );
    expect(r.split.dropped).toEqual([{ id: ids[0], reason: 'low-confidence' }]);
    expect(r.split.trainIds).toHaveLength(6);
  });
});

describe('options and numeric guards', () => {
  it.each([
    [{ min: 0.5, max: 2, step: 0 }],
    [{ min: 0.5, max: 2, step: -0.1 }],
    [{ min: 2, max: 0.5, step: 0.1 }],
    [{ min: -1, max: 2, step: 0.1 }],
    [{ min: 0.5, max: Number.NaN, step: 0.1 }],
    [{ min: 0.5, max: Number.POSITIVE_INFINITY, step: 0.1 }],
    [{ min: 0, max: 1000, step: 0.0001 }],
  ])('rejects grid %o', (grid) => {
    expect(() => calibrateRules(goldenCtx(), guestGuest, opts({ grid }))).toThrow(ModelInputError);
  });

  it.each([[-1], [1.5], [Number.NaN], [100_001]])('rejects bootstrap %s', (b) => {
    expect(() => calibrateRules(goldenCtx(), guestGuest, opts({ bootstrap: b }))).toThrow(
      ModelInputError,
    );
  });

  it('grid points are exact decimal ticks, inclusive of both ends', () => {
    expect(buildGrid({ min: 0.5, max: 0.6, step: 0.03 })).toEqual([0.5, 0.53, 0.56, 0.59]);
    expect(buildGrid({ min: 0.5, max: 2, step: 0.01 })).toHaveLength(151);
    expect(buildGrid({ min: 1, max: 1, step: 0.1 })).toEqual([1]);
    expect(buildGrid({ min: 0.1, max: 0.3, step: 0.1 })).toEqual([0.1, 0.2, 0.3]);
  });

  it('argmin ties break towards the current rules (m = 1), then the smaller multiplier', () => {
    expect(selectArgmin([0.9, 1, 1.1], [3, 3, 3])).toBe(1);
    expect(selectArgmin([0.9, 1.1, 1.3], [3, 3, 4])).toBe(0);
    expect(selectArgmin([0.8, 1.2], [5, 5])).toBe(0);
    expect(selectArgmin([0.8, 1.2], [5, 4])).toBe(1);
    expect(selectArgmin([0.8, 1.2], [5, 5 - 1e-15])).toBe(0);
    expect(() => selectArgmin([1], [Number.NaN])).toThrow();
  });

  it('withBlueStatGainMultiplier returns a new context and leaves the input untouched', () => {
    const ctx = goldenCtx();
    const before = structuredClone(ctx.rules);
    const c2 = withBlueStatGainMultiplier(ctx, 1.25);
    expect(c2).not.toBe(ctx);
    expect(c2.rules).not.toBe(ctx.rules);
    expect(ctx.rules).toEqual(before);
    expect(c2.tables.blueStatGain).toEqual([12.5, 25, 37.5]);
    expect(c2.rules.blueStatGain['2']).toBe(25);
    expect(c2.rules.blueStatGain.verified).toBe(false);
    expect(ctx.tables.blueStatGain).toEqual([10, 20, 30]);
    for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => withBlueStatGainMultiplier(ctx, bad)).toThrow(ModelInputError);
    }
  });
});

describe('rules and roster are never mutated or auto-applied', () => {
  it('deep-frozen context rules and roster produce the same report', () => {
    const rows = calibrationRoster.map((v) => structuredClone(v));
    const ctx = goldenCtx();
    deepFreeze(ctx.rules);
    deepFreeze(ctx.tables);
    deepFreeze(rows);
    const snapshot = JSON.stringify(rows);
    const rulesBefore = JSON.stringify(ctx.rules);
    const r = calibrateRules(ctx, rows, opts({ bootstrap: 20 }));
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(JSON.stringify(ctx.rules)).toBe(rulesBefore);
    expect(r.suggestions.every((s) => s.applied === false)).toBe(true);
    expect(r.rulesVersion).toBe(ctx.rules.version);
  });
});

describe('aptitude and skill contradictions are counted, not hidden', () => {
  const rows = calibrationRoster.map((v) => structuredClone(v));
  const holdId = storedSplit.holdoutIds.find((id) =>
    rows.find((v) => v.id === id)!.parents.every((p) => p.isGuest || p.matchedVeteranId),
  )!;
  const row = rows.find((v) => v.id === holdId)! as RosterVeteran;
  // Grade far below the trainee base (pink sparks only add steps): impossible under the model.
  row.aptitudes.turf = 'G';
  // An acquired skill with no deck/innate/lineage source (q = 0, Q-131).
  const orphan = 'skill:__t15-orphan__';
  row.skills.push({ skillId: orphan, level: null } as unknown as RosterVeteran['skills'][number]);
  const ctx = goldenCtx();
  const outfitTurf = ctx.outfits.get(row.outfitId)!.aptitudes.turf;

  it('impossible aptitude grades are excluded from the log-likelihood and counted', () => {
    const r = calibrateRules(ctx, rows, opts({ bootstrap: 0 }));
    expect(outfitTurf).not.toBe('G'); // the fixture row must make G impossible (not vacuous)
    expect(r.aptitude.impossible).toBe(1);
    expect(r.aptitude.belowBase).toBe(1);
    expect(Number.isFinite(r.aptitude.logLik)).toBe(true);
    expect(r.aptitude.perAptitude.turf!.impossible).toBe(1);
  });

  it('a q = 0 acquired holdout skill is a contradiction, excluded from the likelihood', () => {
    const r = calibrateRules(ctx, rows, opts({ bootstrap: 0 }));
    const h = r.skills.candidates[0]!.holdout;
    expect(h.contradictions).toBe(1);
    expect(h.contradictionSkills).toEqual([{ skillId: orphan, count: 1 }]);
    expect(Number.isFinite(h.logLik)).toBe(true);
  });
});

describe('published Global context end to end', () => {
  it('runs without throwing and is honest about placeholders', () => {
    const r = calibrateRules(publishedCtx(), calibrationRoster, opts({ bootstrap: 0 }));
    expect(r.stats.status).toBe('nonidentifiable');
    expect(r.warnings.join(' ')).toMatch(/placeholder|unverified/);
    expect(r.notCalibrated.length).toBeGreaterThan(5);
  });
});

describe('production purity', () => {
  it('src/calibrate imports only engine src and @uma/schema (no node:*, scripts/, truth or DOM)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(import.meta.dirname, '../../src/calibrate');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.sort()).toEqual(['aptitude.ts', 'context.ts', 'grid.ts', 'index.ts', 'skills.ts']);
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const specs = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const s of specs)
        expect(s, `${f}: ${s}`).toMatch(/^(\.\.?\/(?!.*scripts)|@uma\/schema$)/);
      expect(text, f).not.toMatch(
        /truth|latent|fetch\(|document\.|window\.|readFileSync|Math\.random/,
      );
    }
  });
});
