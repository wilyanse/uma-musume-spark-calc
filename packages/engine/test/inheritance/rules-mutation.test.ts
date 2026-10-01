/**
 * S3: every rule table / formula the engine reads is mutated one at a time, and the test asserts
 * which observable outputs change and which don't. Assertions are about observable behaviour
 * (which output moved, in which direction), not a re-implementation of the engine's formulas.
 */
import { describe, expect, it } from 'vitest';
import type { Rules } from '@uma/schema';
import { expectationFromPlan, loadContext, planInheritance } from '../../src/index.ts';
import type { InheritanceResult } from '../../src/index.ts';
import { richLineage, SCENARIO, skill, toyMaster, toyRules, TRAINEE } from './fixtures.ts';

type Observable = 'statsP' | 'initial' | 'apt' | 'hintX' | 'hintY' | 'hintRace' | 'hintLevels' | 'pParents' | 'pGrandparents';
const ALL: Observable[] = ['statsP', 'initial', 'apt', 'hintX', 'hintY', 'hintRace', 'hintLevels', 'pParents', 'pGrandparents'];

function observe(r: InheritanceResult): Record<Observable, string> {
  const round = (x: number) => Math.round(x * 1e9) / 1e9;
  const ps = (gp: boolean) => r.contributions.filter((c) => c.from.startsWith('GP') === gp).map((c) => round(c.p));
  return {
    // Event-driven stat gain only, so `initial` is observed separately.
    statsP: JSON.stringify(r.expectedStatGain.map((x, k) => round(x - (r.initialStatBonus[k] as number)))),
    initial: JSON.stringify(r.initialStatBonus),
    apt: JSON.stringify(r.aptitudeDist),
    hintX: JSON.stringify(round(r.skillHintProb[skill('x')] ?? -1)),
    hintY: JSON.stringify(round(r.skillHintProb[skill('y')] ?? -1)),
    hintRace: JSON.stringify(round(r.skillHintProb[skill('race')] ?? -1)),
    hintLevels: JSON.stringify(r.contributions.map((c) => c.expectedEffect.hints.map((h) => h.level))),
    pParents: JSON.stringify(ps(false)),
    pGrandparents: JSON.stringify(ps(true)),
  };
}

function run(rules: Rules): InheritanceResult {
  return expectationFromPlan(planInheritance(loadContext(toyMaster(rules), rules), TRAINEE, richLineage(), SCENARIO));
}

const R = toyRules();
type StarT = { '1': number; '2': number; '3': number };
/** The toy open tables' inner shape (what `loadContext` reads). */
interface RaceT { perStar: number[]; activation?: StarT; races: Record<string, { stats: string[]; hintSkillIds: number[] }> }
interface ScenT { activation?: StarT; scenarios: Record<string, { stats: string[]; perStar: number[] }> }

/** A deep copy of the toy rules with one change applied. */
function mutate(change: (r: Rules, race: RaceT, scen: ScenT) => void): Rules {
  const r = structuredClone(R);
  change(r, r.raceSparkStatGain as unknown as RaceT, r.scenarioSparkEffects as unknown as ScenT);
  return r;
}
const halve = (t: StarT) => {
  t['1'] /= 2;
  t['2'] /= 2;
  t['3'] /= 2;
};

/** [name, mutated rules, observables that must change]. Everything else must stay identical. */
const cases: [string, Rules, Observable[]][] = [
  ['activation.blue', mutate((r) => halve(r.activation.blue)), ['statsP', 'pParents', 'pGrandparents']],
  ['activation.pink', mutate((r) => halve(r.activation.pink)), ['apt', 'pParents', 'pGrandparents']],
  ['activation.green', mutate((r) => halve(r.activation.green)), ['hintY', 'pParents', 'pGrandparents']],
  // white skill sparks only: race/scenario sparks have their own activation tables in the toy rules.
  ['activation.white', mutate((r) => halve(r.activation.white)), ['hintX', 'pParents', 'pGrandparents']],
  ['raceSparkStatGain.activation', mutate((_r, race) => (race.activation = { '1': 0.1, '2': 0.1, '3': 0.1 })), ['statsP', 'hintRace', 'pParents', 'pGrandparents']],
  ['scenarioSparkEffects.activation', mutate((_r, _race, scen) => (scen.activation = { '1': 0.1, '2': 0.1, '3': 0.1 })), ['statsP', 'pGrandparents']],
  ['grandparentWeight', mutate((r) => (r.grandparentWeight.value = 0.3)), ['statsP', 'apt', 'hintX', 'hintY', 'hintRace', 'pGrandparents']],
  ['affinityMultiplier.formula', mutate((r) => (r.affinityMultiplier.formula = '1 + affinity/50')), ['statsP', 'apt', 'hintX', 'hintY', 'hintRace', 'pParents', 'pGrandparents']],
  ['blueStatGain', mutate((r) => Object.assign(r.blueStatGain, { '1': 1, '2': 1, '3': 1 })), ['statsP']],
  ['blueInitialBonus', mutate((r) => (r.blueInitialBonus['3'] = 99)), ['initial']],
  ['pinkGradeGain', mutate((r) => (r.pinkGradeGain['3'] = 1)), ['apt']],
  ['whiteHintLevels', mutate((r) => Object.assign(r.whiteHintLevels, { '1': 5, '2': 6, '3': 7 })), ['hintLevels']],
  ['raceSparkStatGain.perStar', mutate((_r, race) => (race.perStar = [1, 1, 1])), ['statsP']],
  ['raceSparkStatGain.races[].stats', mutate((_r, race) => (race.races['race-1']!.stats = ['spd'])), ['statsP']],
  ['raceSparkStatGain.races[].hintSkillIds', mutate((_r, race) => Object.values(race.races).forEach((row) => (row.hintSkillIds = []))), ['hintRace', 'hintLevels']],
  ['scenarioSparkEffects.scenarios[].perStar', mutate((_r, _race, scen) => (scen.scenarios[SCENARIO]!.perStar = [1, 1, 1])), ['statsP']],
  ['scenarioSparkEffects.scenarios[].stats', mutate((_r, _race, scen) => (scen.scenarios[SCENARIO]!.stats = ['wit'])), ['statsP']],
];

describe('every used rule changes the affected outputs, and only those (S3)', () => {
  const base = observe(run(R));

  it('covers every rule key the engine reads', () => {
    const covered = new Set(cases.map(([name]) => name.split(/[.[]/)[0]));
    const keys = Object.keys(R).filter((k) => k !== 'version');
    expect([...covered].sort()).toEqual(keys.sort());
  });

  it.each(cases)('%s', (_name, rules, changes) => {
    const after = observe(run(rules));
    for (const key of ALL) {
      if (changes.includes(key)) expect(after[key], `${key} should change`).not.toEqual(base[key]);
      else expect(after[key], `${key} should not change`).toEqual(base[key]);
    }
  });

  it('directions: lower activation/weight lowers the expectation; higher bonus raises it', () => {
    const b = run(R);
    const lowBlue = run(cases[0]![1]);
    for (let k = 0; k < 5; k++) expect(lowBlue.expectedStatGain[k]).toBeLessThanOrEqual(b.expectedStatGain[k] as number);
    expect(run(cases[6]![1]).skillHintProb[skill('y')]).toBeLessThan(b.skillHintProb[skill('y')] as number);
    expect(run(cases[9]![1]).expectedStatGain[0]).toBeGreaterThan(b.expectedStatGain[0] as number);
    // Fewer grade steps per 3★ pink: less mass at the top grades.
    expect(run(cases[10]![1]).aptitudeDist.turf.S).toBeLessThan(b.aptitudeDist.turf.S);
  });
});
