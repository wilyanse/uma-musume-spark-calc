/**
 * 50 §9 T06 items 1–3 and 6 on the golden dataset (70 §2), plus eligibility, lineage, scenario
 * plugin features and insufficient-data behaviour of `fitTrainingModel`.
 */
import { describe, expect, it } from 'vitest';
import { ModelSnapshot, STAT_KEYS } from '@uma/schema';
import type { RosterVeteran } from '@uma/schema';
import {
  effectiveCardEffect,
  fitTrainingModel,
  fitTrainingModelDetailed,
  InsufficientDataError,
  jacobiEigen,
  ModelInputError,
} from '../../src/index.ts';
import type { EngineContext } from '../../src/index.ts';
import {
  ctx,
  FIXED_ID,
  FIXED_NOW,
  fitOpts,
  goldenFit,
  roster,
  storedSplit,
  truth,
} from './golden-fit.ts';

describe('golden fit on the stored split (training-v2)', () => {
  const { snapshot, report } = goldenFit();

  it('emits a schema-valid training-v2 snapshot with the injected id and clock', () => {
    expect(ModelSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.kind).toBe('training-v2');
    expect(snapshot.id).toBe(FIXED_ID);
    expect(snapshot.trainedAt).toBe(FIXED_NOW.toISOString());
    expect(snapshot.masterVersion).toBe(ctx.masterVersion);
    expect(snapshot.nSamples).toBe(storedSplit.trainIds.length);
    expect(report.splitSource).toBe('explicit');
  });

  it('recovers every planted card effect within ±15% (Q-122: β_id + β_type per unit)', () => {
    const errs: string[] = [];
    let worst = 0;
    let checked = 0;
    for (const card of truth.trainingModel.plantedCards) {
      for (const k of STAT_KEYS) {
        const want = card.perUnit[k];
        if (!want) continue;
        checked++;
        const got = effectiveCardEffect(ctx, snapshot, card.cardId, k);
        const rel = Math.abs(got - want) / Math.abs(want);
        worst = Math.max(worst, rel);
        if (!(rel < 0.15)) errs.push(`${card.cardId}.${k}: ${got} vs ${want}`);
      }
    }
    expect(errs).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(12);
    // Diagnostic (not a gate): zero-effect cards stay near 0 (no type-pool bleed).
    const zero = Math.max(
      ...truth.trainingModel.zeroEffectCards.flatMap((id) =>
        STAT_KEYS.map((k) => Math.abs(effectiveCardEffect(ctx, snapshot, id, k))),
      ),
    );
    expect(zero).toBeLessThan(8);
    console.info(
      `[T06] card recovery: worst ${(worst * 100).toFixed(2)}% over ${checked}; max |zero card| ${zero.toFixed(2)}`,
    );
  });

  it('snapshot coverage80 (Gaussian, Σ_N + row Var[inh]) is in [0.72, 0.88]', () => {
    const c = snapshot.params.holdout.coverage80;
    console.info(
      `[T06] stored split Gaussian coverage80 ${c.toFixed(4)} per stat ${report.holdout.coverage.perStat.map((x) => x.toFixed(4)).join(', ')}; without inheritance ${report.holdout.coverageWithoutInheritance.pooled.toFixed(4)}`,
    );
    expect(c).toBeGreaterThanOrEqual(0.72);
    expect(c).toBeLessThanOrEqual(0.88);
    expect(report.holdout.coverage.cells).toBe(storedSplit.holdoutIds.length * 5);
  });

  it('residualCov is exactly symmetric, min eigenvalue ≥ ε, sigma = √diag exactly', () => {
    const cov = snapshot.params.residualCov;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) expect(cov[i]![j]).toBe(cov[j]![i]);
      expect(snapshot.params.perStat[STAT_KEYS[i]!].sigma).toBe(Math.sqrt(cov[i]![i]!));
    }
    expect(jacobiEigen(cov).values[0]!).toBeGreaterThanOrEqual(report.covariance.epsilon);
    expect(report.covariance.flooredCount).toBe(0);
    expect(report.covariance.warnings).toEqual([]);
    // Σ_N excludes inheritance: S − C̄ on the diagonal (before PSD projection, nothing floored).
    for (let k = 0; k < 5; k++) {
      const d =
        report.covariance.totalSecondMoment[k]![k]! - report.covariance.meanInheritanceCov[k]![k]!;
      expect(cov[k]![k]!).toBeCloseTo(d, 8);
    }
  });

  it('records lineage: eligibility reasons, roles, parent kinds and the recency clock', () => {
    const byReason = new Map<string, number>();
    for (const r of report.rows)
      byReason.set(r.reason ?? r.role!, (byReason.get(r.reason ?? r.role!) ?? 0) + 1);
    expect(byReason.get('low-confidence')).toBe(truth.roster.lowConfidenceIds.length);
    expect(byReason.get('train')).toBe(storedSplit.trainIds.length);
    expect(byReason.get('holdout')).toBe(storedSplit.holdoutIds.length);
    const eligible = report.rows
      .filter((r) => r.eligible)
      .map((r) => r.id)
      .sort();
    expect(eligible).toEqual([...truth.roster.trainingEligibleIds].sort());
    const kinds = report.rows.filter((r) => r.eligible).flatMap((r) => r.parents!);
    expect(new Set(kinds)).toEqual(new Set(['matched', 'guest', 'unmatched']));
    const trainDates = storedSplit.trainIds.map(
      (id) => roster.find((v) => v.id === id)!.career.dateAcquired,
    );
    expect(report.recencyClock).toBe([...trainDates].sort().at(-1));
    expect(report.covariance.ess).toBeGreaterThan(100);
  });

  it('skills: exposure-aware cells, train-only priors, Q-130/Q-131 assumptions visible', () => {
    expect(report.skills.cells.total).toBeGreaterThan(0);
    expect(report.skills.cells.lineageOnly).toBeGreaterThan(0);
    expect(report.skills.cells.lineageOnlyMeanQ).toBeLessThan(1);
    for (const m of ['independent', 'manual'] as const) {
      expect(snapshot.params.skillAcquire[m]['*']).toBeDefined();
      expect(report.skills.prior[m].status).toBe('mom');
      expect(report.skills.methods[m].quadrature).toBeGreaterThan(0);
    }
    expect(report.skills.maxQuadratureRelErr).toBeLessThan(1e-10);
    expect(report.skills.assumptions.join(' ')).toMatch(/Q-130/);
    expect(report.skills.assumptions.join(' ')).toMatch(/Q-131/);
    // The trainee's unique skill is never a candidate (no entry learned from it).
    expect(report.skills.contradictions).toEqual([]);
  });

  it('is deterministic: refitting gives an identical snapshot and report', () => {
    expect(fitTrainingModelDetailed(ctx, roster, fitOpts())).toEqual(goldenFit());
    expect(fitTrainingModel(ctx, [...roster].reverse(), fitOpts())).toEqual(snapshot);
  });
});

describe('the holdout is evaluation only', () => {
  it('perturbing holdout y, dates, train mode, skills and deck leaves λ, β, Σ_N and θ bit-identical', () => {
    const base = goldenFit();
    const hold = new Set(storedSplit.holdoutIds);
    // Holdout rows' RECORDED LINEAGE (their own sparks and parents) is deliberately left intact:
    // a holdout veteran recorded as a train row's matched parent legitimately feeds that train
    // row's inheritance (review N3: lineage coupling, not target leakage). Everything else a
    // holdout row carries is perturbed, and none of it may reach the fitted parameters.
    const perturbed: RosterVeteran[] = roster.map((v, i) => {
      if (!hold.has(v.id)) return v;
      const stats = { ...v.stats };
      STAT_KEYS.forEach((k, j) => {
        stats[k] = Math.max(1, Math.min(2000, Math.round(stats[k] + 1000 * Math.sin(i + j) + 37)));
      });
      const cards = v.deck.map((d) => d.cardId).reverse();
      return {
        ...v,
        stats,
        trainMode: v.trainMode === 'manual' ? 'independent' : 'manual',
        skills: [],
        deck: v.deck.map((d, j) => ({ ...d, cardId: cards[j]!, lb: (d.lb + 2) % 5 })),
        career: { ...v.career, dateAcquired: '2027-01-01' },
      };
    });
    // The coupling is real on the stored split (so the intact lineage is exercised): count train
    // rows' matched-parent references that point at holdout veterans.
    const train = new Set(storedSplit.trainIds);
    const refs = roster
      .filter((v) => train.has(v.id))
      .flatMap((v) => v.parents.map((p) => p.matchedVeteranId))
      .filter((id): id is string => !!id && hold.has(id));
    console.info(
      `[T06] lineage coupling: ${refs.length} train→holdout matched-parent references to ${new Set(refs).size} distinct holdout veterans (of ${hold.size})`,
    );
    expect(refs.length).toBeGreaterThan(0);
    const p = fitTrainingModelDetailed(ctx, perturbed, fitOpts());
    expect(p.report.lambdas).toEqual(base.report.lambdas);
    for (const k of STAT_KEYS) {
      expect(
        Object.is(
          p.snapshot.params.perStat[k].intercept,
          base.snapshot.params.perStat[k].intercept,
        ),
      ).toBe(true);
      expect(p.snapshot.params.perStat[k].coef).toEqual(base.snapshot.params.perStat[k].coef);
      expect(
        p.snapshot.params.perStat[k].coef.every((c, i) =>
          Object.is(c, base.snapshot.params.perStat[k].coef[i]),
        ),
      ).toBe(true);
    }
    expect(p.snapshot.params.residualCov).toEqual(base.snapshot.params.residualCov);
    expect(p.snapshot.params.skillAcquire).toEqual(base.snapshot.params.skillAcquire);
    // ... while the evaluation changes.
    expect(p.snapshot.params.holdout.coverage80).not.toBe(base.snapshot.params.holdout.coverage80);
    expect(p.snapshot.params.holdout.mae).not.toEqual(base.snapshot.params.holdout.mae);
  });
});

describe('fit options and data guards', () => {
  it('the default seeded split is deterministic, 80/20 over eligible rows, and in band (diagnostic)', () => {
    const a = fitTrainingModelDetailed(ctx, roster, { id: () => FIXED_ID, now: () => FIXED_NOW });
    const b = fitTrainingModelDetailed(ctx, roster, { id: () => FIXED_ID, now: () => FIXED_NOW });
    expect(a).toEqual(b);
    expect(a.report.splitSource).toBe('seeded');
    expect(a.report.holdoutIds.length).toBe(
      Math.ceil(0.2 * truth.roster.trainingEligibleIds.length),
    );
    const other = fitTrainingModelDetailed(ctx, roster, {
      splitSeed: 'other',
      id: () => FIXED_ID,
      now: () => FIXED_NOW,
    });
    expect(other.report.holdoutIds).not.toEqual(a.report.holdoutIds);
    console.info(
      `[T06] diagnostic splits (not gates): default seed coverage80 ${a.snapshot.params.holdout.coverage80.toFixed(4)}, 'other' ${other.snapshot.params.holdout.coverage80.toFixed(4)}`,
    );
  });

  it('without injected id/clock it still emits a valid ULID and ISO time', () => {
    const s = fitTrainingModel(ctx, roster, { split: storedSplit });
    expect(ModelSnapshot.shape.id.safeParse(s.id).success).toBe(true);
    expect(s.kind).toBe('training-v2');
  });

  it('rejects overlapping, ineligible or unknown split ids with a typed error', () => {
    const t = storedSplit.trainIds;
    expect(() =>
      fitTrainingModel(ctx, roster, fitOpts({ split: { trainIds: t, holdoutIds: [t[0]!] } })),
    ).toThrow(expect.objectContaining({ code: 'split-overlap' }));
    const low = truth.roster.lowConfidenceIds[0]!;
    expect(() =>
      fitTrainingModel(ctx, roster, fitOpts({ split: { trainIds: t, holdoutIds: [low] } })),
    ).toThrow(expect.objectContaining({ code: 'split-ineligible' }));
    expect(() =>
      fitTrainingModel(
        ctx,
        roster,
        fitOpts({ split: { trainIds: t, holdoutIds: ['01KGQZ0000G01DENCM0000NONE'] } }),
      ),
    ).toThrow(ModelInputError);
  });

  it('insufficient data is a typed error (fewer than 5 train rows or no holdout)', () => {
    const few = truth.roster.trainingEligibleIds
      .slice(0, 4)
      .map((id) => roster.find((v) => v.id === id)!);
    expect(() => fitTrainingModel(ctx, few, fitOpts({ split: undefined }))).toThrow(
      InsufficientDataError,
    );
    expect(() =>
      fitTrainingModel(
        ctx,
        roster,
        fitOpts({ split: { trainIds: storedSplit.trainIds, holdoutIds: [] } }),
      ),
    ).toThrow(InsufficientDataError);
    expect(() => fitTrainingModel(ctx, [], {})).toThrow(InsufficientDataError);
    expect(() => fitTrainingModel(ctx, [roster[0]!, roster[0]!], {})).toThrow(
      expect.objectContaining({ code: 'duplicate-id' }),
    );
  });

  it('lineage rules: matched → roster record, missing match / guest / unmatched → recorded sparks, unread sparks excluded', () => {
    const v = roster.find(
      (x) =>
        truth.roster.trainingEligibleIds.includes(x.id) &&
        x.parents.some((p) => p.matchedVeteranId),
    )!;
    const slot = v.parents.find((p) => p.matchedVeteranId)!.slot;
    const owner = slot === 1 ? 'parent1' : 'parent2';
    // Drop the matched parent from the roster: the row falls back to its recorded sparks.
    const without = roster.filter(
      (x) => x.id !== v.parents.find((p) => p.slot === slot)!.matchedVeteranId,
    );
    const r1 = fitTrainingModelDetailed(ctx, without, { id: () => FIXED_ID, now: () => FIXED_NOW });
    const row = r1.report.rows.find((r) => r.id === v.id)!;
    expect(row.parents![slot - 1]).toBe('matched-missing');
    // A non-matched parent with no recorded sparks has an unknown lineage: excluded.
    const unread = { ...v, sparks: v.sparks.filter((s) => s.owner !== owner) };
    const r2 = fitTrainingModelDetailed(
      ctx,
      without.map((x) => (x.id === v.id ? unread : x)),
      {
        id: () => FIXED_ID,
        now: () => FIXED_NOW,
      },
    );
    expect(r2.report.rows.find((r) => r.id === v.id)!.reason).toBe('parent-sparks-unread');
  });

  it('includes scenario plugin deckFeatures as model features', () => {
    const scenarios = new Map(
      [...ctx.scenarios].map(([id, p]) => [
        id,
        {
          ...p,
          deckFeatures: (deck: RosterVeteran['deck']) => ({
            borrowed: deck.filter((d) => d.borrowed).length,
          }),
        },
      ]),
    );
    const pctx: EngineContext = { ...ctx, scenarios };
    const s = fitTrainingModel(pctx, roster, fitOpts());
    const i = s.params.features.indexOf('deck:borrowed');
    expect(i).toBeGreaterThan(0);
    expect(s.params.perStat.spd.coef[i]).not.toBe(0);
    expect(goldenFit().snapshot.params.features.some((f) => f.startsWith('deck:'))).toBe(false);
  });
});
