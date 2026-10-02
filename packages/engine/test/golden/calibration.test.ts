/**
 * T08 review round 2 B1: TEST-ONLY calibration feasibility (50 §8 stat check, 50 §9 / 70 §3 F12).
 * This is not the production T15 calibration. It checks that the golden data lets a holdout-MAE
 * multiplier scan land well inside [1.2, 1.4] on the ×1.3 roster and near 1.0 on the base roster.
 *
 * Inputs are observable only: roster rows, the stored split ids, and E[inh | recorded lineage]
 * from a context rebuilt from `truth.syntheticInheritance` alone (no `truth.latent`, no
 * `truth.calibration` multiplier, no planted parameter).
 */
import { describe, expect, it } from 'vitest';
import { calibrationRoster, master, roster, truth } from './load.ts';
import {
  calibrationPopulations,
  calibrationScan,
  holdoutMaeRefit,
  matchedGuestIds,
} from './calibration-diagnostic.ts';

const h = truth.holdout;
/** Only what the scan needs; built without latent or calibration fields. */
const context = { syntheticInheritance: structuredClone(truth.syntheticInheritance) };
const BAND: [number, number] = [1.2, 1.4];
/** Required distance of the argmin from either band edge ("comfortably inside", not rounding). */
const EDGE_MARGIN = 0.03;

describe('calibration feasibility (TEST-ONLY holdout-MAE scan, 0.01 grid)', () => {
  it('documented populations: 50 §4 split 192/48; 50 §8 matched-or-guest 157/39', () => {
    const pops = calibrationPopulations(calibrationRoster, h.trainIds, h.holdoutIds);
    expect(pops.map((p) => [p.train.length, p.holdout.length])).toEqual([
      [192, 48],
      [192, 39],
      [157, 39],
    ]);
    // The 50 §8 filter only removes rows with an unmatched non-guest parent; it is the same
    // row set on both rosters (lineage is identical, only stats differ).
    const byId = new Map(roster.map((v) => [v.id, v]));
    const kept = new Set(matchedGuestIds(roster, h.holdoutIds));
    for (const id of h.holdoutIds) {
      const unmatched = byId
        .get(id)!
        .parents.some((p) => !p.isGuest && p.matchedVeteranId === null);
      expect(kept.has(id)).toBe(!unmatched);
    }
    expect(matchedGuestIds(calibrationRoster, h.holdoutIds)).toEqual([...kept]);
  });

  it('the two-solve fast path equals a direct refit at every probed multiplier', () => {
    const s = calibrationScan(master, context, calibrationRoster, h.trainIds, h.holdoutIds);
    for (const m of [0.5, 1, 1.2, 1.3, 1.34, 1.4, 2]) {
      const direct = holdoutMaeRefit(
        master,
        context,
        calibrationRoster,
        h.trainIds,
        h.holdoutIds,
        m,
      );
      expect(Math.abs(s.at(m).mae - direct)).toBeLessThan(1e-8);
    }
  });

  const pops = calibrationPopulations(calibrationRoster, h.trainIds, h.holdoutIds);
  it.each(pops.map((p) => [p.name, p] as const))(
    '×1.3 roster, %s: argmin well inside [1.2, 1.4] on a 0.01 grid over [0.5, 2.0]',
    (_, p) => {
      const s = calibrationScan(master, context, calibrationRoster, p.train, p.holdout, {
        lo: 0.5,
        hi: 2,
      });
      expect(s.step).toBe(0.01);
      expect(s.grid).toHaveLength(151);
      expect(s.grid[0]!.multiplier).toBe(0.5);
      expect(s.grid.at(-1)!.multiplier).toBe(2);
      const m = s.best.multiplier;
      expect(m).toBeGreaterThanOrEqual(BAND[0] + EDGE_MARGIN);
      expect(m).toBeLessThanOrEqual(BAND[1] - EDGE_MARGIN);
      // A real interior minimum: the criterion rises towards both band edges and the grid ends.
      expect(s.at(BAND[0]).mae).toBeGreaterThan(s.best.mae);
      expect(s.at(BAND[1]).mae).toBeGreaterThan(s.best.mae);
      expect(s.at(1).mae).toBeGreaterThan(s.at(BAND[0]).mae);
      expect(s.at(2).mae).toBeGreaterThan(s.at(BAND[1]).mae);
      // The restricted [1.0, 2.0] grid the review asked for has the same argmin.
      const r = calibrationScan(master, context, calibrationRoster, p.train, p.holdout, {
        lo: 1,
        hi: 2,
      });
      expect(r.best.multiplier).toBe(m);
    },
  );

  it.each(pops.map((p) => [p.name, p] as const))(
    'base roster, %s: argmin near 1.0 (measured bias ≤ +0.06) and below the band',
    (_, p) => {
      const basePop = calibrationPopulations(roster, h.trainIds, h.holdoutIds).find(
        (q) => q.name === p.name,
      )!;
      const s = calibrationScan(master, context, roster, basePop.train, basePop.holdout, {
        lo: 0.5,
        hi: 2,
      });
      expect(Math.abs(s.best.multiplier - 1)).toBeLessThanOrEqual(0.06);
      expect(s.best.multiplier).toBeLessThan(BAND[0] - EDGE_MARGIN);
    },
  );

  it.each([
    [0.1, 1],
    [1, 0.1],
    [1, 1],
  ])('×1.3 stored split stays inside the band at the recoverable λ %s/%s', (li, lb) => {
    for (const p of pops) {
      const s = calibrationScan(master, context, calibrationRoster, p.train, p.holdout, {
        lambdaId: li,
        lambdaBase: lb,
      });
      expect(s.best.multiplier).toBeGreaterThanOrEqual(BAND[0] + EDGE_MARGIN);
      expect(s.best.multiplier).toBeLessThanOrEqual(BAND[1] - EDGE_MARGIN);
    }
  });

  it('truth.calibration.note makes no T15 promise and points at this check', () => {
    expect(truth.calibration.note).not.toMatch(/should suggest/);
    expect(truth.calibration.note).toMatch(/not a promise about production T15/);
    expect(truth.calibration.note).toMatch(/calibration\.test\.ts/);
  });
});
