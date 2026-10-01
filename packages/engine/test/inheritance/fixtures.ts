/**
 * Synthetic toy master data and rules for mechanics tests. Every value here is a synthetic
 * fixture (`source: 'synthetic fixture'`), not game data. The master files are validated with
 * the shared `@uma/schema` file schemas, so fixture typos fail loudly (review N3).
 */
import {
  AffinityFile,
  CharactersFile,
  OutfitsFile,
  Rules,
  ScenariosFile,
  SkillsFile,
  SparksFile,
} from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import { expect } from 'vitest';
import type { InheritanceResult, Legacy, SparkRef } from '../../src/index.ts';

export const c = (slug: string) => `character:${slug}`;
export const o = (slug: string) => `outfit:${slug}`;
export const sp = (slug: string) => `spark:${slug}`;
export const skill = (slug: string) => `skill:${slug}`;
export const SCENARIO = 'scenario:toy';
export const ZERO_EVENT_SCENARIO = 'scenario:toy-no-events';
export const TRAINEE = o('trainee'); // character a, all aptitudes C
export const TRAINEE_A = o('trainee-a-rank'); // character a, turf A (for the S cap)

const synthetic = { verified: true, source: 'synthetic fixture' } as const;

export function toyRules(): Rules {
  return Rules.parse({
    version: 'toy-rules',
    activation: {
      blue: { '1': 0.5, '2': 0.6, '3': 0.7, ...synthetic },
      pink: { '1': 0.2, '2': 0.3, '3': 0.4, ...synthetic },
      green: { '1': 0.1, '2': 0.2, '3': 0.3, ...synthetic },
      white: { '1': 0.2, '2': 0.3, '3': 0.4, ...synthetic },
    },
    affinityMultiplier: { formula: '1 + affinity/100', ...synthetic },
    grandparentWeight: { value: 0.8, ...synthetic },
    blueStatGain: { '1': 4, '2': 8, '3': 12, ...synthetic },
    blueInitialBonus: { '1': 10, '2': 20, '3': 30, ...synthetic },
    pinkGradeGain: { '1': 1, '2': 1, '3': 2, ...synthetic },
    whiteHintLevels: { '1': 1, '2': 2, '3': 3, ...synthetic },
    raceSparkStatGain: {
      ...synthetic,
      perStar: [5, 10, 15],
      activation: { '1': 0.4, '2': 0.5, '3': 0.6 },
      races: {
        'race-1': { stats: ['pow'], hintSkillIds: [9001] },
        // Duplicate hint id on purpose (review N1): one activation must hint `race` once.
        'race-dup': { stats: ['sta', 'wit'], hintSkillIds: [9001, 9001] },
      },
    },
    scenarioSparkEffects: {
      ...synthetic,
      activation: { '1': 0.6, '2': 0.7, '3': 0.8 },
      scenarios: { [SCENARIO]: { stats: ['spd', 'gut'], perStar: [7, 14, 21] } },
    },
  });
}

const aptitudes = (over: Record<string, string> = {}) => ({
  turf: 'C',
  dirt: 'C',
  sprint: 'C',
  mile: 'C',
  medium: 'C',
  long: 'C',
  front: 'C',
  pace: 'C',
  late: 'C',
  end: 'C',
  ...over,
});
const growth = { spd: 0, sta: 0, pow: 0, gut: 0, wit: 0 };

export function toyMaster(rules: Rules = toyRules(), turns: number[] = [1, 2]): MasterBundle {
  const groups = [
    { id: 'g1', points: 2, members: ['a', 'b', 'c'] },
    { id: 'g2', points: 3, members: ['a', 'b', 'd'] },
    { id: 'g3', points: 5, members: ['b', 'c'] },
    { id: 'g4', points: 4, members: ['a', 'b', 'e'] },
    { id: 'g5', points: 1, members: ['c', 'f', 'g'] },
  ].map((g) => ({ ...g, members: g.members.map(c) }));
  const characters = ['a', 't', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => ({
    id: c(x),
    name: x,
    aliases: [],
    affinityGroups: groups.filter((g) => g.members.includes(c(x))).map((g) => g.id),
    iconHashes: [],
  }));
  const outfit = (id: string, characterId: string, apt: Record<string, string> = {}) => ({
    id,
    characterId,
    title: id,
    aptitudes: aptitudes(apt),
    growth,
    uniqueSkillId: skill('x'),
    innateSkillIds: [],
  });
  const sparks = [
    ['spd', 'blue', { kind: 'stat', stat: 'spd' }],
    ['sta', 'blue', { kind: 'stat', stat: 'sta' }],
    ['pow', 'blue', { kind: 'stat', stat: 'pow' }],
    ['gut', 'blue', { kind: 'stat', stat: 'gut' }],
    ['wit', 'blue', { kind: 'stat', stat: 'wit' }],
    ['pink-turf', 'pink', { kind: 'aptitude', apt: 'turf' }],
    ['pink-dirt', 'pink', { kind: 'aptitude', apt: 'dirt' }],
    ['green-y', 'green', { kind: 'skill', skillId: skill('y') }],
    ['white-x', 'white', { kind: 'skill', skillId: skill('x') }],
    ['race-1', 'white', { kind: 'race', raceId: 'race-1' }],
    ['race-dup', 'white', { kind: 'race', raceId: 'race-dup' }],
    ['race-missing', 'white', { kind: 'race', raceId: 'race-not-in-rules' }],
    ['scenario', 'white', { kind: 'scenario', scenarioId: SCENARIO }],
    ['scenario-other', 'white', { kind: 'scenario', scenarioId: 'scenario:not-in-rules' }],
  ].map(([id, type, target]) => ({ id: sp(id as string), name: id as string, type, target }));
  return {
    version: 'toy-master',
    characters: CharactersFile.parse(characters),
    outfits: OutfitsFile.parse([
      outfit(TRAINEE, c('a')),
      outfit(TRAINEE_A, c('a'), { turf: 'A' }),
      outfit(o('trainee-b'), c('b')),
    ]),
    skills: SkillsFile.parse([
      { id: skill('x'), name: 'X', aliases: [], rarity: 'normal', tags: [], gameId: 9000 },
      { id: skill('y'), name: 'Y', aliases: [], rarity: 'normal', tags: [], gameId: 9002 },
      { id: skill('race'), name: 'Race', aliases: [], rarity: 'normal', tags: [], gameId: 9001 },
    ]),
    sparks: SparksFile.parse(sparks),
    cards: [],
    affinity: AffinityFile.parse({ groups, pairs: [{ a: c('a'), b: c('c'), points: 1 }] }),
    scenarios: ScenariosFile.parse([
      { id: SCENARIO, name: 'Toy', statCap: 2000, inheritanceTurns: turns },
      { id: ZERO_EVENT_SCENARIO, name: 'Toy no events', statCap: 1200, inheritanceTurns: [] },
    ]),
    ranks: [],
    vocab: [],
    rules,
  };
}

export function legacy(
  characterId: string,
  sparks: SparkRef[] = [],
  grandparents: Legacy['grandparents'] = [null, null],
): Legacy {
  return { veteranId: null, characterId: c(characterId), sparks, grandparents };
}
export const blue = (stat: 'spd' | 'sta' | 'pow' | 'gut' | 'wit', stars: 1 | 2 | 3): SparkRef => ({
  sparkId: sp(stat),
  type: 'blue',
  stars,
});
export const pink = (stars: 1 | 2 | 3, apt: 'turf' | 'dirt' = 'turf'): SparkRef => ({
  sparkId: sp(`pink-${apt}`),
  type: 'pink',
  stars,
});
export const green = (stars: 1 | 2 | 3): SparkRef => ({
  sparkId: sp('green-y'),
  type: 'green',
  stars,
});
export const white = (id: string, stars: 1 | 2 | 3): SparkRef => ({
  sparkId: sp(id),
  type: 'white',
  stars,
});

/** The review's lineages (hand-computed in toy.test.ts). */
export const lineage1 = (): [Legacy, Legacy] => [legacy('b', [blue('spd', 3)]), legacy('c')];
export const lineage3 = (): [Legacy, Legacy] => [
  legacy('b', [pink(2)], [{ characterId: c('e'), sparks: [green(3)] }, null]),
  legacy('d', [white('white-x', 1)]),
];
export const lineage9 = (): [Legacy, Legacy] => [
  legacy(
    'b',
    [blue('spd', 2), pink(1), white('white-x', 2)],
    [
      { characterId: c('d'), sparks: [white('race-1', 3)] },
      { characterId: c('e'), sparks: [white('scenario', 2)] },
    ],
  ),
  legacy(
    'c',
    [blue('gut', 1), pink(3), green(1)],
    [
      { characterId: c('f'), sparks: [white('white-x', 3)] },
      { characterId: c('g'), sparks: [] },
    ],
  ),
];
/**
 * A richer lineage for Monte Carlo / mutation tests: all five stats move through events, two
 * aptitudes, three hinted skills, grandparent blue/pink/race/scenario sparks and a duplicate-hint
 * race row.
 */
export const richLineage = (): [Legacy, Legacy] => [
  legacy(
    'b',
    [blue('spd', 3), pink(2), green(2), white('white-x', 1)],
    [
      { characterId: c('d'), sparks: [blue('sta', 3), pink(3, 'dirt'), white('race-1', 2)] },
      { characterId: c('e'), sparks: [blue('wit', 1), white('scenario', 3)] },
    ],
  ),
  legacy(
    'c',
    [blue('pow', 2), pink(3), white('race-dup', 3)],
    [
      { characterId: c('f'), sparks: [blue('gut', 2), pink(1, 'dirt'), white('white-x', 3)] },
      { characterId: null, sparks: [blue('spd', 1), green(1)] },
    ],
  ),
];

/** Component-wise: Σ contributions.expectedEffect.stats == expectedStatGain (review B1). */
export function expectContributionsSumToExpected(r: InheritanceResult): void {
  const sum = [0, 0, 0, 0, 0];
  for (const x of r.contributions)
    x.expectedEffect.stats.forEach((v, k) => (sum[k] = (sum[k] ?? 0) + v));
  r.expectedStatGain.forEach((v, k) => expect(sum[k]).toBeCloseTo(v, 9));
  const bonus = [0, 0, 0, 0, 0];
  for (const x of r.contributions)
    x.initialBonus.forEach((v, k) => (bonus[k] = (bonus[k] ?? 0) + v));
  expect(bonus).toEqual(r.initialStatBonus);
}

export function expectVectorClose(
  actual: readonly number[],
  expected: readonly number[],
  digits = 9,
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, k) => expect(actual[k]).toBeCloseTo(v, digits));
}
