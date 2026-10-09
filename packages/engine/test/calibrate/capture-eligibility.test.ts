/**
 * T17 review r1 S1: retain the reviewer's real calibrateRules population probe.
 * Synthetic golden roster clones, not real imports or verified game mechanics. No fixture writes.
 * The API status flag is the only capture-status input here; field correction itself is covered
 * by the retained capture → API → engine regression.
 */
import { describe, expect, it } from 'vitest';
import type { RosterVeteran } from '@uma/schema';
import { calibrateRules } from '../../src/index.ts';
import { prepareRow } from '../../src/model/fit.ts';
import { FULL_CALIBRATION_TIMEOUT_MS, opts, publishedCtx, roster } from './helpers.ts';

const ctx = publishedCtx();
const byId = new Map(roster.map((v) => [v.id, v]));
const base = roster.find((v) =>
  v.parents.every((p) => p.isGuest) && 'row' in prepareRow(ctx, v, byId),
)!;

type Case = {
  name: string;
  score: number;
  flag: unknown;
  edit?: (v: RosterVeteran) => void;
  reason?: string;
  detail?: string;
  parents?: string[];
};
const cases: Case[] = [
  { name: 'accepted low 0.875', score: 0.875, flag: false },
  { name: 'corrected low 0.3', score: 0.3, flag: false },
  { name: 'unresolved high 0.99', score: 0.99, flag: true,
    reason: 'low-confidence', detail: 'hasLowConfidence: a capture field is still low_confidence (minConfidence 0.99)' },
  { name: 'missing legacy flag with low 0.875', score: 0.875, flag: undefined,
    reason: 'low-confidence', detail: 'legacy row without hasLowConfidence: minConfidence 0.875 < 0.9' },
  { name: 'missing legacy flag at 0.9', score: 0.9, flag: undefined },
  { name: 'malformed string flag with high 0.99', score: 0.99, flag: 'false',
    reason: 'low-confidence', detail: 'malformed hasLowConfidence "false"' },
  { name: 'unread parent sparks with false/0.3', score: 0.3, flag: false,
    edit: (v) => { v.sparks = v.sparks.filter((s) => s.owner !== 'parent1'); },
    reason: 'parent-sparks-unread', detail: 'parent1 has no recorded sparks' },
  { name: 'unmatched non-guest with false/0.3', score: 0.3, flag: false,
    edit: (v) => {
      v.parents[0]!.isGuest = false;
      v.parents[0]!.guestTrainer = null;
      v.parents[0]!.matchedVeteranId = null;
    }, reason: 'parent-not-matched-or-guest', detail: 'parents unmatched/guest',
    parents: ['unmatched', 'guest'] },
  { name: 'missing matched parent with false/0.3', score: 0.3, flag: false,
    edit: (v) => {
      v.parents[0]!.isGuest = false;
      v.parents[0]!.guestTrainer = null;
      v.parents[0]!.matchedVeteranId = '01ZZZZZZZZZZZZZZZZZZZZZZZZ';
    }, reason: 'parent-not-matched-or-guest', detail: 'parents matched-missing/guest',
    parents: ['matched-missing', 'guest'] },
];

describe('calibrateRules retains capture-status eligibility and its extra parent restriction', () => {
  it.each(cases)('$name', ({ score, flag, edit, reason, detail, parents }) => {
    expect(base).toBeDefined();
    const rows = structuredClone(roster);
    const v = rows.find((r) => r.id === base.id)!;
    v.minConfidence = score;
    if (flag === undefined) delete v.hasLowConfidence;
    else (v as unknown as Record<string, unknown>).hasLowConfidence = flag;
    edit?.(v);
    const before = structuredClone(rows);
    const report = calibrateRules(ctx, rows, opts({
      split: undefined,
      splitSeed: 'T17-review1-split',
      cvSeed: 'T17-review1-cv',
      bootstrapSeed: 'T17-review1-bootstrap',
      bootstrap: 0,
      grid: { min: 0.5, max: 1.5, step: 0.5 },
    }));
    const actual = report.population.rows.find((r) => r.id === v.id)!;
    expect(actual).toBeDefined();
    if (reason) {
      expect(actual).toMatchObject({ included: false, reason, detail });
      expect(actual.role).toBeUndefined();
      expect([...report.split.trainIds, ...report.split.holdoutIds]).not.toContain(v.id);
      if (parents) {
        expect(actual.parents).toEqual(parents);
        // This is calibration's additional restriction, not a prepareRow exclusion.
        expect(prepareRow(ctx, v, new Map(rows.map((r) => [r.id, r])))).toHaveProperty('row');
      }
    } else {
      expect(actual).toMatchObject({ included: true, parents: ['guest', 'guest'] });
      expect(actual.reason).toBeUndefined();
      expect(['train', 'holdout']).toContain(actual.role);
      expect([...report.split.trainIds, ...report.split.holdoutIds]).toContain(v.id);
    }
    // Published placeholder rules do not become identifiable just because eligibility changes.
    expect(report.stats.status).toBe('nonidentifiable');
    expect(report.population.rows).toHaveLength(rows.length);
    expect(report.population.used).toBe(report.population.rows.filter((r) => r.included).length);
    expect(rows).toEqual(before);
    expect(v.minConfidence).toBe(score);
  }, FULL_CALIBRATION_TIMEOUT_MS);
});
