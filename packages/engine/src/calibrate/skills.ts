/**
 * 50 §8 skill check (ADR-0002 §3): observed skills of HOLDOUT rows against the exposure-aware
 * prediction P(acquire) = q · E[θ_{mode,skill}], with availability q counted exactly once
 * (q = 1 for deck hint/event or innate, else the recorded-lineage `skillHintProb`) and θ from the
 * candidate's own refit (train rows only). The trainee's own unique skill is excluded (Q-142);
 * an acquired skill with q = 0 is a contradiction (Q-131), counted and excluded.
 */
import type { ModelSnapshot } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import { skillCellsOf } from '../model/fit.ts';
import type { PreparedRow } from '../model/fit.ts';
import { betaMoments } from '../model/skills.ts';

export interface SkillCellSummary {
  cells: number;
  expected: number;
  observed: number;
  logLik: number;
  brier: number;
}

export interface SkillHoldoutCheck {
  rows: number;
  /** Candidate cells with q > 0 scored in the likelihood. */
  cells: number;
  /** Σ q·E[θ] over scored cells. */
  expected: number;
  /** Σ y over scored cells. */
  observed: number;
  /** z = (observed − expected) / √Σ P(1 − P). Null when the variance is 0. */
  z: number | null;
  logLik: number;
  meanLogLik: number | null;
  brier: number;
  guaranteed: SkillCellSummary;
  lineageOnly: SkillCellSummary;
  /** Scored cells whose θ fell back to the mode's global prior `'*'`. */
  priorFallbackCells: number;
  /** y = 1 with q = 0 (Q-131): excluded from the likelihood. */
  contradictions: number;
  contradictionSkills: { skillId: string; count: number }[];
  /** q = 0 and y = 0: no opportunity, no information. */
  noOpportunity: number;
  /** Holdout rows that record their own outfit's unique skill (excluded from cells, Q-142). */
  ownUniqueExcluded: number;
  /** Cells whose predicted probability of the observed outcome underflowed (excluded). */
  nonFiniteCells: number;
  /** Reliability of P(acquire) in 10 bins. */
  reliability: {
    lo: number;
    hi: number;
    count: number;
    meanPredicted: number | null;
    observedRate: number | null;
  }[];
}

const empty = (): SkillCellSummary => ({ cells: 0, expected: 0, observed: 0, logLik: 0, brier: 0 });

export function skillHoldoutCheck(
  ctx: EngineContext,
  snapshot: ModelSnapshot,
  hold: readonly PreparedRow[],
): SkillHoldoutCheck {
  const means = new Map<string, number>();
  const theta = (mode: string, skillId: string): { mean: number; prior: boolean } => {
    const acq = snapshot.params.skillAcquire[mode as 'independent' | 'manual'];
    const key = `${mode}|${skillId}`;
    let m = means.get(key);
    if (m === undefined) {
      const own = acq[skillId];
      m = betaMoments(own ?? acq['*']!).mean;
      means.set(key, m);
    }
    return { mean: m, prior: acq[skillId] === undefined };
  };
  const g = empty();
  const l = empty();
  let contradictions = 0;
  let noOpportunity = 0;
  let ownUnique = 0;
  let nonFinite = 0;
  let prior = 0;
  let variance = 0;
  const contra = new Map<string, number>();
  const bins = Array.from({ length: 10 }, (_, i) => ({
    lo: i / 10,
    hi: (i + 1) / 10,
    count: 0,
    sumP: 0,
    hits: 0,
  }));
  for (const r of hold) {
    const unique = ctx.outfits.get(r.v.outfitId)!.uniqueSkillId;
    if (r.v.skills.some((s) => s.skillId === unique)) ownUnique++;
    for (const c of skillCellsOf(ctx, r.v, r.exp)) {
      if (!(c.q > 0)) {
        if (c.y === 1) {
          contradictions++;
          contra.set(c.skillId, (contra.get(c.skillId) ?? 0) + 1);
        } else noOpportunity++;
        continue;
      }
      const th = theta(r.v.trainMode, c.skillId);
      if (th.prior) prior++;
      const p = c.q * th.mean; // availability once (ADR-0002 §3)
      const ll = c.y === 1 ? Math.log(p) : Math.log1p(-p);
      if (!Number.isFinite(ll)) {
        // p underflowed to 0 (or 1) for the observed outcome: excluded and counted, never scored.
        nonFinite++;
        continue;
      }
      const s = c.sure ? g : l;
      s.cells++;
      s.expected += p;
      s.observed += c.y;
      s.logLik += ll;
      s.brier += (p - c.y) ** 2;
      variance += p * (1 - p);
      const b = bins[Math.min(9, Math.floor(p * 10))]!;
      b.count++;
      b.sumP += p;
      b.hits += c.y;
    }
  }
  const cells = g.cells + l.cells;
  const expected = g.expected + l.expected;
  const observed = g.observed + l.observed;
  const logLik = g.logLik + l.logLik;
  const norm = (s: SkillCellSummary): SkillCellSummary => ({
    ...s,
    brier: s.cells ? s.brier / s.cells : 0,
  });
  return {
    rows: hold.length,
    cells,
    expected,
    observed,
    z: variance > 0 ? (observed - expected) / Math.sqrt(variance) : null,
    logLik,
    meanLogLik: cells ? logLik / cells : null,
    brier: cells ? (g.brier + l.brier) / cells : 0,
    guaranteed: norm(g),
    lineageOnly: norm(l),
    priorFallbackCells: prior,
    contradictions,
    contradictionSkills: [...contra]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([skillId, count]) => ({ skillId, count })),
    noOpportunity,
    ownUniqueExcluded: ownUnique,
    nonFiniteCells: nonFinite,
    reliability: bins.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      count: b.count,
      meanPredicted: b.count ? b.sumP / b.count : null,
      observedRate: b.count ? b.hits / b.count : null,
    })),
  };
}
