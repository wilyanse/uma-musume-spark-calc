import { describe, expect, it } from 'vitest';
import type { MasterBundle } from '@uma/master-data';
import type { Rules } from '@uma/schema';
import {
  affinity2,
  affinity3,
  checkLegality,
  IllegalPairError,
  loadContext,
  mulberry32,
  planInheritance,
  sampleInheritance,
  expectationFromPlan,
} from '../../src/index.ts';
import type { Legacy } from '../../src/index.ts';

const c = (slug: string) => `character:${slug}`;
const o = (slug: string) => `outfit:${slug}`;
const sp = (slug: string) => `spark:${slug}`;
const scenario = 'scenario:toy';
const skill = (slug: string) => `skill:${slug}`;
const stats = { spd: 1, sta: 1, pow: 1, gut: 1, wit: 1 } as const;
const aptitudes = {
  turf: 'C', dirt: 'C', sprint: 'C', mile: 'C', medium: 'C', long: 'C',
  front: 'C', pace: 'C', late: 'C', end: 'C',
} as const;

const rules: Rules = {
  version: 'toy-rules',
  activation: {
    blue: { '1': 0.5, '2': 0.6, '3': 0.7, verified: true, source: 'synthetic fixture' },
    pink: { '1': 0.2, '2': 0.3, '3': 0.4, verified: true, source: 'synthetic fixture' },
    green: { '1': 0.1, '2': 0.2, '3': 0.3, verified: true, source: 'synthetic fixture' },
    white: { '1': 0.2, '2': 0.3, '3': 0.4, verified: true, source: 'synthetic fixture' },
  },
  affinityMultiplier: { formula: '1 + affinity/100', verified: true, source: 'synthetic fixture' },
  grandparentWeight: { value: 0.8, verified: true, source: 'synthetic fixture' },
  blueStatGain: { '1': 4, '2': 8, '3': 12, verified: true, source: 'synthetic fixture' },
  blueInitialBonus: { '1': 10, '2': 20, '3': 30, verified: true, source: 'synthetic fixture' },
  pinkGradeGain: { '1': 1, '2': 1, '3': 2, verified: true, source: 'synthetic fixture' },
  whiteHintLevels: { '1': 1, '2': 2, '3': 3, verified: true, source: 'synthetic fixture' },
  raceSparkStatGain: {
    verified: true, source: 'synthetic fixture', perStar: [5, 10, 15],
    activation: { '1': 0.4, '2': 0.5, '3': 0.6 },
    races: { 'race-1': { stats: ['pow'], hintSkillIds: [9001] } },
  },
  scenarioSparkEffects: {
    verified: true, source: 'synthetic fixture',
    activation: { '1': 0.6, '2': 0.7, '3': 0.8 },
    scenarios: { [scenario]: { stats: ['spd', 'gut'], perStar: [7, 14, 21] } },
  },
};

function spark(id: string, type: 'blue' | 'pink' | 'green' | 'white', target: unknown) {
  return { id: sp(id), name: id, type, target } as never;
}
function toyMaster(): MasterBundle {
  const characters: { id: string; name: string; aliases: string[]; affinityGroups: string[]; iconHashes: string[] }[] = ['a', 't', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => ({
    id: c(x), name: x, aliases: [], affinityGroups: [], iconHashes: [],
  }));
  const group = (id: string, points: number, members: string[]): { id: string; points: number; members: string[] } => ({ id, points, members: members.map((x) => c(x)) });
  const groups = [
    group('g1', 2, ['a', 'b', 'c']), group('g2', 3, ['a', 'b', 'd']), group('g3', 5, ['b', 'c']),
    group('g4', 4, ['a', 'b', 'e']), group('g5', 1, ['c', 'f', 'g']),
  ];
  const get = (id: string) => characters.find((x) => x.id === c(id))!;
  for (const g of groups) for (const id of g.members) get(id.replace('character:', ''))?.affinityGroups.push(g.id);
  const allChars = characters;
  const outfits = [{ id: o('trainee'), characterId: c('a'), title: 'Trainee', aptitudes, growth: stats, uniqueSkillId: skill('x'), innateSkillIds: [] }];
  const sparks = [
    spark('spd', 'blue', { kind: 'stat', stat: 'spd' }), spark('gut', 'blue', { kind: 'stat', stat: 'gut' }),
    spark('pink-turf', 'pink', { kind: 'aptitude', apt: 'turf' }), spark('green-y', 'green', { kind: 'skill', skillId: skill('y') }),
    spark('white-x', 'white', { kind: 'skill', skillId: skill('x') }),
    spark('race-1', 'white', { kind: 'race', raceId: 'race-1' }), spark('scenario', 'white', { kind: 'scenario', scenarioId: scenario }),
  ];
  return {
    version: 'toy-master', characters: allChars as never, outfits: outfits as never, skills: [
      { id: skill('x'), name: 'X', aliases: [], rarity: 'normal', tags: [], gameId: 9000 },
      { id: skill('y'), name: 'Y', aliases: [], rarity: 'normal', tags: [], gameId: 9002 },
      { id: skill('race'), name: 'Race', aliases: [], rarity: 'normal', tags: [], gameId: 9001 },
    ],
    sparks: sparks as never, cards: [], affinity: { groups, pairs: [{ a: c('a'), b: c('c'), points: 1 }] },
    scenarios: [{ id: scenario, name: 'Toy', statCap: 2000, inheritanceTurns: [1, 2] }], ranks: [], vocab: [], rules,
  };
}

function legacy(characterId: string, sparks: Legacy['sparks'] = [], grandparents: Legacy['grandparents'] = [null, null]): Legacy {
  return { veteranId: null, characterId: c(characterId), sparks, grandparents };
}
const blue = (id: string, stars: 1 | 2 | 3) => ({ sparkId: sp(id), type: 'blue' as const, stars });
const pink = (stars: 1 | 2 | 3) => ({ sparkId: sp('pink-turf'), type: 'pink' as const, stars });
const white = (stars: 1 | 2 | 3) => ({ sparkId: sp('white-x'), type: 'white' as const, stars });

const ctx = loadContext(toyMaster(), rules);

describe('T05 synthetic inheritance mechanics', () => {
  it('computes affinity from shared groups, pairwise entries, and triples', () => {
    expect(affinity2(ctx, c('a'), c('c'))).toBe(3); // g1 + pair override
    expect(affinity3(ctx, c('a'), c('b'), c('c'))).toBe(2); // only g1
  });

  it('hand-computed 1-spark lineage includes the parent initial blue bonus', () => {
    const p = planInheritance(ctx, o('trainee'), [legacy('b', [blue('spd', 3)]), legacy('c')], scenario);
    expect(p.affinity.total).toBe(19);
    expect(p.activations[0]?.p).toBeCloseTo(0.812);
    const out = expectationFromPlan(p);
    expect(out.expectedStatGain[0]).toBeCloseTo(49.488);
    expect(out.initialStatBonus[0]).toBe(30);
  });

  it('hand-computed 3-spark lineage has exact aptitude and hint probabilities', () => {
    const p = planInheritance(ctx, o('trainee'), [
      legacy('b', [pink(2)], [{ characterId: c('e'), sparks: [{ sparkId: sp('green-y'), type: 'green', stars: 3 }] }, null]),
      legacy('d', [white(1)]),
    ], scenario);
    const r = expectationFromPlan(p);
    expect(r.aptitudeDist.turf.C).toBeCloseTo(0.425104);
    expect(r.aptitudeDist.turf.B).toBeCloseTo(0.453792);
    expect(r.aptitudeDist.turf.A).toBeCloseTo(0.121104);
    expect(r.skillHintProb[skill('x')]).toBeCloseTo(0.379056);
    expect(r.skillHintProb[skill('y')]).toBeCloseTo(0.43689984);
    expect(Object.values(r.aptitudeDist.turf).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('hand-computed 9-spark-style lineage has covariance and race/scenario effects', () => {
    const p = planInheritance(ctx, o('trainee'), [legacy('b', [blue('spd', 2), pink(1), white(2)], [
      { characterId: c('d'), sparks: [{ sparkId: sp('race-1'), type: 'white', stars: 3 }] },
      { characterId: c('e'), sparks: [{ sparkId: sp('scenario'), type: 'white', stars: 2 }] },
    ]), legacy('c', [blue('gut', 1), pink(3), { ...({ sparkId: sp('green-y'), type: 'green', stars: 1 }) } as never], [
      { characterId: c('f'), sparks: [{ sparkId: sp('white-x'), type: 'white', stars: 3 }] },
      { characterId: c('g'), sparks: [] },
    ])], scenario);
    const r = expectationFromPlan(p);
    expect(r.expectedStatGain).toEqual([48.1152, 0, 14.832, 30.7072, 0]);
    expect(r.statGainCov[0]?.[3]).toBeCloseTo(95.33841408);
    expect(r.skillHintProb[skill('x')]).toBeCloseTo(0.8158903536);
  });

  it('rejects illegal pairs before scoring', () => {
    expect(checkLegality(c('a'), { characterId: c('a') }, { characterId: c('b') }).legal).toBe(false);
    expect(() => planInheritance(ctx, o('trainee'), [legacy('b'), legacy('b')], scenario)).toThrow(IllegalPairError);
  });

  it('reads constants from the supplied rules rather than hard-coding them', () => {
    const p = planInheritance(ctx, o('trainee'), [legacy('b', [blue('spd', 3)]), legacy('c')], scenario);
    const normal = expectationFromPlan(p).expectedStatGain[0];
    const swappedRules = { ...rules, blueInitialBonus: { ...rules.blueInitialBonus, '3': 1 } };
    const changed = expectationFromPlan(planInheritance(loadContext(toyMaster(), swappedRules), o('trainee'), [legacy('b', [blue('spd', 3)]), legacy('c')], scenario)).expectedStatGain[0];
    expect(normal - changed).toBe(29);
  });

  it('seeded sampling tracks the exact expectation within 1% over 50k draws', () => {
    const p = planInheritance(ctx, o('trainee'), [legacy('b', [blue('spd', 3)]), legacy('c')], scenario);
    const expected = expectationFromPlan(p).expectedStatGain[0];
    const rng = mulberry32(0xdecafbad);
    let total = 0;
    for (let i = 0; i < 50_000; i++) total += sampleInheritance(p, rng).statGain[0] as number;
    expect(total / 50_000).toBeCloseTo(expected, 1); // < 1% for this mean
  });
});

