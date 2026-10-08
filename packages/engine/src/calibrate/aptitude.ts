/**
 * 50 §8.1 aptitude check: observed final grades against the predicted `aptitudeDist` (trainee
 * base + pink steps, capped at S) on the recorded lineage. No fit is involved, so every used row
 * contributes. Impossible observations (probability 0, e.g. a grade below the trainee base) are
 * excluded from the log-likelihood and counted; they are never scored as a finite penalty.
 */
import { APT_KEYS, GRADES } from '@uma/schema';
import type { AptKey, Grade } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import type { PreparedRow } from '../model/fit.ts';

export const RELIABILITY_BINS = 10;
/** A cell whose most likely grade has p ≥ 1 − this carries no calibration information. */
export const DEGENERATE_TOL = 1e-12;

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  /** Mean predicted probability in the bin (null when empty). */
  meanPredicted: number | null;
  /** Observed frequency of the predicted event (null when empty). */
  observedRate: number | null;
}

export interface AptitudeStat {
  cells: number;
  logLik: number;
  impossible: number;
  /** Mean predicted grade index (G = 0 … S = 7) and mean observed index, over possible cells. */
  meanPredictedIndex: number | null;
  meanObservedIndex: number | null;
}

export interface AptitudeCheck {
  status: 'ok' | 'insufficient-data';
  rows: number;
  cells: number;
  /** Σ log p(observed grade) over possible cells; null when there are none. */
  logLik: number | null;
  /** logLik / possible cells. */
  meanLogLik: number | null;
  impossible: number;
  /** Impossible because the observed grade is below the trainee's base grade. */
  belowBase: number;
  /** Impossible because the observed grade is above every reachable grade. */
  aboveMax: number;
  degenerateCells: number;
  uncertainCells: number;
  /**
   * One (cell, grade) event per grade with 0 < p < 1 on uncertain cells; predicted p against the
   * indicator observed == grade, in 10 equal-width bins ([0.9, 1.0] closed).
   */
  reliability: ReliabilityBin[];
  perAptitude: Partial<Record<AptKey, AptitudeStat>>;
  examples: { id: string; apt: AptKey; observed: Grade; reason: 'below-base' | 'above-max' }[];
}

export function aptitudeCheck(ctx: EngineContext, rows: readonly PreparedRow[]): AptitudeCheck {
  const bins = Array.from({ length: RELIABILITY_BINS }, (_, i) => ({
    lo: i / RELIABILITY_BINS,
    hi: (i + 1) / RELIABILITY_BINS,
    count: 0,
    sumP: 0,
    hits: 0,
  }));
  const per = new Map<AptKey, { cells: number; ll: number; imp: number; pi: number; oi: number }>();
  let ll = 0;
  let possible = 0;
  let impossible = 0;
  let belowBase = 0;
  let aboveMax = 0;
  let degenerate = 0;
  let cells = 0;
  const examples: AptitudeCheck['examples'] = [];
  for (const r of rows) {
    const outfit = ctx.outfits.get(r.v.outfitId)!;
    for (const apt of APT_KEYS) {
      cells++;
      const dist = r.exp.aptitudeDist[apt];
      const obs = r.v.aptitudes[apt];
      const p = dist[obs] ?? 0;
      let s = per.get(apt);
      if (!s) per.set(apt, (s = { cells: 0, ll: 0, imp: 0, pi: 0, oi: 0 }));
      s.cells++;
      let maxP = 0;
      for (const g of GRADES) maxP = Math.max(maxP, dist[g] ?? 0);
      if (maxP >= 1 - DEGENERATE_TOL) degenerate++;
      else {
        for (const g of GRADES) {
          const pg = dist[g] ?? 0;
          if (!(pg > 0) || !(pg < 1)) continue;
          const b = bins[Math.min(RELIABILITY_BINS - 1, Math.floor(pg * RELIABILITY_BINS))]!;
          b.count++;
          b.sumP += pg;
          if (g === obs) b.hits++;
        }
      }
      if (!(p > 0)) {
        impossible++;
        s.imp++;
        const below = GRADES.indexOf(obs) < GRADES.indexOf(outfit.aptitudes[apt]);
        if (below) belowBase++;
        else aboveMax++;
        if (examples.length < 20) {
          examples.push({
            id: r.v.id,
            apt,
            observed: obs,
            reason: below ? 'below-base' : 'above-max',
          });
        }
        continue;
      }
      possible++;
      ll += Math.log(p);
      s.ll += Math.log(p);
      let mean = 0;
      GRADES.forEach((g, i) => (mean += i * (dist[g] ?? 0)));
      s.pi += mean;
      s.oi += GRADES.indexOf(obs);
    }
  }
  const perAptitude: AptitudeCheck['perAptitude'] = {};
  for (const apt of APT_KEYS) {
    const s = per.get(apt);
    if (!s) continue;
    const n = s.cells - s.imp;
    perAptitude[apt] = {
      cells: s.cells,
      logLik: s.ll,
      impossible: s.imp,
      meanPredictedIndex: n ? s.pi / n : null,
      meanObservedIndex: n ? s.oi / n : null,
    };
  }
  return {
    status: rows.length ? 'ok' : 'insufficient-data',
    rows: rows.length,
    cells,
    logLik: possible ? ll : null,
    meanLogLik: possible ? ll / possible : null,
    impossible,
    belowBase,
    aboveMax,
    degenerateCells: degenerate,
    uncertainCells: cells - degenerate,
    reliability: bins.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      count: b.count,
      meanPredicted: b.count ? b.sumP / b.count : null,
      observedRate: b.count ? b.hits / b.count : null,
    })),
    perAptitude,
    examples,
  };
}
