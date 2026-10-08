/**
 * T15 review round 1 (docs/reviews/T15-review-1.md): B1, S1–S4, N1, N2. Each block pins the
 * corrected semantics; none of them changes a golden input, threshold or the F12 band.
 */
import { describe, expect, it } from 'vitest';
import { APT_KEYS, GRADES } from '@uma/schema';
import type { AptKey } from '@uma/schema';
import {
  calibrateRules,
  expectationFromPlan,
  planInheritance,
  recordedParent,
} from '../../src/index.ts';
import type { CalibrationReport, EngineContext, Legacy } from '../../src/index.ts';
import {
  blueIdentifiability,
  MIN_BOOTSTRAP_HOLDOUT,
  MIN_SEARCH_GRID_POINTS,
  selectionAgreement,
} from '../../src/calibrate/index.ts';
import {
  FULL_CALIBRATION_TIMEOUT_MS,
  cached,
  calibrationRoster,
  goldenCtx,
  opts,
  publishedCtx,
} from './helpers.ts';

/** Explicit bounded timeout for full-calibration tests (review 2, S-C). */
const T = FULL_CALIBRATION_TIMEOUT_MS;

const x13 = () => cached('x1.3', () => goldenCtx(), calibrationRoster);
const published = () =>
  cached('published', publishedCtx, calibrationRoster, opts({ bootstrap: 0 }));
const jsonRoundTrip = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
const byId = new Map(calibrationRoster.map((v) => [v.id, v]));
const guestGuest = calibrationRoster.filter(
  (v) => v.minConfidence >= 0.9 && v.parents.every((p) => p.isGuest),
);

describe('B1: full aptitude likelihood is never a fake perfect score', () => {
  it(
    'published context: 87 zero-probability cells -> full logLik null, explicit state, uninformative',
    () => {
      const r = published();
      const a = r.aptitude;
      expect(a.impossible).toBe(87);
      expect(a.fullLikelihood).toBe('zero-probability-observed');
      expect(a.logLik).toBeNull();
      expect(a.meanLogLik).toBeNull();
      // The finite sum over possible cells is separately named, with its own denominator.
      expect(a.possibleCells).toBe(a.cells - a.impossible);
      expect(a.conditionalLogLik).toBe(0);
      expect(a.conditionalMeanLogLik).toBe(0);
      // Every cell is degenerate: the check carries no calibration information.
      expect(a.degenerateCells).toBe(a.cells);
      expect(a.status).toBe('uninformative');
      expect(a.uninformative).toMatch(/degenerate/);
      expect(r.status).not.toBe('complete');
      expect(r.warnings.join(' ')).toMatch(/full log-likelihood is −∞|zero-probability/);
      for (const apt of APT_KEYS) {
        const s = a.perAptitude[apt]!;
        expect(s.status).toBe('uninformative');
        expect(s.possibleCells).toBe(s.cells - s.impossible);
        if (s.impossible > 0) {
          expect(s.fullLikelihood).toBe('zero-probability-observed');
          expect(s.logLik).toBeNull();
          expect(s.meanLogLik).toBeNull();
        }
        expect(s.conditionalLogLik).toBe(0);
      }
      expect(jsonRoundTrip(a)).toEqual(a);
    },
    T,
  );

  it(
    'golden ×1.3: no impossible cell -> the full likelihood is the actual finite value',
    () => {
      const a = x13().aptitude;
      expect(a.status).toBe('ok');
      expect(a.fullLikelihood).toBe('finite');
      expect(a.possibleCells).toBe(a.cells);
      expect(a.logLik!).toBeLessThan(0);
      expect(a.logLik).toBe(a.conditionalLogLik);
      expect(a.meanLogLik).toBeCloseTo(a.logLik! / a.cells, 12);
      for (const apt of APT_KEYS) {
        const s = a.perAptitude[apt]!;
        expect(s.fullLikelihood).toBe('finite');
        expect(Number.isFinite(s.logLik)).toBe(true);
        expect(s.logLik).toBe(s.conditionalLogLik);
      }
      expect(jsonRoundTrip(a)).toEqual(a);
    },
    T,
  );
});

describe('S3: impossible aptitude cells are classified below-base / above-max / unreachable', () => {
  it(
    'pinkGradeGain 2/2/2 creates interior gaps: classified unreachable, counts reconcile',
    () => {
      const g = goldenCtx();
      const ctx: EngineContext = { ...g, tables: { ...g.tables, pinkGradeGain: [2, 2, 2] } };
      const r = calibrateRules(
        ctx,
        calibrationRoster,
        opts({ bootstrap: 0, grid: { min: 1, max: 1.6, step: 0.1 } }),
      );
      const a = r.aptitude;
      // Independent classification from the public API.
      let below = 0;
      let above = 0;
      let gap = 0;
      const perGap = new Map<AptKey, number>();
      for (const row of r.population.rows.filter((x) => x.included)) {
        const v = byId.get(row.id)!;
        const p = [1, 2].map((s) => recordedParent(v, s as 1 | 2, byId)!.legacy) as [
          Legacy,
          Legacy,
        ];
        const d = expectationFromPlan(
          planInheritance(ctx, v.outfitId, p, v.scenarioId),
        ).aptitudeDist;
        const base = ctx.outfits.get(v.outfitId)!.aptitudes;
        for (const apt of APT_KEYS) {
          const obs = v.aptitudes[apt];
          if ((d[apt][obs] ?? 0) > 0) continue;
          const oi = GRADES.indexOf(obs);
          const maxi = Math.max(...GRADES.map((x, i) => ((d[apt][x] ?? 0) > 0 ? i : -1)));
          if (oi < GRADES.indexOf(base[apt])) below++;
          else if (oi > maxi) above++;
          else {
            gap++;
            perGap.set(apt, (perGap.get(apt) ?? 0) + 1);
          }
        }
      }
      expect(gap).toBeGreaterThan(0); // not vacuous
      expect(a.unreachable).toBe(gap);
      expect(a.aboveMax).toBe(above);
      expect(a.belowBase).toBe(below);
      expect(a.belowBase + a.aboveMax + a.unreachable).toBe(a.impossible);
      for (const apt of APT_KEYS) {
        const s = a.perAptitude[apt]!;
        expect(s.belowBase + s.aboveMax + s.unreachable).toBe(s.impossible);
        expect(s.unreachable).toBe(perGap.get(apt) ?? 0);
      }
      expect(a.examples.some((e) => e.reason === 'unreachable')).toBe(true);
      expect(a.examples.every((e) => e.reason !== 'above-max')).toBe(above === 0);
    },
    T,
  );

  it(
    'published context: the 87 impossible cells reconcile (all above-max, none unreachable)',
    () => {
      const a = published().aptitude;
      expect(a.belowBase + a.aboveMax + a.unreachable).toBe(a.impossible);
      expect(a.unreachable).toBe(0);
    },
    T,
  );
});

describe('S1: a one- or two-point grid is not a search', () => {
  it('the minimum is 3 points', () => expect(MIN_SEARCH_GRID_POINTS).toBe(3));

  it.each([
    [{ min: 1.3, max: 1.3, step: 0.01 }, 1],
    [{ min: 1.3, max: 1.31, step: 0.01 }, 2],
  ])(
    'grid %o (%i point(s)): insufficient-data, no suggestion, no zero-width interval',
    (grid, n) => {
      const r = calibrateRules(goldenCtx(), calibrationRoster, opts({ grid, bootstrap: 50 }));
      expect(r.stats.grid).toHaveLength(n);
      expect(r.stats.status).toBe('insufficient-data');
      expect(r.stats.insufficient).toMatch(/≥ 3 grid points/);
      expect(r.stats.selected).toBeNull();
      expect(r.stats.bootstrap).toBeNull();
      expect(r.stats.uncertainty.status).toBe('grid-too-small');
      expect(r.suggestions).toEqual([]);
      expect(r.candidates.map((c) => c.multiplier)).toEqual([1]);
      expect(r.notCalibrated.map((x) => x.rule)).toContain('blueStatGain');
    },
    T,
  );

  it(
    'the default grid is unaffected',
    () => {
      const r = x13();
      expect(r.stats.grid).toHaveLength(151);
      expect(r.stats.status).toBe('suggested');
    },
    T,
  );
});

describe('S2: tiny holdouts give no confident-looking interval', () => {
  it(`minimum holdout for the bootstrap is documented (${20})`, () => {
    expect(MIN_BOOTSTRAP_HOLDOUT).toBe(20);
  });

  it(
    '5 train + 1 holdout: bootstrap null with a reason, consistentWithCurrent null, disagreement warned',
    () => {
      const six = guestGuest.slice(0, 6);
      const r = calibrateRules(
        goldenCtx(),
        six,
        opts({
          split: { trainIds: six.slice(0, 5).map((v) => v.id), holdoutIds: [six[5]!.id] },
          bootstrap: 100,
        }),
      );
      expect(r.split.holdoutIds).toHaveLength(1);
      expect(r.stats.bootstrap).toBeNull();
      expect(r.stats.uncertainty.status).toBe('insufficient-holdout');
      expect(r.stats.uncertainty.reason).toMatch(/1 holdout row.*≥ 20/);
      expect(r.stats.selectionAgreement).not.toBeNull();
      const ag = r.stats.selectionAgreement!;
      expect(ag.withinInterval).toBeNull();
      for (const s of r.suggestions) expect(s.consistentWithCurrent).toBeNull();
      // On this controlled 1-row holdout the selections differ (1.42 vs 1.97 at review time).
      expect(ag.holdout).not.toBe(ag.trainCv);
      expect(r.warnings.join(' ')).toMatch(/selections disagree.*no bootstrap interval/);
      expect(jsonRoundTrip(r)).toEqual(r);
    },
    T,
  );

  it(
    'golden ×1.3: bootstrap available, labelled conditional, selections agree within it',
    () => {
      const r = x13();
      expect(r.stats.uncertainty.status).toBe('available');
      expect(r.stats.uncertainty.scope).toMatch(/holdout-row resampling.*not full uncertainty/);
      expect(r.stats.bootstrap).not.toBeNull();
      expect(r.stats.selectionAgreement).toMatchObject({
        holdout: r.stats.selected!.multiplier,
        trainCv: r.stats.trainCvSelected!.multiplier,
        withinInterval: true,
      });
      expect(r.warnings.join(' ')).not.toMatch(/selections disagree/);
    },
    T,
  );

  it('selectionAgreement: outside the reported interval -> disagreement; no interval -> unknown', () => {
    const boot = { p05: 1.3, p95: 1.37 };
    expect(selectionAgreement(1.33, 1.31, boot)).toMatchObject({ withinInterval: true });
    expect(selectionAgreement(1.33, 1.2, boot)).toMatchObject({ withinInterval: false });
    expect(selectionAgreement(1.42, 1.97, null)).toMatchObject({
      withinInterval: null,
      difference: 1.97 - 1.42,
    });
  });
});

describe('S4: zero scored skill cells never read as a perfect score', () => {
  const g = goldenCtx();
  const noSkillSource = (zeroAll: boolean): EngineContext => {
    const z: [number, number, number] = [0, 0, 0];
    return {
      ...g,
      cards: new Map(
        [...g.cards].map(([k, c]) => [k, { ...c, hintSkillIds: [], eventSkillIds: [] }]),
      ),
      outfits: new Map([...g.outfits].map(([k, o]) => [k, { ...o, innateSkillIds: [] }])),
      tables: {
        ...g.tables,
        activation: zeroAll
          ? { ...g.tables.activation, green: z, white: z, race: z, scenario: z }
          : g.tables.activation,
      },
    };
  };

  it(
    'no scored cell at all: totals null, status insufficient-data, report not complete',
    () => {
      const r = calibrateRules(noSkillSource(true), calibrationRoster, opts({ bootstrap: 0 }));
      const h = r.skills.candidates[0]!.holdout;
      expect(h.cells).toBe(0);
      expect(h.status).toBe('insufficient-data');
      expect(h.logLik).toBeNull();
      expect(h.meanLogLik).toBeNull();
      expect(h.brier).toBeNull();
      expect(h.z).toBeNull();
      for (const s of [h.guaranteed, h.lineageOnly]) {
        expect(s.status).toBe('insufficient-data');
        expect(s.logLik).toBeNull();
        expect(s.brier).toBeNull();
      }
      expect(r.skills.status).toBe('insufficient-data');
      expect(r.status).not.toBe('complete');
      expect(jsonRoundTrip(r.skills)).toEqual(r.skills);
    },
    T,
  );

  it(
    'an empty subgroup is null while the other keeps its real metrics',
    () => {
      const r = calibrateRules(noSkillSource(false), calibrationRoster, opts({ bootstrap: 0 }));
      const h = r.skills.candidates[0]!.holdout;
      expect(h.guaranteed.cells).toBe(0);
      expect(h.guaranteed.status).toBe('insufficient-data');
      expect(h.guaranteed.logLik).toBeNull();
      expect(h.guaranteed.brier).toBeNull();
      expect(h.lineageOnly.cells).toBeGreaterThan(0);
      expect(h.lineageOnly.status).toBe('ok');
      expect(h.lineageOnly.logLik!).toBeLessThan(0);
      expect(h.status).toBe('ok');
      expect(r.skills.status).toBe('ok');
    },
    T,
  );

  it(
    'golden: real numeric metrics, status ok',
    () => {
      const h = x13().skills.candidates[0]!.holdout;
      expect(h.status).toBe('ok');
      expect(h.logLik!).toBeLessThan(0);
      expect(h.brier!).toBeGreaterThan(0);
      expect(h.guaranteed.status).toBe('ok');
      expect(h.lineageOnly.status).toBe('ok');
    },
    T,
  );
});

describe('N1: the train-CV selection evaluation is named precisely', () => {
  it(
    'holdoutMaeOfTrainCvSelection replaces unbiasedHoldoutMae',
    () => {
      const r: CalibrationReport = x13();
      expect(r.stats.evaluation.holdoutMaeOfTrainCvSelection).toBe(
        r.stats.trainCvSelected!.holdoutMae,
      );
      expect('unbiasedHoldoutMae' in r.stats.evaluation).toBe(false);
      expect(r.stats.evaluation.note).toMatch(/lineage/);
      expect(r.stats.evaluation.note).not.toMatch(/unbiased/);
    },
    T,
  );
});

describe('N2: blueStatGain signal must exist on train rows', () => {
  it(
    'holdout-only sensitivity (train rows carry no parent blue spark) is nonidentifiable',
    () => {
      const rows = guestGuest.map((v) => structuredClone(v));
      const train = rows.slice(0, 28);
      const hold = rows.slice(28);
      for (const v of train)
        v.sparks = v.sparks.filter((s) => !(s.type === 'blue' && s.owner !== 'self'));
      const r = calibrateRules(
        goldenCtx(),
        rows,
        opts({
          split: { trainIds: train.map((v) => v.id), holdoutIds: hold.map((v) => v.id) },
          bootstrap: 0,
        }),
      );
      expect(r.population.used).toBe(34);
      expect(r.stats.status).toBe('nonidentifiable');
      expect(r.stats.nonidentifiable!.reasons.join(' ')).toMatch(/no train row/);
      expect(r.stats.nonidentifiable!.reasons.join(' ')).toMatch(/holdout/);
      expect(r.stats.selected).toBeNull();
      expect(r.suggestions).toEqual([]);
    },
    T,
  );

  it('blueIdentifiability: zero, holdout-only, constant (intercept-confounded) and varying train signals', () => {
    const z = [0, 0, 0, 0, 0];
    const c = [1, 2, 0, 0, 3];
    expect(blueIdentifiability([z, z], [z]).identifiable).toBe(false);
    const ho = blueIdentifiability([z, z], [c]);
    expect(ho.identifiable).toBe(false);
    expect(ho.reasons.join(' ')).toMatch(/no train row/);
    const k = blueIdentifiability([c, c, c], [z]);
    expect(k.identifiable).toBe(false);
    expect(k.reasons.join(' ')).toMatch(/intercept/);
    expect(blueIdentifiability([c, [1, 2, 0, 0, 4], c], [z]).identifiable).toBe(true);
  });

  it(
    'golden: varying train contributions stay identifiable',
    () => {
      expect(x13().stats.status).toBe('suggested');
    },
    T,
  );
});
