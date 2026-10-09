/**
 * T17 / ADR-0003: capture-status training eligibility (63). The confidence-only gate reads the
 * API's `hasLowConfidence` status flag when present; legacy rows without it keep the strict
 * `minConfidence >= 0.9` gate. Every other exclusion is unchanged.
 *
 * Inputs are in-memory clones of committed golden rows (synthetic, labelled; the files on disk
 * are never written). They are test data, not a real roster.
 */
import { describe, expect, it } from 'vitest';
import type { RosterVeteran } from '@uma/schema';
import {
  fitTrainingModelDetailed,
  MIN_CONFIDENCE,
  TRAINING_ELIGIBILITY_POLICY,
} from '../../src/index.ts';
import { prepareRow } from '../../src/model/fit.ts';
import { ctx, fitOpts, roster, truth } from './golden-fit.ts';

const byId = new Map(roster.map((v) => [v.id, v]));
const eligibleIds = new Set(truth.roster.trainingEligibleIds);
/** A golden row that is eligible today (valid lineage, legacy flag absent, min ≥ 0.9). */
const baseRow = roster.find((v) => eligibleIds.has(v.id) && v.parents.every((p) => p.isGuest))!;

const row = (edit: (v: RosterVeteran) => void): RosterVeteran => {
  const v = structuredClone(baseRow);
  edit(v);
  return v;
};
const check = (v: RosterVeteran) => {
  const m = new Map(byId);
  m.set(v.id, v);
  return prepareRow(ctx, v, m);
};
const reasonOf = (v: RosterVeteran) => {
  const r = check(v);
  return 'row' in r ? 'eligible' : r.reason;
};

describe('status-aware confidence gate (hasLowConfidence present)', () => {
  it('accepted fields with a raw score below 0.9 pass the confidence gate (0.875, false)', () => {
    const v = row((x) => {
      x.minConfidence = 0.875;
      x.hasLowConfidence = false;
    });
    const r = check(v);
    expect('row' in r).toBe(true);
    // The raw score is never rewritten by the engine.
    expect(v.minConfidence).toBe(0.875);
  });

  it('a corrected field keeps its raw 0.3 score and the row passes once nothing is low', () => {
    expect(reasonOf(row((x) => ((x.minConfidence = 0.3), (x.hasLowConfidence = false))))).toBe('eligible');
  });

  it('any remaining low-confidence field excludes even with a high raw score', () => {
    for (const score of [0.9, 0.99, 1]) {
      const r = check(row((x) => ((x.minConfidence = score), (x.hasLowConfidence = true))));
      expect('row' in r).toBe(false);
      if (!('row' in r)) {
        expect(r.reason).toBe('low-confidence');
        expect(r.detail).toMatch(/hasLowConfidence/);
      }
    }
  });
});

describe('legacy rows without the flag keep the strict numeric gate', () => {
  it(`absent flag: minConfidence ${MIN_CONFIDENCE} passes, 0.875 / 0.3 / NaN are excluded`, () => {
    expect(MIN_CONFIDENCE).toBe(0.9);
    expect(reasonOf(row((x) => (x.minConfidence = 0.9)))).toBe('eligible');
    for (const s of [0.875, 0.3, Number.NaN]) {
      const r = check(row((x) => (x.minConfidence = s)));
      expect('row' in r ? 'eligible' : r.reason).toBe('low-confidence');
      if (!('row' in r)) expect(r.detail).toMatch(/legacy/);
    }
  });

  it('an explicit undefined flag is treated as absent (legacy), never as false', () => {
    expect(reasonOf(row((x) => ((x.minConfidence = 0.875), (x.hasLowConfidence = undefined))))).toBe('low-confidence');
  });
});

describe('malformed flags are never coerced', () => {
  it.each([['false'], ['true'], [0], [1], [null], [{}]])('%j excludes the row', (flag) => {
    const v = row((x) => {
      x.minConfidence = 0.99;
      (x as unknown as Record<string, unknown>).hasLowConfidence = flag;
    });
    const r = check(v);
    expect('row' in r).toBe(false);
    if (!('row' in r)) {
      expect(r.reason).toBe('low-confidence');
      expect(r.detail).toMatch(/malformed hasLowConfidence/);
    }
  });
});

describe('hasLowConfidence=false never bypasses the other exclusions', () => {
  const ok = (edit: (v: RosterVeteran) => void) =>
    row((x) => {
      x.minConfidence = 0.3;
      x.hasLowConfidence = false;
      edit(x);
    });
  const cases: [string, (x: RosterVeteran) => void][] = [
    ['unknown-scenario', (x) => { x.scenarioId = 'scenario:does-not-exist'; }],
    ['unknown-outfit', (x) => { x.outfitId = 'outfit:does-not-exist'; }],
    ['unknown-card', (x) => { x.deck[0]!.cardId = 'card:does-not-exist'; }],
    ['deck-size', (x) => { x.deck = x.deck.slice(0, 5); }],
    ['parent-missing', (x) => { x.parents = x.parents.slice(0, 1); }],
    ['parent-sparks-unread', (x) => { x.sparks = x.sparks.filter((s) => s.owner !== 'parent1'); }],
    ['illegal-lineage', (x) => { x.parents[0]!.characterId = x.characterId; }],
    ['bad-date', (x) => { x.career.dateAcquired = 'not-a-date'; }],
    ['non-finite-stat', (x) => { x.stats.spd = Number.POSITIVE_INFINITY; }],
  ];
  it.each(cases)('%s', (reason, edit) => {
    expect(reasonOf(ok(edit))).toBe(reason);
  });
});

describe('fit-level population and policy identity', () => {
  it('exports a deterministic eligibility-policy version distinct from the snapshot kind', () => {
    expect(TRAINING_ELIGIBILITY_POLICY).toBe('capture-status-v1');
  });

  it('flagging golden low-confidence rows false admits only those with valid lineage', () => {
    const low = new Set(truth.roster.lowConfidenceIds);
    const before = fitTrainingModelDetailed(ctx, roster, fitOpts({ split: undefined }));
    const edited = roster.map((v) =>
      low.has(v.id) ? { ...structuredClone(v), hasLowConfidence: false } : v,
    );
    const after = fitTrainingModelDetailed(ctx, edited, fitOpts({ split: undefined }));
    const count = (rows: typeof before.report.rows, reason: string) =>
      rows.filter((r) => r.reason === reason).length;
    expect(count(before.report.rows, 'low-confidence')).toBe(low.size);
    expect(count(after.report.rows, 'low-confidence')).toBe(0);
    const unread = count(after.report.rows, 'parent-sparks-unread');
    expect(unread).toBeGreaterThan(0); // golden: unread parent sparks occur only on low rows
    const elig = (rows: typeof before.report.rows) => rows.filter((r) => r.eligible).length;
    expect(elig(after.report.rows)).toBe(elig(before.report.rows) + low.size - unread);
    // Raw scores are untouched on the input rows.
    for (const v of edited) if (low.has(v.id)) expect(v.minConfidence).toBeLessThan(0.9);
  });
});
