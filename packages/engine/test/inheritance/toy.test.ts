import { describe, expect, it } from 'vitest';
import {
  affinity2,
  affinity3,
  checkLegality,
  expectationFromPlan,
  IllegalPairError,
  loadContext,
  planInheritance,
} from '../../src/index.ts';
import {
  c,
  expectContributionsSumToExpected,
  expectVectorClose,
  legacy,
  lineage1,
  lineage3,
  lineage9,
  SCENARIO,
  skill,
  toyMaster,
  toyRules,
  TRAINEE,
  ZERO_EVENT_SCENARIO,
} from './fixtures.ts';

const ctx = loadContext(toyMaster(), toyRules());

describe('T05 synthetic inheritance mechanics (hand-computed)', () => {
  it('computes affinity from shared groups, pairwise entries, and triples', () => {
    expect(affinity2(ctx, c('a'), c('c'))).toBe(3); // g1 (2) + pair (1)
    expect(affinity3(ctx, c('a'), c('b'), c('c'))).toBe(2); // only g1
  });

  it('1-spark lineage: affinity 19, p 0.812, initial bonus 30', () => {
    // aff(a,b)=9, aff(a,c)=3, aff(b,c)=7 -> total 19; P1 = 9 + 7 = 16 -> 0.7 × 1.16 = 0.812.
    const p = planInheritance(ctx, TRAINEE, lineage1(), SCENARIO);
    expect(p.affinity.total).toBe(19);
    expect(p.activations[0]?.p).toBeCloseTo(0.812, 12);
    const out = expectationFromPlan(p);
    // 30 + 2 events × 0.812 × 12 = 49.488
    expectVectorClose(out.expectedStatGain, [49.488, 0, 0, 0, 0]);
    expect(out.initialStatBonus).toEqual([30, 0, 0, 0, 0]);
    expectVectorClose(out.contributions[0]!.expectedEffect.stats, [49.488, 0, 0, 0, 0]);
    expectContributionsSumToExpected(out);
  });

  it('3-spark lineage: exact aptitude and hint probabilities', () => {
    const r = expectationFromPlan(planInheritance(ctx, TRAINEE, lineage3(), SCENARIO));
    expect(r.aptitudeDist.turf.C).toBeCloseTo(0.425104, 12);
    expect(r.aptitudeDist.turf.B).toBeCloseTo(0.453792, 12);
    expect(r.aptitudeDist.turf.A).toBeCloseTo(0.121104, 12);
    expect(r.skillHintProb[skill('x')]).toBeCloseTo(0.379056, 12);
    expect(r.skillHintProb[skill('y')]).toBeCloseTo(0.43689984, 12);
    expect(Object.values(r.aptitudeDist.turf).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expectVectorClose(r.expectedStatGain, [0, 0, 0, 0, 0]);
    expectContributionsSumToExpected(r);
  });

  it('9-spark lineage: stats, covariance and race/scenario effects', () => {
    const r = expectationFromPlan(planInheritance(ctx, TRAINEE, lineage9(), SCENARIO));
    expectVectorClose(r.expectedStatGain, [48.1152, 0, 14.832, 30.7072, 0]);
    expect(r.initialStatBonus).toEqual([20, 0, 0, 10, 0]);
    expect(r.statGainCov[0]?.[3]).toBeCloseTo(95.33841408, 9);
    expect(r.skillHintProb[skill('x')]).toBeCloseTo(0.8158903536, 10);
    expectContributionsSumToExpected(r);
  });

  it('B1: Σ contributions.stats == expectedStatGain for 1/3/9 sparks and zero events', () => {
    for (const lineage of [lineage1, lineage3, lineage9]) {
      for (const scenario of [SCENARIO, ZERO_EVENT_SCENARIO]) {
        const r = expectationFromPlan(planInheritance(ctx, TRAINEE, lineage(), scenario));
        expectContributionsSumToExpected(r);
        // Grandparents never carry an initial bonus (50 §3: parents' blue sparks only).
        for (const x of r.contributions.filter((x) => x.from.startsWith('GP'))) {
          expect(x.initialBonus).toEqual([0, 0, 0, 0, 0]);
        }
      }
    }
    // Zero events: the whole expectation is the parents' initial bonus, attributed per spark.
    const z = expectationFromPlan(planInheritance(ctx, TRAINEE, lineage9(), ZERO_EVENT_SCENARIO));
    expect(z.expectedStatGain).toEqual([20, 0, 0, 10, 0]);
    const blueP = z.contributions.filter((x) => x.type === 'blue');
    expect(blueP.map((x) => [x.from, x.expectedEffect.stats])).toEqual([
      ['P1', [20, 0, 0, 0, 0]],
      ['P2', [0, 0, 0, 10, 0]],
    ]);
  });

  it('a grandparent blue spark rolls but gets no initial bonus', () => {
    const gp = { characterId: c('d'), sparks: [{ sparkId: 'spark:spd', type: 'blue' as const, stars: 3 as const }] };
    const r = expectationFromPlan(planInheritance(ctx, TRAINEE, [legacy('b', [], [gp, null]), legacy('c')], SCENARIO));
    // aff(a,b,d) = g2 = 3; p = 0.7 × 0.8 × 1.03 = 0.5768; 2 × 0.5768 × 12 = 13.8432
    expect(r.initialStatBonus).toEqual([0, 0, 0, 0, 0]);
    expectVectorClose(r.expectedStatGain, [13.8432, 0, 0, 0, 0]);
    expectContributionsSumToExpected(r);
  });

  it('rejects illegal pairs before scoring', () => {
    expect(checkLegality(c('a'), { characterId: c('a') }, { characterId: c('b') }).legal).toBe(false);
    expect(() => planInheritance(ctx, TRAINEE, [legacy('b'), legacy('b')], SCENARIO)).toThrow(IllegalPairError);
  });
});
