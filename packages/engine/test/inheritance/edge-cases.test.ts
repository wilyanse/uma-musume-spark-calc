/**
 * S4, S5, N1: zero events and provenance, unknown/mismatched sparks, missing optional rule rows,
 * scenario plugins, malformed rules and formulas, the S cap, and duplicate hints.
 */
import { describe, expect, it } from 'vitest';
import { GRADES } from '@uma/schema';
import type { Rules } from '@uma/schema';
import {
  compileAffinityFormula,
  defaultScenario,
  expectationFromPlan,
  FormulaError,
  loadContext,
  mulberry32,
  planInheritance,
  RulesError,
  sampleInheritance,
} from '../../src/index.ts';
import type { ScenarioPlugin } from '../../src/index.ts';
import {
  blue,
  c,
  expectContributionsSumToExpected,
  expectVectorClose,
  legacy,
  lineage9,
  pink,
  SCENARIO,
  skill,
  sp,
  toyMaster,
  toyRules,
  TRAINEE,
  TRAINEE_A,
  white,
  ZERO_EVENT_SCENARIO,
} from './fixtures.ts';

const R = toyRules();
const ctx = loadContext(toyMaster(), R);
const mutate = (change: (r: Rules) => void): Rules => {
  const r = structuredClone(R);
  change(r);
  return r;
};

describe('zero events and provenance (S4)', () => {
  it('a scenario without inheritance turns rolls nothing and is not validated', () => {
    const plan = planInheritance(ctx, TRAINEE, lineage9(), ZERO_EVENT_SCENARIO);
    const r = expectationFromPlan(plan);
    expect(r.events).toEqual([]);
    expect(r.expectedStatGain).toEqual(r.initialStatBonus);
    expect(r.statGainCov.flat().every((x) => x === 0)).toBe(true);
    expect(Object.values(r.skillHintProb).every((p) => p === 0)).toBe(true);
    expect(r.aptitudeDist.turf.C).toBe(1);
    expect(r.contributions.every((x) => x.pAny === 0)).toBe(true);
    expect(r.provenance).toMatchObject({ eventsKnown: false, validated: false, unverifiedRules: [], placeholderRules: [] });
    expect(r.provenance.warnings).toContain(
      `${ZERO_EVENT_SCENARIO} has no inheritanceTurns in master data: event rolls contribute nothing; only the career-start blue bonus applies`,
    );
    // Sampling agrees: every draw is exactly the initial bonus.
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(sampleInheritance(plan, rng).statGain).toEqual(r.initialStatBonus);
  });

  it('validated only with events, all rules verified and no placeholders', () => {
    expect(expectationFromPlan(planInheritance(ctx, TRAINEE, lineage9(), SCENARIO)).provenance.validated).toBe(true);
    const unverified = mutate((r) => (r.blueStatGain.verified = false));
    const p1 = planInheritance(loadContext(toyMaster(unverified), unverified), TRAINEE, lineage9(), SCENARIO).provenance;
    expect(p1).toMatchObject({ validated: false, unverifiedRules: ['blueStatGain'], placeholderRules: [] });
    const placeholder = mutate((r) => (r.whiteHintLevels.source = 'UNKNOWN: placeholder'));
    const p2 = planInheritance(loadContext(toyMaster(placeholder), placeholder), TRAINEE, lineage9(), SCENARIO).provenance;
    expect(p2).toMatchObject({ validated: false, unverifiedRules: [], placeholderRules: ['whiteHintLevels'] });
  });
});

describe('unknown and mismatched sparks (S4)', () => {
  it('skips unknown spark ids with a warning, and never guesses an effect', () => {
    const plan = planInheritance(ctx, TRAINEE, [
      legacy('b', [blue('spd', 3), { sparkId: sp('does-not-exist'), type: 'blue', stars: 3 }]),
      legacy('c', [], [null, { characterId: null, sparks: [{ sparkId: sp('also-missing'), type: 'white', stars: 1 }] }]),
    ], SCENARIO);
    expect(plan.skipped).toEqual([
      { sparkId: sp('does-not-exist'), from: 'P1', reason: 'not in master sparks' },
      { sparkId: sp('also-missing'), from: 'GP2b', reason: 'not in master sparks' },
    ]);
    expect(plan.activations.map((a) => a.sparkId)).toEqual([sp('spd')]);
    expect(plan.provenance.warnings).toContain(`skipped ${sp('does-not-exist')} (P1): not in master sparks`);
    const r = expectationFromPlan(plan);
    expect(r.initialStatBonus).toEqual([30, 0, 0, 0, 0]); // the unknown 3★ blue adds no bonus
    expectContributionsSumToExpected(r);
  });

  it('uses the master spark type when the recorded type disagrees, with a warning', () => {
    const plan = planInheritance(ctx, TRAINEE, [legacy('b', [{ sparkId: sp('spd'), type: 'pink', stars: 3 }]), legacy('c')], SCENARIO);
    expect(plan.activations[0]).toMatchObject({ type: 'blue', kind: 'blue' });
    expect(plan.initialStatBonus).toEqual([30, 0, 0, 0, 0]);
    expect(plan.provenance.warnings).toContain(`${sp('spd')} (P1) recorded as pink, master says blue; using master`);
  });
});

describe('missing optional rule rows (S4)', () => {
  it('race / scenario sparks without a rules row warn and have no effect', () => {
    const plan = planInheritance(ctx, TRAINEE, [legacy('b', [white('race-missing', 3)]), legacy('c', [white('scenario-other', 3)])], SCENARIO);
    expect(plan.activations.every((a) => a.effect.stats.every((x) => x === 0) && a.effect.hints.length === 0)).toBe(true);
    expect(plan.activations.every((a) => a.p > 0)).toBe(true); // they still roll
    expect(plan.provenance.warnings).toEqual(
      expect.arrayContaining([
        `${sp('race-missing')}: race race-not-in-rules not in rules.raceSparkStatGain.races; no effect`,
        `${sp('scenario-other')}: scenario:not-in-rules not in rules.scenarioSparkEffects.scenarios; no effect`,
      ]),
    );
    expect(expectationFromPlan(plan).expectedStatGain).toEqual([0, 0, 0, 0, 0]);
  });

  it('missing race perStar/activation and scenario activation tables fall back with warnings', () => {
    const rules = mutate((r) => {
      r.raceSparkStatGain = { verified: true, source: 'synthetic fixture', races: { 'race-1': { stats: ['pow'], hintSkillIds: [9001, 424242] } } };
      r.scenarioSparkEffects = { verified: true, source: 'synthetic fixture' };
    });
    const ctx2 = loadContext(toyMaster(rules), rules);
    expect(ctx2.warnings).toEqual([
      'rules.raceSparkStatGain.races.race-1: hint skill gameId 424242 not in master skills',
      'rules.raceSparkStatGain.perStar missing: race sparks add no stats',
      'rules.raceSparkStatGain.activation missing: race sparks use activation.white',
      'rules.scenarioSparkEffects.activation missing: scenario sparks use activation.white',
    ]);
    const plan = planInheritance(ctx2, TRAINEE, [legacy('b', [white('race-1', 3)]), legacy('c', [white('scenario', 3)])], SCENARIO);
    // Race falls back to activation.white[3] = 0.4 (× affinity multiplier), with no stats, but hints.
    const whiteP = planInheritance(ctx2, TRAINEE, [legacy('b', [white('white-x', 3)]), legacy('c')], SCENARIO).activations[0]!.p;
    expect(plan.activations[0]!.p).toBeCloseTo(whiteP, 12);
    expect(plan.activations[0]!.effect).toEqual({ stats: [0, 0, 0, 0, 0], aptitudeGrades: {}, hints: [{ skillId: skill('race'), level: 3 }] });
    expect(plan.activations[1]!.effect.stats).toEqual([0, 0, 0, 0, 0]);
  });

  it('a non-finite number in an open table makes it unreadable: warning and no effect, never NaN', () => {
    const rules = mutate((r) => (r.raceSparkStatGain.perStar = [1, Number.NaN, 3]));
    const ctx2 = loadContext(toyMaster(rules), rules);
    expect(ctx2.warnings.some((w) => w.startsWith('rules.raceSparkStatGain unreadable'))).toBe(true);
    const r = expectationFromPlan(planInheritance(ctx2, TRAINEE, [legacy('b', [white('race-1', 2)]), legacy('c')], SCENARIO));
    expect(r.expectedStatGain).toEqual([0, 0, 0, 0, 0]);
  });

  it('an unreadable open table warns instead of throwing', () => {
    const rules = mutate((r) => {
      r.raceSparkStatGain = { verified: true, source: 's', perStar: 'lots' };
    });
    const ctx2 = loadContext(toyMaster(rules), rules);
    expect(ctx2.warnings.some((w) => w.startsWith('rules.raceSparkStatGain unreadable, race sparks have no effect'))).toBe(true);
    expect(ctx2.tables.raceStatGain).toEqual([0, 0, 0]);
  });
});

describe('scenario plugins (S4, N5)', () => {
  it('DefaultScenario reads statCap and inheritanceTurns from master data; deckFeatures is {}', () => {
    const plugin = ctx.scenarios.get(SCENARIO)!;
    expect(plugin.statCap(ctx)).toBe(2000);
    expect(plugin.inheritanceTurns(ctx)).toEqual([1, 2]);
    expect(plugin.deckFeatures([], ctx)).toEqual({});
    expect(ctx.scenarios.get(ZERO_EVENT_SCENARIO)!.statCap(ctx)).toBe(1200);
    expect(plugin.sparkEffects).toBeUndefined();
  });

  it('a registered plugin overrides turns, deck features and white-spark effects', () => {
    const plugins = {
      [SCENARIO]: (row: Parameters<typeof defaultScenario>[0]): ScenarioPlugin => ({
        ...defaultScenario(row),
        statCap: () => 1800,
        inheritanceTurns: () => [5, 10, 15],
        deckFeatures: (deck) => ({ deckSize: deck.length }),
        sparkEffects: ({ spark, stars }) =>
          spark.id === sp('white-x')
            ? { stats: [0, stars, 0, 0, 0], hints: [{ skillId: skill('y'), level: 9 }, { skillId: skill('y'), level: 4 }] }
            : undefined,
      }),
    };
    const pctx = loadContext(toyMaster(), R, { plugins });
    const plugin = pctx.scenarios.get(SCENARIO)!;
    expect(plugin.statCap(pctx)).toBe(1800);
    expect(plugin.deckFeatures([], pctx)).toEqual({ deckSize: 0 });
    const plan = planInheritance(pctx, TRAINEE, [legacy('b', [white('white-x', 2), white('race-1', 1)]), legacy('c')], SCENARIO);
    expect(plan.events).toEqual([5, 10, 15]);
    // Replaced effect for white-x (duplicate hint merged, highest level); race-1 keeps the default.
    expect(plan.activations[0]!.effect).toEqual({ stats: [0, 2, 0, 0, 0], aptitudeGrades: {}, hints: [{ skillId: skill('y'), level: 9 }] });
    expect(plan.activations[1]!.effect.stats).toEqual([0, 0, 5, 0, 0]);
    const r = expectationFromPlan(plan);
    const pw = plan.activations[0]!.p;
    const pr = plan.activations[1]!.p;
    expectVectorClose(r.expectedStatGain, [0, 3 * pw * 2, 3 * pr * 5, 0, 0]);
    expect(r.skillHintProb[skill('x')]).toBeUndefined();
    expect(r.skillHintProb[skill('y')]).toBeCloseTo(1 - (1 - pw) ** 3, 12);
    expectContributionsSumToExpected(r);
    // The other scenario still uses DefaultScenario.
    expect(pctx.scenarios.get(ZERO_EVENT_SCENARIO)!.inheritanceTurns(pctx)).toEqual([]);
  });

  it('rejects a plugin effect with non-finite stats', () => {
    const plugins = {
      [SCENARIO]: (row: Parameters<typeof defaultScenario>[0]): ScenarioPlugin => ({
        ...defaultScenario(row),
        sparkEffects: () => ({ stats: [Number.NaN, 0, 0, 0, 0] }),
      }),
    };
    const pctx = loadContext(toyMaster(), R, { plugins });
    expect(() => planInheritance(pctx, TRAINEE, [legacy('b', [white('white-x', 1)]), legacy('c')], SCENARIO)).toThrow(RangeError);
  });
});

describe('malformed rules (S4) and the affinity formula (S5)', () => {
  const load = (rules: Rules) => () => loadContext(toyMaster(rules), rules);

  it.each([
    ['fractional pinkGradeGain', mutate((r) => (r.pinkGradeGain['2'] = 0.5)), /pinkGradeGain must be non-negative integers/],
    ['negative pinkGradeGain', mutate((r) => (r.pinkGradeGain['1'] = -1)), /pinkGradeGain must be non-negative integers/],
    ['NaN grandparentWeight', mutate((r) => (r.grandparentWeight.value = Number.NaN)), /invalid rules|grandparentWeight must be finite/],
    ['Infinity blueStatGain', mutate((r) => (r.blueStatGain['3'] = Number.POSITIVE_INFINITY)), /invalid rules|blueStatGain must be finite/],
    ['schema-invalid rules (missing table)', mutate((r) => delete (r as Partial<Rules>).blueStatGain), /invalid rules/],
  ])('%s -> RulesError', (_name, rules, message) => {
    expect(load(rules)).toThrow(RulesError);
    expect(load(rules)).toThrow(message);
  });

  it.each(['affinity +', 'eval(1)', 'Math.max(1,2)', '2*(affinity', 'affinity)', '1 +* 2', 'affinity affinity', '1..2', '"1"', 'x'])(
    'malformed formula %j -> RulesError at load',
    (formula) => {
      expect(load(mutate((r) => (r.affinityMultiplier.formula = formula)))).toThrow(RulesError);
    },
  );

  it('an empty formula is rejected by the shared schema', () => {
    expect(load(mutate((r) => (r.affinityMultiplier.formula = '')))).toThrow(/invalid rules/);
  });

  it('the parser supports the documented grammar without eval', () => {
    const f = compileAffinityFormula('-(-1) + 2 * affinity / 4 - (affinity - 1) * 0.5e0');
    expect(f(10)).toBeCloseTo(1 + 5 - 4.5, 12);
    expect(() => compileAffinityFormula('1/affinity')(0)).toThrow(FormulaError);
  });

  it('a pole at affinity 0 fails at load', () => {
    expect(load(mutate((r) => (r.affinityMultiplier.formula = '1/affinity')))).toThrow(RulesError);
  });

  it('a pole at the pair\'s actual affinity is a RulesError from planInheritance, not a FormulaError', () => {
    // lineage 1: perSource P1 = 16, P2 = 10, total 19 (see toy.test.ts). A pole at 16 loads fine.
    const rules = mutate((r) => (r.affinityMultiplier.formula = '1/(16-affinity)'));
    const pctx = loadContext(toyMaster(rules), rules);
    const pair = () => planInheritance(pctx, TRAINEE, [legacy('b', [blue('spd', 3)]), legacy('c')], SCENARIO);
    expect(pair).toThrow(RulesError);
    expect(pair).toThrow('rules.affinityMultiplier.formula: formula "1/(16-affinity)" is not finite at affinity=16');
    let caught: unknown;
    try {
      pair();
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeInstanceOf(FormulaError);
    // Direct calls through the context are wrapped too.
    expect(() => pctx.affinityMultiplier(16)).toThrow(RulesError);
    expect(pctx.affinityMultiplier(15)).toBe(1);
  });

  it('a negative multiplier at the pair\'s actual affinity is rejected, not clamped to p = 0', () => {
    // Positive at 0 (loads), negative from affinity 11: P1 (16) is negative.
    const rules = mutate((r) => (r.affinityMultiplier.formula = '1 - affinity/10'));
    const pctx = loadContext(toyMaster(rules), rules);
    expect(pctx.affinityMultiplier(10)).toBe(0); // zero is allowed (p = 0), negative isn't
    expect(() => planInheritance(pctx, TRAINEE, [legacy('b', [blue('spd', 3)]), legacy('c')], SCENARIO)).toThrow(
      'rules.affinityMultiplier.formula "1 - affinity/10" is negative (-0.6000000000000001) at affinity=16',
    );
    // Negative at 0: rejected at load.
    expect(load(mutate((r) => (r.affinityMultiplier.formula = '0 - affinity - 1')))).toThrow(RulesError);
  });
});

describe('aptitude distribution: S cap and normalisation (S4)', () => {
  it('caps at S and every aptitude distribution sums to 1', () => {
    // Trainee turf A (index 6). 9-spark lineage: P1 pink 1★ (+1), P2 pink 3★ (+2), two events.
    const r = expectationFromPlan(planInheritance(ctx, TRAINEE_A, lineage9(), SCENARIO));
    const gain = r.aptitudeGainDist.turf;
    expect(gain.length).toBe(7); // up to 2 × (1 + 2) = 6 steps
    expect(gain.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
    expect(r.aptitudeDist.turf.A).toBeCloseTo(gain[0]!, 12);
    expect(r.aptitudeDist.turf.S).toBeCloseTo(1 - gain[0]!, 12); // every step past A lands on S
    for (const g of GRADES.slice(0, 6)) expect(r.aptitudeDist.turf[g]).toBe(0);
    for (const apt of Object.values(r.aptitudeDist)) expect(Object.values(apt).reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
    // Sampling also caps.
    const plan = planInheritance(ctx, TRAINEE_A, lineage9(), SCENARIO);
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const s = sampleInheritance(plan, rng);
      expect(s.aptitudes.turf).toBe(s.pinkGain.turf === 0 ? 'A' : 'S');
    }
  });

  it('the C-trainee 9-spark turf gain reaches 6 steps; steps 3..6 all land on S', () => {
    const r = expectationFromPlan(planInheritance(ctx, TRAINEE, lineage9(), SCENARIO));
    const gain = r.aptitudeGainDist.turf;
    // C (4) + 3 = S; steps 3..6 all land on S.
    expect(r.aptitudeDist.turf.S).toBeCloseTo(gain[3]! + gain[4]! + gain[5]! + gain[6]!, 12);
    expect(Object.values(r.aptitudeDist.turf).reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
  });
});

describe('duplicate hints within one activation (N1)', () => {
  it('a race row listing the same skill twice gives one hint chance per activation', () => {
    const plan = planInheritance(ctx, TRAINEE, [legacy('b', [white('race-dup', 2)]), legacy('c')], SCENARIO);
    const a = plan.activations[0]!;
    expect(a.effect.hints).toEqual([{ skillId: skill('race'), level: 2 }]);
    const r = expectationFromPlan(plan);
    expect(r.skillHintProb[skill('race')]).toBeCloseTo(1 - (1 - a.p) ** 2, 12);
    expect(r.contributions[0]!.expectedEffect.hints).toHaveLength(1);
    // Monte Carlo agrees on the per-activation count: at most one hint per event.
    const rng = mulberry32(11);
    let hit = 0;
    const N = 50_000;
    for (let i = 0; i < N; i++) {
      const s = sampleInheritance(plan, rng);
      const n = s.hints[skill('race')] ?? 0;
      expect(n).toBeLessThanOrEqual(2);
      if (n > 0) hit++;
    }
    const p = r.skillHintProb[skill('race')]!;
    expect(Math.abs(hit / N - p)).toBeLessThanOrEqual(5 * Math.sqrt((p * (1 - p)) / N));
  });

  it('distinct activations of the same skill still combine as 1 − Π(1 − p)', () => {
    const plan = planInheritance(ctx, TRAINEE, [legacy('b', [white('white-x', 1)]), legacy('c', [white('white-x', 3)])], SCENARIO);
    const [a, b] = plan.activations;
    expect(expectationFromPlan(plan).skillHintProb[skill('x')]).toBeCloseTo(1 - ((1 - a!.p) * (1 - b!.p)) ** 2, 12);
  });
});

describe('legacy with unknown grandparent character', () => {
  it('rolls the grandparent\'s sparks with affinity 0', () => {
    const plan = planInheritance(ctx, TRAINEE, [legacy('b', [], [{ characterId: null, sparks: [pink(3)] }, null]), legacy('c')], SCENARIO);
    expect(plan.affinity.perSource.GP1a).toBe(0);
    expect(plan.activations[0]!.p).toBeCloseTo(0.4 * 0.8, 12);
    expect(plan.affinity.breakdown.find((x) => x.label === 'T-P1-GP1a')?.members).toEqual([c('a'), c('b')]);
  });
});
