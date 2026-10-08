/**
 * 50 §8 / §9 (T15) and 70 §3 F12 on the T08 golden dataset. Inputs: the committed rosters, the
 * stored split ids and the golden context (`loadGoldenContext` from `truth.syntheticInheritance`
 * only). The planted ×1.3 is never passed to `calibrateRules`; only the assertions know it.
 */
import { describe, expect, it } from 'vitest';
import { APT_KEYS, STAT_KEYS } from '@uma/schema';
import type { RosterVeteran } from '@uma/schema';
import {
  calibrateRules,
  CALIBRATION_KIND,
  expectationFromPlan,
  planInheritance,
  recordedParent,
  DEFAULT_CALIBRATION_GRID,
  fitTrainingModelDetailed,
  withBlueStatGainMultiplier,
} from '../../src/index.ts';
import type { CalibrationReport, Legacy } from '../../src/index.ts';
import {
  cached,
  calibrationRoster,
  FIXED_ID,
  FIXED_NOW,
  goldenCtx,
  opts,
  publishedCtx,
  roster,
  storedSplit,
} from './helpers.ts';

const BAND: [number, number] = [1.2, 1.4];
const x13 = () => cached('x1.3', () => goldenCtx(), calibrationRoster);
const base = () => cached('base', () => goldenCtx(), roster);

const statusOf = (r: CalibrationReport) => r.stats.status;

describe('F12: planted blueStatGain ×1.3 (stored split, 50 §8 population)', () => {
  it('suggests a blueStatGain multiplier in [1.2, 1.4]', () => {
    const r = x13();
    expect(r.kind).toBe(CALIBRATION_KIND);
    expect(statusOf(r)).toBe('suggested');
    const m = r.stats.selected!.multiplier;
    console.info(
      `[T15] x1.3 holdout-MAE argmin ${m} (MAE ${r.stats.selected!.holdoutMae.toFixed(3)}); ` +
        `train-CV argmin ${r.stats.trainCvSelected?.multiplier}; bootstrap p05/p50/p95 ` +
        `${r.stats.bootstrap?.p05}/${r.stats.bootstrap?.p50}/${r.stats.bootstrap?.p95}`,
    );
    expect(m).toBeGreaterThanOrEqual(BAND[0]);
    expect(m).toBeLessThanOrEqual(BAND[1]);
    const s = r.suggestions.find((x) => x.rule === 'blueStatGain')!;
    expect(s.multiplier).toBe(m);
    expect(s.change).toBe(true);
    expect(s.current).toEqual([10, 20, 30]);
    s.proposed.forEach((v, i) => expect(v).toBeCloseTo(s.current[i]! * m, 9));
    expect(s.applied).toBe(false);
  });

  it('the minimum is interior: MAE rises towards 1.0 and the grid ends', () => {
    const r = x13();
    const at = (m: number) => r.stats.grid.find((g) => Math.abs(g.multiplier - m) < 1e-9)!;
    const best = r.stats.selected!.holdoutMae;
    expect(r.stats.selected!.atBoundary).toBe(false);
    expect(at(1).holdoutMae).toBeGreaterThan(best);
    expect(at(0.5).holdoutMae).toBeGreaterThan(at(1).holdoutMae);
    expect(at(2).holdoutMae).toBeGreaterThan(best);
  });

  it('the unbiased evaluation (train-only selection, holdout untouched by it) also lands in band and beats current rules', () => {
    const r = x13();
    const t = r.stats.trainCvSelected!;
    expect(t.multiplier).toBeGreaterThanOrEqual(BAND[0]);
    expect(t.multiplier).toBeLessThanOrEqual(BAND[1]);
    expect(r.stats.evaluation.unbiasedHoldoutMae).toBe(t.holdoutMae);
    expect(r.stats.evaluation.unbiasedHoldoutMae!).toBeLessThan(r.stats.current!.holdoutMae);
    expect(r.stats.evaluation.selectedHoldoutMaeIsPostSelection).toBe(true);
  });

  it('documents the population: 260 rows = 20 low-confidence + 44 unmatched-parent + 196 used; split 157/39', () => {
    const r = x13();
    const p = r.population;
    expect(p.rosterRows).toBe(260);
    expect(p.used).toBe(196);
    expect(Object.fromEntries(p.excluded.map((e) => [e.reason, e.count]))).toEqual({
      'low-confidence': 20,
      'parent-not-matched-or-guest': 44,
    });
    expect(p.used + p.excluded.reduce((s, e) => s + e.count, 0)).toBe(p.rosterRows);
    expect(p.rows).toHaveLength(260);
    expect(r.split.source).toBe('explicit');
    expect([r.split.trainIds.length, r.split.holdoutIds.length]).toEqual([157, 39]);
    // Stored split rows outside the 50 §8 population are dropped and counted, never silently.
    expect(r.split.dropped).toHaveLength(44);
    expect(r.split.dropped.every((d) => d.reason === 'parent-not-matched-or-guest')).toBe(true);
    expect(r.split.unused).toBe(0);
    // ADR-0002 related-record coupling is reported, not hidden.
    expect(r.split.lineageCoupling.references).toBeGreaterThan(0);
  });

  it('every grid point is a full train refit: matches fitTrainingModelDetailed holdout MAE and λ', () => {
    const r = x13();
    for (const m of [0.5, 1, 1.2, r.stats.selected!.multiplier, 1.4, 2]) {
      const g = r.stats.grid.find((x) => Math.abs(x.multiplier - m) < 1e-9)!;
      const fit = fitTrainingModelDetailed(
        withBlueStatGainMultiplier(goldenCtx(), m),
        calibrationRoster,
        { split: r.split, now: () => FIXED_NOW, id: () => FIXED_ID },
      );
      const mae = STAT_KEYS.reduce((s, k) => s + fit.report.holdout.mae[k], 0);
      expect(Math.abs(g.holdoutMae - mae)).toBeLessThan(1e-7);
      expect(g.lambdas).toEqual(
        STAT_KEYS.map((k) => [fit.report.lambdas[k].lambdaId, fit.report.lambdas[k].lambdaBase]),
      );
    }
  });

  it('refits the model for each candidate rules context (current and suggested) per ADR-0002', () => {
    const r = x13();
    expect(r.candidates.map((c) => c.multiplier)).toEqual([1, r.stats.selected!.multiplier]);
    for (const c of r.candidates) {
      expect(c.status).toBe('fitted');
      const g = r.stats.grid.find((x) => Math.abs(x.multiplier - c.multiplier) < 1e-9)!;
      expect(Math.abs(c.fit!.holdoutMae - g.holdoutMae)).toBeLessThan(1e-7);
      expect(c.fit!.coverage80).toBeGreaterThan(0);
      expect(c.fit!.coverage80).toBeLessThanOrEqual(1);
    }
    expect(r.warnings.filter((w) => /fast path/.test(w))).toEqual([]);
  });

  it('with/without inheritance: inheritance at the suggested multiplier beats no inheritance', () => {
    const r = x13();
    expect(r.stats.withoutInheritance!.holdoutMae).toBeGreaterThan(r.stats.selected!.holdoutMae);
    expect(r.stats.withoutInheritance!.perStat).toHaveLength(5);
  });

  it('is deterministic for the same options and seed', () => {
    expect(calibrateRules(goldenCtx(), calibrationRoster, opts())).toEqual(x13());
  });
});

describe('base roster and multiplier/grid variants (no planted-1.3 fallback)', () => {
  it('base roster: argmin near 1.0, below the band', () => {
    const r = base();
    expect(statusOf(r)).toBe('suggested');
    const m = r.stats.selected!.multiplier;
    expect(Math.abs(m - 1)).toBeLessThanOrEqual(0.1);
    expect(m).toBeLessThan(BAND[0]);
  });

  it('a context already at ×1.3 suggests ≈ ×1 relative to it on the ×1.3 roster', () => {
    const r = calibrateRules(goldenCtx(1.3), calibrationRoster, opts());
    expect(statusOf(r)).toBe('suggested');
    const rel = r.stats.selected!.multiplier;
    expect(rel * 1.3).toBeGreaterThanOrEqual(BAND[0]);
    expect(rel * 1.3).toBeLessThanOrEqual(BAND[1]);
    expect(Math.abs(rel - 1)).toBeLessThan(0.1);
  });

  it('a context at ×2 suggests a multiplier < 1 that maps back into the band', () => {
    const r = calibrateRules(goldenCtx(2), calibrationRoster, opts());
    const rel = r.stats.selected!.multiplier;
    expect(rel).toBeLessThan(1);
    expect(rel * 2).toBeGreaterThanOrEqual(BAND[0]);
    expect(rel * 2).toBeLessThanOrEqual(BAND[1]);
  });

  it.each([
    [{ min: 0, max: 4, step: 0.01 }],
    [{ min: 0.5, max: 3, step: 0.01 }],
    [{ min: 1, max: 2, step: 0.01 }],
    [{ min: 0.5, max: 2, step: 0.05 }],
    [{ min: 0.73, max: 1.91, step: 0.03 }],
  ])('wider/coarser/offset grid %o keeps the same interior optimum region', (grid) => {
    const r = calibrateRules(goldenCtx(), calibrationRoster, opts({ grid, bootstrap: 0 }));
    expect(statusOf(r)).toBe('suggested');
    const m = r.stats.selected!.multiplier;
    expect(m).toBeGreaterThanOrEqual(BAND[0]);
    expect(m).toBeLessThanOrEqual(BAND[1]);
    // On a 0.01 grid containing the default one, the argmin is the default argmin exactly.
    if (grid.step === 0.01) expect(m).toBe(x13().stats.selected!.multiplier);
  });

  it('a grid that excludes the optimum reports a boundary, never a suggestion', () => {
    const r = calibrateRules(
      goldenCtx(),
      calibrationRoster,
      opts({ grid: { min: 0.5, max: 1.15, step: 0.01 }, bootstrap: 0 }),
    );
    expect(statusOf(r)).toBe('boundary');
    expect(r.stats.selected!.atBoundary).toBe(true);
    expect(r.stats.selected!.multiplier).toBe(1.15);
    expect(r.suggestions.filter((s) => s.rule === 'blueStatGain')).toEqual([]);
    expect(r.warnings.some((w) => /boundary/.test(w))).toBe(true);
  });

  it('the default grid is 0.5..2.0 step 0.01 (151 points) and 1.0 is on it', () => {
    expect(DEFAULT_CALIBRATION_GRID).toEqual({ min: 0.5, max: 2, step: 0.01 });
    const r = x13();
    expect(r.stats.grid).toHaveLength(151);
    expect(r.stats.grid.some((g) => g.multiplier === 1)).toBe(true);
  });

  it('a seeded split (no stored split) on the ×1.3 roster is still in band (robustness)', () => {
    const r = calibrateRules(goldenCtx(), calibrationRoster, opts({ split: undefined }));
    expect(r.split.source).toBe('seeded');
    expect(r.split.trainIds.length + r.split.holdoutIds.length).toBe(196);
    const m = r.stats.selected!.multiplier;
    expect(m).toBeGreaterThanOrEqual(BAND[0]);
    expect(m).toBeLessThanOrEqual(BAND[1]);
  });
});

describe('published context: zero placeholder blueStatGain is nonidentifiable', () => {
  const r = cached('published', publishedCtx, calibrationRoster);
  it('proposes no blueStatGain factor and says why', () => {
    expect(statusOf(r)).toBe('nonidentifiable');
    expect(r.stats.selected).toBeNull();
    expect(r.suggestions.filter((s) => s.rule === 'blueStatGain')).toEqual([]);
    expect(r.stats.nonidentifiable!.reasons.join(' ')).toMatch(/zero/);
    expect(r.stats.nonidentifiable!.reasons.join(' ')).toMatch(/inheritance turns/);
    expect(r.stats.grid).toEqual([]);
    // The rest of the report still exists.
    expect(r.aptitude.status).toBe('ok');
    expect(r.skills.status).toBe('ok');
    expect(r.notCalibrated.map((n) => n.rule)).toContain('blueStatGain');
  });
});

describe('the holdout is evaluation only (per candidate)', () => {
  const perturbed = calibrationRoster.map((v) => {
    if (!storedSplit.holdoutIds.includes(v.id)) return v;
    const c = structuredClone(v);
    STAT_KEYS.forEach((k, i) => (c.stats[k] = c.stats[k] + 50 * Math.sin(i + c.id.length) + 17));
    c.skills = [];
    return c;
  });
  const p = calibrateRules(goldenCtx(), perturbed, opts());

  it('train criteria, λ choices and candidate fit parameters are bit-identical', () => {
    const r = x13();
    expect(p.stats.grid.map((g) => [g.lambdas, g.trainCvMae])).toEqual(
      r.stats.grid.map((g) => [g.lambdas, g.trainCvMae]),
    );
    expect(p.stats.trainCvSelected).toBeTruthy();
    expect(p.stats.trainCvSelected!.multiplier).toBe(r.stats.trainCvSelected!.multiplier);
    // Every candidate refit at a multiplier both runs share has bit-identical train parameters.
    let shared = 0;
    for (const c of p.candidates) {
      const o = r.candidates.find((x) => x.multiplier === c.multiplier);
      if (!o) continue;
      shared++;
      expect(c.fit!.trainFingerprint).toBe(o.fit!.trainFingerprint);
      expect(c.fit!.lambdas).toEqual(o.fit!.lambdas);
      expect(c.fit!.sigma).toEqual(o.fit!.sigma);
    }
    expect(shared).toBeGreaterThanOrEqual(1);
    // And at r's suggested multiplier even if p suggests a different one.
    const m = r.stats.selected!.multiplier;
    const fitAt = (rows: readonly RosterVeteran[]) =>
      fitTrainingModelDetailed(withBlueStatGainMultiplier(goldenCtx(), m), rows, {
        split: r.split,
        now: () => FIXED_NOW,
        id: () => FIXED_ID,
      }).snapshot.params;
    const a = fitAt(calibrationRoster);
    const b = fitAt(perturbed);
    expect([b.perStat, b.residualCov, b.skillAcquire]).toEqual([
      a.perStat,
      a.residualCov,
      a.skillAcquire,
    ]);
    expect(b.holdout).not.toEqual(a.holdout);
  });

  it('holdout metrics (and possibly the recommendation) change', () => {
    const r = x13();
    expect(p.stats.grid.map((g) => g.holdoutMae)).not.toEqual(
      r.stats.grid.map((g) => g.holdoutMae),
    );
    expect(p.skills.candidates[0]!.holdout.observed).toBe(0);
  });

  it('perturbing train stats does change the train fit (the check is not vacuous)', () => {
    const t = calibrationRoster.map((v) => {
      if (!storedSplit.trainIds.includes(v.id)) return v;
      const c = structuredClone(v);
      c.stats.spd += 25;
      return c;
    });
    const q = calibrateRules(goldenCtx(), t, opts({ bootstrap: 0 }));
    expect(q.candidates[0]!.fit!.trainFingerprint).not.toBe(
      x13().candidates[0]!.fit!.trainFingerprint,
    );
  });
});

describe('aptitude and skill checks on the golden data', () => {
  it('aptitude: finite log-likelihood from the predicted aptitudeDist, reliability table, no impossible cells', () => {
    const a = x13().aptitude;
    expect(a.status).toBe('ok');
    expect(a.rows).toBe(196);
    expect(a.cells).toBe(1960);
    expect(a.impossible).toBe(0);
    expect(Number.isFinite(a.logLik)).toBe(true);
    expect(a.logLik).toBeLessThan(0);
    expect(a.degenerateCells + a.uncertainCells).toBe(a.cells);
    expect(a.reliability).toHaveLength(10);
    const n = a.reliability.reduce((s, b) => s + b.count, 0);
    expect(n).toBeGreaterThan(0);
    for (const b of a.reliability) {
      if (b.count === 0) expect(b.meanPredicted).toBeNull();
      else {
        expect(b.meanPredicted!).toBeGreaterThanOrEqual(b.lo);
        expect(b.meanPredicted!).toBeLessThanOrEqual(b.hi);
        expect(b.observedRate!).toBeGreaterThanOrEqual(0);
        expect(b.observedRate!).toBeLessThanOrEqual(1);
      }
    }
    // Expected vs observed grade index per aptitude (a calibration signal, not a suggestion).
    expect(Object.keys(a.perAptitude)).toHaveLength(10);
  });

  it('skills: exposure-aware q·E[θ] on holdout cells, identical across blue multipliers (q does not depend on blueStatGain)', () => {
    const s = x13().skills;
    expect(s.status).toBe('ok');
    expect(s.candidates).toHaveLength(2);
    const [cur, sel] = s.candidates;
    expect(sel!.holdout).toEqual(cur!.holdout);
    const h = cur!.holdout;
    expect(h.cells).toBeGreaterThan(0);
    expect(h.cells).toBe(h.guaranteed.cells + h.lineageOnly.cells);
    expect(Number.isFinite(h.logLik)).toBe(true);
    expect(Number.isFinite(h.brier)).toBe(true);
    expect(h.expected).toBeGreaterThan(0);
    expect(h.contradictions).toBe(0);
    // The golden roster records each veteran's own unique skill; it is excluded (Q-142).
    expect(h.ownUniqueExcluded).toBe(39);
  });
});

describe('independent recomputation through the public API', () => {
  const r = x13();
  const ctx = goldenCtx();
  const byId = new Map(calibrationRoster.map((v) => [v.id, v]));
  const expOf = (id: string) => {
    const v = byId.get(id)!;
    const p = [1, 2].map((s) => recordedParent(v, s as 1 | 2, byId)!.legacy) as [Legacy, Legacy];
    return expectationFromPlan(planInheritance(ctx, v.outfitId, p, v.scenarioId));
  };

  it('aptitude log-likelihood = Σ log aptitudeDist[observed] over the used rows', () => {
    let ll = 0;
    for (const row of r.population.rows.filter((x) => x.included)) {
      const v = byId.get(row.id)!;
      const d = expOf(row.id).aptitudeDist;
      for (const a of APT_KEYS) ll += Math.log(d[a][v.aptitudes[a]]);
    }
    expect(r.aptitude.logLik!).toBeCloseTo(ll, 9);
  });

  it('skill expected count = Σ q·E[θ] (availability once) from the current refit', () => {
    const snap = fitTrainingModelDetailed(ctx, calibrationRoster, {
      split: r.split,
      now: () => FIXED_NOW,
      id: () => FIXED_ID,
    }).snapshot;
    let expected = 0;
    let lineage = 0;
    let observed = 0;
    for (const id of r.split.holdoutIds) {
      const v = byId.get(id)!;
      const exp = expOf(id);
      const outfit = ctx.outfits.get(v.outfitId)!;
      const sure = new Set(outfit.innateSkillIds);
      for (const d of v.deck) {
        const c = ctx.cards.get(d.cardId)!;
        [...c.hintSkillIds, ...c.eventSkillIds].forEach((s) => sure.add(s));
      }
      const cand = new Set([...sure, ...Object.keys(exp.skillHintProb)]);
      cand.delete(outfit.uniqueSkillId);
      const acquired = new Set(v.skills.map((s) => s.skillId));
      for (const s of cand) {
        const q = sure.has(s) ? 1 : exp.skillHintProb[s]!;
        if (!(q > 0)) continue;
        const beta =
          snap.params.skillAcquire[v.trainMode][s] ?? snap.params.skillAcquire[v.trainMode]['*']!;
        const p = q * (beta.a / (beta.a + beta.b));
        expected += p;
        if (!sure.has(s)) lineage += p;
        if (acquired.has(s)) observed++;
      }
    }
    const h = r.skills.candidates[0]!.holdout;
    expect(h.expected).toBeCloseTo(expected, 9);
    expect(h.lineageOnly.expected).toBeCloseTo(lineage, 9);
    expect(h.observed).toBe(observed);
    expect(h.lineageOnly.cells).toBeGreaterThan(0);
  });
});
