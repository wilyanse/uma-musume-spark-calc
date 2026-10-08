/**
 * T15 review round 2 (docs/reviews/T15-review-2.md): S-A (design-collinear blue sensitivity),
 * S-B (invalid observed aptitude grades) and S-C (explicit full-calibration test timeout). No
 * golden input, threshold or F12 band changes.
 */
import { describe, expect, it } from 'vitest';
import { APT_KEYS } from '@uma/schema';
import type { RosterVeteran } from '@uma/schema';
import { calibrateRules } from '../../src/index.ts';
import {
  blueIdentifiability,
  COLLINEAR_REL_TOL,
  SENSITIVITY_REL_TOL,
} from '../../src/calibrate/index.ts';
import {
  cached,
  calibrationRoster,
  FULL_CALIBRATION_TIMEOUT_MS,
  goldenCtx,
  opts,
} from './helpers.ts';

const T = FULL_CALIBRATION_TIMEOUT_MS;
const x13 = () => cached('x1.3', () => goldenCtx(), calibrationRoster);
const jsonRoundTrip = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
const guestAll = calibrationRoster.filter((v) => v.parents.every((p) => p.isGuest));

/**
 * The reviewer's Q13 roster: every scenario's guest parents carry 3★ blue in ONE stat, so the
 * blue sensitivity d is 240 × the scenario indicator (exactly in the span of the scenario×mode
 * cell one-hot). k·240 is planted into that stat.
 */
function q13Roster(k: number): RosterVeteran[] {
  const SK = ['spd', 'sta', 'pow', 'gut', 'wit'] as const;
  const ids = ['spark:speed', 'spark:stamina', 'spark:power', 'spark:guts', 'spark:wit'];
  const sidOf = (s: string) =>
    s === 'scenario:ura-finale' ? 0 : s === 'scenario:unity-cup' ? 1 : s === 'scenario:trackblazer' ? 2 : 4;
  return guestAll.map((v) => {
    const c = structuredClone(v);
    c.sparks = c.sparks.filter((s) => !(s.type === 'blue' && s.owner !== 'self'));
    const j = sidOf(c.scenarioId);
    for (const owner of ['parent1', 'parent2'] as const) {
      c.sparks.push({ owner, sparkId: ids[j]!, stars: 3, type: 'blue' } as RosterVeteran['sparks'][number]);
    }
    c.stats[SK[j]!] = Math.round(c.stats[SK[j]!] + k * 240);
    return c;
  });
}

describe('S-A: blue sensitivity collinear with the train design is not identified', () => {
  it('numeric guards are documented and are not game facts', () => {
    expect(COLLINEAR_REL_TOL).toBeGreaterThan(0);
    expect(COLLINEAR_REL_TOL).toBeLessThan(1e-6);
    expect(SENSITIVITY_REL_TOL).toBeGreaterThan(0);
    expect(SENSITIVITY_REL_TOL).toBeLessThan(1e-6);
  });

  it.each([1.3, 3])(
    'Q13: d = 240 × scenario indicator (planted k = %s) is design-confounded: nonidentifiable, no suggestion',
    (k) => {
      const r = calibrateRules(goldenCtx(), q13Roster(k), opts({ split: undefined, bootstrap: 0 }));
      expect(r.population.used).toBe(34);
      expect(r.stats.status).toBe('nonidentifiable');
      const why = r.stats.nonidentifiable!.reasons.join(' ');
      expect(why).toMatch(/design-confounded/);
      expect(why).toMatch(/ridge/);
      expect(r.stats.selected).toBeNull();
      expect(r.stats.trainCvSelected).toBeNull();
      expect(r.suggestions).toEqual([]);
      expect(r.notCalibrated.some((n) => n.rule === 'blueStatGain')).toBe(true);
      const id = r.stats.identification!;
      expect(id.status).toBe('design-confounded');
      // 27 train rows ≤ the full design rank: the column-space test falls back to the
      // structural (non-card-id) columns, which still have rank < n and contain d exactly.
      expect(id.saturated).toBe(true);
      expect(id.basis).toBe('structural-design');
      expect(id.basisRank).toBeLessThan(id.trainRows);
      const sens = id.perStat.filter((s) => s.sensitive);
      expect(sens.length).toBeGreaterThan(0);
      for (const s of sens) {
        expect(s.confounded).toBe(true);
        expect(s.relativeResidual!).toBeLessThanOrEqual(COLLINEAR_REL_TOL);
      }
      expect(r.status).not.toBe('complete');
      expect(jsonRoundTrip(r)).toEqual(r);
    },
    T,
  );

  it(
    'genuine within-cell signal on the same small guest roster stays identified (no over-rejection)',
    () => {
      const r = calibrateRules(goldenCtx(), guestAll, opts({ split: undefined, bootstrap: 0 }));
      const id = r.stats.identification!;
      expect(id.status).toBe('identified');
      expect(id.saturated).toBe(true);
      expect(id.basis).toBe('structural-design');
      expect(Math.max(...id.perStat.map((s) => s.relativeResidual ?? 0))).toBeGreaterThan(0.1);
      expect(r.stats.status).toBe('suggested');
      // The saturation is disclosed: beyond the structural columns the fit rests on the ridge.
      expect(r.warnings.join(' ')).toMatch(/saturated/);
    },
    T,
  );

  it(
    'golden ×1.3: identified on the full train design, still 1.33 / train-CV 1.31',
    () => {
      const r = x13();
      const id = r.stats.identification!;
      expect(id.status).toBe('identified');
      expect(id.basis).toBe('full-design');
      expect(id.saturated).toBe(false);
      expect(id.trainRows).toBe(157);
      expect(id.basisRank).toBeLessThan(id.trainRows);
      expect(id.designColumns).toBeGreaterThan(id.basisRank - 1);
      for (const s of id.perStat) {
        expect(s.sensitive).toBe(true);
        expect(s.confounded).toBe(false);
        expect(s.relativeResidual!).toBeGreaterThan(0.1);
      }
      expect(id.folds).toHaveLength(5);
      expect(id.folds.every((f) => f.status === 'identified')).toBe(true);
      expect(r.stats.status).toBe('suggested');
      expect(r.stats.selected!.multiplier).toBe(1.33);
      expect(r.stats.trainCvSelected!.multiplier).toBe(1.31);
      expect(r.suggestions[0]!.identification).toBe('identified');
      expect(r.warnings.join(' ')).not.toMatch(/saturated|design-confounded/);
    },
    T,
  );

  it('Q7.unitTiny: a 1e-8 relative variation is not within-train signal', () => {
    const tiny = blueIdentifiability([[1, 0, 0, 0, 0], [1 + 1e-8, 0, 0, 0, 0]], []);
    expect(tiny.identifiable).toBe(false);
    expect(tiny.reasons.join(' ')).toMatch(/intercept/);
    // A sensitivity at floating-point noise level relative to the stat scale is no sensitivity.
    const noise = blueIdentifiability([[1e-12, 0, 0, 0, 0], [3e-12, 0, 0, 0, 0]], []);
    expect(noise.identifiable).toBe(false);
    expect(noise.reasons.join(' ')).toMatch(/no train row/);
    // A real relative variation is signal.
    expect(blueIdentifiability([[1, 0, 0, 0, 0], [1.5, 0, 0, 0, 0], [1, 0, 0, 0, 0]], []).identifiable).toBe(true);
  });

  // Design: intercept + 2-group one-hot + one free covariate, 8 rows (rank 4 < 8).
  const g = [0, 0, 0, 0, 1, 1, 1, 1];
  const cov = [0.3, 1.1, -0.4, 2.0, 0.7, -1.2, 0.5, 0.9];
  const X = g.map((gi, i) => [1, gi === 0 ? 1 : 0, gi === 1 ? 1 : 0, cov[i]!]);
  const structural = [true, true, true, false];

  it('a group-indicator sensitivity is design-confounded; a within-group one is identified', () => {
    const dGroup = g.map((gi) => [gi ? 240 : 0, 0, 0, 0, 0]);
    const a = blueIdentifiability(dGroup, [], { design: X, structural });
    expect(a.identifiable).toBe(false);
    expect(a.identification.status).toBe('design-confounded');
    expect(a.identification.basis).toBe('full-design');
    expect(a.reasons.join(' ')).toMatch(/design-confounded.*ridge/);
    // A linear combination of the covariate and the groups is also in the column space.
    const dComb = g.map((gi, i) => [3 * cov[i]! + (gi ? 5 : 1), 0, 0, 0, 0]);
    expect(blueIdentifiability(dComb, [], { design: X, structural }).identifiable).toBe(false);
    // Within-group variation not explained by any column.
    const dWithin = g.map((_, i) => [[1, 4, 2, 7, 3, 9, 1, 2][i]!, 0, 0, 0, 0]);
    const b = blueIdentifiability(dWithin, [], { design: X, structural });
    expect(b.identifiable).toBe(true);
    expect(b.identification.perStat[0]!.relativeResidual!).toBeGreaterThan(0.1);
  });

  it('mixed stats: one confounded and one independent stat is identified (the shared m has signal), confounded stats listed', () => {
    const d = g.map((gi, i) => [gi ? 240 : 0, [1, 4, 2, 7, 3, 9, 1, 2][i]!, 0, 0, 0]);
    const r = blueIdentifiability(d, [], { design: X, structural });
    expect(r.identifiable).toBe(true);
    expect(r.identification.status).toBe('identified');
    expect(r.identification.perStat.map((s) => s.confounded)).toEqual([true, false, null, null, null]);
    expect(r.identification.confoundedStats).toEqual(['spd']);
  });

  it('a column-space test that is vacuous (rank ≥ rows on every basis) falls back to the intercept only, and says so', () => {
    const Xsat = [
      [1, 1, 0],
      [1, 0, 1],
    ];
    const r = blueIdentifiability([[1, 0, 0, 0, 0], [2, 0, 0, 0, 0]], [], {
      design: Xsat,
      structural: [true, true, true],
    });
    expect(r.identification.saturated).toBe(true);
    expect(r.identification.basis).toBe('intercept-only');
    expect(r.identifiable).toBe(true);
  });

  it('scale-aware: the result does not depend on the units of d or of the design', () => {
    const dWithin = g.map((_, i) => [[1, 4, 2, 7, 3, 9, 1, 2][i]!, 0, 0, 0, 0]);
    for (const s of [1e-6, 1, 1e6]) {
      const d = dWithin.map((r) => r.map((x) => x * s));
      const Xs = X.map((r) => r.map((x, j) => (j === 3 ? x * s : x)));
      const res = blueIdentifiability(d, [], { design: Xs, structural, scale: [1e3 * s, 1, 1, 1, 1] });
      expect(res.identifiable).toBe(true);
    }
  });
});

describe('S-B: invalid observed aptitude grades are excluded and counted, never below-base', () => {
  const row = guestAll.find((v) => v.minConfidence >= 0.9)!;
  const run = (mut: (v: RosterVeteran) => void) => {
    const v = structuredClone(row);
    mut(v);
    const r = calibrateRules(goldenCtx(), [v], opts({ split: undefined, bootstrap: 0 }));
    return { r, v };
  };

  it('"Z" on turf: excluded with a reason and a count, not an impossible cell', () => {
    const base = run(() => {}).r.aptitude;
    const { r, v } = run((x) => {
      (x.aptitudes as Record<string, unknown>).turf = 'Z';
    });
    const a = r.aptitude;
    expect(v.aptitudes.turf).toBe('Z'); // input untouched, no fabricated valid grade
    expect(a.invalidObserved).toBe(1);
    expect(a.cells).toBe(base.cells - 1);
    expect(a.impossible).toBe(base.impossible);
    expect(a.belowBase).toBe(base.belowBase);
    expect(a.perAptitude.turf!.invalidObserved).toBe(1);
    expect(a.perAptitude.turf!.cells).toBe(base.perAptitude.turf!.cells - 1);
    expect(a.perAptitude.turf!.impossible).toBe(0);
    expect(a.perAptitude.dirt!.invalidObserved).toBe(0);
    expect(a.examples.some((e) => (e.observed as string) === 'Z')).toBe(false);
    expect(a.invalidExamples).toEqual([
      { id: row.id, apt: 'turf', observed: 'Z', valueType: 'string', reason: 'invalid-grade' },
    ]);
    expect(r.warnings.join(' ')).toMatch(/1 observed aptitude grade.*not a valid grade.*excluded/);
    expect(jsonRoundTrip(r)).toEqual(r);
  });

  it('non-string, missing, null and lowercase values are invalid, per aptitude, JSON-safe', () => {
    const { r } = run((x) => {
      const a = x.aptitudes as Record<string, unknown>;
      a.turf = 3;
      delete a.dirt;
      a.sprint = null;
      a.mile = 'a';
      a.medium = Number.NaN;
    });
    const a = r.aptitude;
    expect(a.invalidObserved).toBe(5);
    for (const k of ['turf', 'dirt', 'sprint', 'mile', 'medium'] as const) {
      expect(a.perAptitude[k]!.invalidObserved).toBe(1);
      expect(a.perAptitude[k]!.cells).toBe(0);
      expect(a.perAptitude[k]!.status).toBe('insufficient-data');
      expect(a.perAptitude[k]!.fullLikelihood).toBe('no-cells');
    }
    expect(a.cells).toBe(5);
    expect(a.invalidExamples.map((e) => [e.apt, e.observed, e.valueType])).toEqual([
      ['turf', null, 'number'],
      ['dirt', null, 'undefined'],
      ['sprint', null, 'null'],
      ['mile', 'a', 'string'],
      ['medium', null, 'number'],
    ]);
    expect(jsonRoundTrip(a)).toEqual(a);
  });

  it('every grade invalid (or no aptitudes object): no-cells, insufficient-data, never a score', () => {
    const { r } = run((x) => {
      (x as { aptitudes: unknown }).aptitudes = undefined;
    });
    const a = r.aptitude;
    expect(a.invalidObserved).toBe(APT_KEYS.length);
    expect(a.cells).toBe(0);
    expect(a.fullLikelihood).toBe('no-cells');
    expect(a.logLik).toBeNull();
    expect(a.conditionalLogLik).toBeNull();
    expect(a.status).toBe('insufficient-data');
    expect(jsonRoundTrip(r)).toEqual(r);
  });
});

describe('S-C: expensive full-calibration tests carry an explicit bounded timeout', () => {
  it('the shared timeout is bounded and above the Vitest default', () => {
    expect(FULL_CALIBRATION_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(FULL_CALIBRATION_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
