/**
 * T15b pure helpers for S07 calibration diagnostics: null-safe number display, run provenance and
 * staleness, and the stats selection gate (61: `stats.status` + reasons are the authority, not the
 * raw `stats.identification.status`). Report objects are FAKE minimal shapes for branch coverage;
 * the real report is exercised in calibration-worker.test.ts and the e2e spec.
 */
import { describe, expect, it } from 'vitest';
import type { CalibrationReport } from '@uma/engine';
import { fmtNum, provenanceOf, rosterIdentity, selectionView, staleReasons } from '../src/lib/calibration.ts';

const stats = (over: Partial<CalibrationReport['stats']>) => ({
  status: 'nonidentifiable', identification: null, selected: null, trainCvSelected: null, ...over,
}) as unknown as CalibrationReport['stats'];

describe('fmtNum', () => {
  it('never shows null, undefined, NaN or ±Infinity as a number (and never as 0)', () => {
    expect(fmtNum(null)).toBe('unavailable');
    expect(fmtNum(undefined)).toBe('unavailable');
    expect(fmtNum(Number.NaN)).toBe('unavailable');
    expect(fmtNum(Number.NEGATIVE_INFINITY)).toBe('unavailable');
    expect(fmtNum(0)).toBe('0.00');
    expect(fmtNum(-235.2431, 1)).toBe('−235.2');
    expect(fmtNum(1.3, 2)).toBe('1.30');
  });
});

describe('selection gate', () => {
  it('raw identification "identified" with stats.status nonidentifiable is reported as BLOCKED, with the conflict flagged', () => {
    const v = selectionView(stats({
      status: 'nonidentifiable',
      nonidentifiable: { reasons: ['CV fold(s) 0 do not identify the multiplier'] },
      identification: { status: 'identified' } as never,
    }));
    expect(v.made).toBe(false);
    expect(v.rawIdentified).toBe(true);
    expect(v.gateConflict).toBe(true);
    expect(v.reasons).toEqual(['CV fold(s) 0 do not identify the multiplier']);
  });
  it('suggested with a selection is made; boundary is made but not suggested', () => {
    const sel = { multiplier: 1.32, holdoutMae: 1, trainCvMae: 1, atBoundary: false };
    expect(selectionView(stats({ status: 'suggested', selected: sel, identification: { status: 'identified' } as never })))
      .toMatchObject({ made: true, suggested: true, gateConflict: false });
    expect(selectionView(stats({ status: 'boundary', selected: { ...sel, atBoundary: true } })))
      .toMatchObject({ made: true, suggested: false });
  });
  it('insufficient-data carries the engine text as its reason', () => {
    expect(selectionView(stats({ status: 'insufficient-data', insufficient: 'need ≥ 5 train rows' })).reasons).toEqual(['need ≥ 5 train rows']);
  });
});

describe('provenance and staleness', () => {
  const roster = [{ id: 'a', stats: { spd: 1 } }, { id: 'b', stats: { spd: 2 } }] as never[];
  const ctx = { kind: 'production' as const, masterVersion: 'm1', rulesVersion: 'r1' };
  it('content identity changes with roster content even when the ETag does not', () => {
    const a = rosterIdentity(roster);
    expect(rosterIdentity(structuredClone(roster))).toBe(a);
    expect(rosterIdentity([{ id: 'a', stats: { spd: 9 } }, roster[1]] as never[])).not.toBe(a);
  });
  it('names every changed input', () => {
    const p = provenanceOf(ctx, 'm1', { etag: '"e1"', roster });
    expect(staleReasons(p, p)).toEqual([]);
    expect(staleReasons(p, provenanceOf(ctx, 'm1', { etag: '"e2"', roster }))).toEqual(['roster changed']);
    expect(staleReasons(p, provenanceOf(ctx, 'm1', { etag: '"e1"', roster: roster.slice(1) }))).toEqual(['roster changed']);
    expect(staleReasons(p, provenanceOf({ ...ctx, masterVersion: 'm2' }, 'm2', { etag: '"e1"', roster }))).toEqual(['master data changed']);
    expect(staleReasons(p, provenanceOf({ ...ctx, rulesVersion: 'r2' }, 'm1', { etag: '"e1"', roster }))).toEqual(['rules changed']);
    expect(staleReasons(p, provenanceOf({ ...ctx, kind: 'golden-fixture' }, 'm1', { etag: '"e1"', roster }))).toEqual(['engine context changed']);
  });
});
