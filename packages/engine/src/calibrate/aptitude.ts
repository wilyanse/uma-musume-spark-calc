/**
 * 50 §8.1 aptitude check: observed final grades against the predicted `aptitudeDist` (trainee
 * base + pink steps, capped at S) on the recorded lineage. No fit is involved, so every used row
 * contributes.
 *
 * Likelihood semantics (T15 review 1, B1; Q-158):
 * - The FULL log-likelihood Σ log p(observed) over every cell is −∞ as soon as one observed grade
 *   has p = 0. It is then reported as `logLik: null` (JSON-safe, never −Infinity and never a
 *   finite stand-in) with `fullLikelihood: 'zero-probability-observed'`.
 * - `conditionalLogLik` sums log p over the `possibleCells` only (p > 0). It is a separately
 *   named diagnostic with its own denominator, not the model's likelihood.
 * - Impossible cells are counted as `belowBase` (below the trainee's base grade), `aboveMax`
 *   (above every reachable grade) or `unreachable` (an interior support gap, e.g. pink gain 2
 *   skipping a grade); the three always sum to `impossible`.
 * - A cell whose most likely grade has p ≥ 1 − DEGENERATE_TOL carries no calibration information.
 *   When every cell is degenerate the check is `uninformative`, not `ok`.
 */
import { APT_KEYS, GRADES } from '@uma/schema';
import type { AptKey, Grade } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import type { PreparedRow } from '../model/fit.ts';

export const RELIABILITY_BINS = 10;
/** A cell whose most likely grade has p ≥ 1 − this carries no calibration information. */
export const DEGENERATE_TOL = 1e-12;

export type FullLikelihoodState = 'finite' | 'zero-probability-observed' | 'no-cells';
export type ImpossibleReason = 'below-base' | 'above-max' | 'unreachable';

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  /** Mean predicted probability in the bin (null when empty). */
  meanPredicted: number | null;
  /** Observed frequency of the predicted event (null when empty). */
  observedRate: number | null;
}

interface LikelihoodFields {
  /**
   * 'finite': every observed grade has p > 0 and `logLik` is the full log-likelihood.
   * 'zero-probability-observed': ≥ 1 observed grade has p = 0, so the full log-likelihood is −∞
   * and `logLik`/`meanLogLik` are null. 'no-cells': nothing to score.
   */
  fullLikelihood: FullLikelihoodState;
  /** Full Σ log p(observed) over every cell; null unless `fullLikelihood` is 'finite'. */
  logLik: number | null;
  /** `logLik` / cells; null unless `fullLikelihood` is 'finite'. */
  meanLogLik: number | null;
  /** Cells whose observed grade has p > 0 (the conditional denominator). */
  possibleCells: number;
  /** Σ log p(observed) over `possibleCells` only (null when there are none). Not the full likelihood. */
  conditionalLogLik: number | null;
  /** `conditionalLogLik` / `possibleCells`. */
  conditionalMeanLogLik: number | null;
  impossible: number;
  belowBase: number;
  aboveMax: number;
  /** Impossible although between reachable grades (a gap in the predicted support). */
  unreachable: number;
  degenerateCells: number;
  uncertainCells: number;
}

export interface AptitudeStat extends LikelihoodFields {
  status: 'ok' | 'uninformative';
  cells: number;
  /** Mean predicted grade index (G = 0 … S = 7) and mean observed index, over possible cells. */
  meanPredictedIndex: number | null;
  meanObservedIndex: number | null;
}

export interface AptitudeCheck extends LikelihoodFields {
  /**
   * 'ok': at least one cell is uncertain (informative). 'uninformative': every cell is degenerate
   * (the prediction is certain), so neither the likelihood nor reliability can discriminate.
   * 'insufficient-data': no rows.
   */
  status: 'ok' | 'uninformative' | 'insufficient-data';
  /** Why the check is uninformative (null otherwise). */
  uninformative: string | null;
  rows: number;
  cells: number;
  /**
   * One (cell, grade) event per grade with 0 < p < 1 on uncertain cells; predicted p against the
   * indicator observed == grade, in 10 equal-width bins ([0.9, 1.0] closed).
   */
  reliability: ReliabilityBin[];
  perAptitude: Partial<Record<AptKey, AptitudeStat>>;
  examples: { id: string; apt: AptKey; observed: Grade; reason: ImpossibleReason }[];
}

interface Acc {
  cells: number;
  ll: number;
  possible: number;
  imp: number;
  below: number;
  above: number;
  gap: number;
  degenerate: number;
  pi: number;
  oi: number;
}

const acc = (): Acc => ({
  cells: 0,
  ll: 0,
  possible: 0,
  imp: 0,
  below: 0,
  above: 0,
  gap: 0,
  degenerate: 0,
  pi: 0,
  oi: 0,
});

function likelihood(a: Acc): LikelihoodFields {
  const state: FullLikelihoodState =
    a.cells === 0 ? 'no-cells' : a.imp > 0 ? 'zero-probability-observed' : 'finite';
  const finite = state === 'finite';
  return {
    fullLikelihood: state,
    logLik: finite ? a.ll : null,
    meanLogLik: finite ? a.ll / a.cells : null,
    possibleCells: a.possible,
    conditionalLogLik: a.possible ? a.ll : null,
    conditionalMeanLogLik: a.possible ? a.ll / a.possible : null,
    impossible: a.imp,
    belowBase: a.below,
    aboveMax: a.above,
    unreachable: a.gap,
    degenerateCells: a.degenerate,
    uncertainCells: a.cells - a.degenerate,
  };
}

export function aptitudeCheck(ctx: EngineContext, rows: readonly PreparedRow[]): AptitudeCheck {
  const bins = Array.from({ length: RELIABILITY_BINS }, (_, i) => ({
    lo: i / RELIABILITY_BINS,
    hi: (i + 1) / RELIABILITY_BINS,
    count: 0,
    sumP: 0,
    hits: 0,
  }));
  const per = new Map<AptKey, Acc>();
  const all = acc();
  const examples: AptitudeCheck['examples'] = [];
  for (const r of rows) {
    const outfit = ctx.outfits.get(r.v.outfitId)!;
    for (const apt of APT_KEYS) {
      const dist = r.exp.aptitudeDist[apt];
      const obs = r.v.aptitudes[apt];
      const p = dist[obs] ?? 0;
      let s = per.get(apt);
      if (!s) per.set(apt, (s = acc()));
      s.cells++;
      all.cells++;
      let maxP = 0;
      let maxReach = -1;
      GRADES.forEach((g, i) => {
        const pg = dist[g] ?? 0;
        maxP = Math.max(maxP, pg);
        if (pg > 0) maxReach = i;
      });
      if (maxP >= 1 - DEGENERATE_TOL) {
        s.degenerate++;
        all.degenerate++;
      } else {
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
        const oi = GRADES.indexOf(obs);
        const reason: ImpossibleReason =
          oi < GRADES.indexOf(outfit.aptitudes[apt])
            ? 'below-base'
            : oi > maxReach
              ? 'above-max'
              : 'unreachable';
        for (const t of [s, all]) {
          t.imp++;
          if (reason === 'below-base') t.below++;
          else if (reason === 'above-max') t.above++;
          else t.gap++;
        }
        if (examples.length < 20) examples.push({ id: r.v.id, apt, observed: obs, reason });
        continue;
      }
      const lp = Math.log(p);
      let mean = 0;
      GRADES.forEach((g, i) => (mean += i * (dist[g] ?? 0)));
      for (const t of [s, all]) {
        t.possible++;
        t.ll += lp;
      }
      s.pi += mean;
      s.oi += GRADES.indexOf(obs);
    }
  }
  const perAptitude: AptitudeCheck['perAptitude'] = {};
  for (const apt of APT_KEYS) {
    const s = per.get(apt);
    if (!s) continue;
    perAptitude[apt] = {
      status: s.cells > s.degenerate ? 'ok' : 'uninformative',
      cells: s.cells,
      ...likelihood(s),
      meanPredictedIndex: s.possible ? s.pi / s.possible : null,
      meanObservedIndex: s.possible ? s.oi / s.possible : null,
    };
  }
  const status: AptitudeCheck['status'] = !rows.length
    ? 'insufficient-data'
    : all.cells > all.degenerate
      ? 'ok'
      : 'uninformative';
  return {
    status,
    uninformative:
      status === 'uninformative'
        ? `all ${all.cells} cells are degenerate (one grade has predicted p ≥ 1 − ${DEGENERATE_TOL}): the prediction is certain, so the likelihood and reliability table carry no calibration information`
        : null,
    rows: rows.length,
    cells: all.cells,
    ...likelihood(all),
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
