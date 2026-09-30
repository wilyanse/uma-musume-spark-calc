import { z } from 'zod';
import { Rules, StatKey, STAT_KEYS } from '@uma/schema';
import type { Character, Outfit, Skill, Spark } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import { compileAffinityFormula } from './formula.ts';
import { pluginFor, type ScenarioPlugin } from './scenarios/index.ts';

/** Raised when the rules file cannot drive the engine (malformed, not just unverified). */
export class RulesError extends Error {
  override name = 'RulesError';
}

/** Per-star numbers, index 0 = 1 star. */
export type PerStar = readonly [number, number, number];

/**
 * `raceSparkStatGain` and `scenarioSparkEffects` are open tables in 01 §12. These are the inner
 * keys the engine reads (the shape T03 publishes); anything missing means "no effect" and is
 * reported in `EngineContext.warnings`.
 */
const perStarArray = z.tuple([z.number(), z.number(), z.number()]);
const starObject = z.looseObject({ '1': z.number(), '2': z.number(), '3': z.number() });
const RaceTable = z.looseObject({
  perStar: perStarArray.optional(),
  activation: starObject.optional(),
  races: z
    .record(
      z.string(),
      z.looseObject({ stats: z.array(StatKey), hintSkillIds: z.array(z.number().int()).default([]) }),
    )
    .optional(),
});
const ScenarioTable = z.looseObject({
  activation: starObject.optional(),
  scenarios: z
    .record(z.string(), z.looseObject({ stats: z.array(StatKey), perStar: perStarArray }))
    .optional(),
});

export interface RaceEffectRow {
  stats: StatKey[];
  /** Skill ids resolved from the table's numeric game ids. */
  hintSkillIds: string[];
}

/**
 * Everything the inheritance model reads, resolved once from master data + rules.
 * Every number here comes from `rules` (01 §12: nothing is hard-coded in engine code).
 */
export interface EngineContext {
  masterVersion: string;
  rules: Rules;
  characters: ReadonlyMap<string, Character>;
  outfits: ReadonlyMap<string, Outfit>;
  skills: ReadonlyMap<string, Skill>;
  sparks: ReadonlyMap<string, Spark>;
  scenarios: ReadonlyMap<string, ScenarioPlugin>;
  /** characterId -> (affinity group id -> points). */
  affinityGroupsOf: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** `a|b` (sorted) -> points, from the optional pairwise table. */
  affinityPairs: ReadonlyMap<string, number>;
  /** `affinityMultiplier.formula`, parsed (never `eval`ed). */
  affinityMultiplier: (affinity: number) => number;
  /** Resolved rule tables. */
  tables: {
    activation: { blue: PerStar; pink: PerStar; green: PerStar; white: PerStar; race: PerStar; scenario: PerStar };
    grandparentWeight: number;
    blueStatGain: PerStar;
    blueInitialBonus: PerStar;
    pinkGradeGain: PerStar;
    whiteHintLevels: PerStar;
    raceStatGain: PerStar;
    races: ReadonlyMap<string, RaceEffectRow>;
    scenarioSparks: ReadonlyMap<string, { stats: StatKey[]; perStar: PerStar }>;
  };
  /** Rule keys whose `verified` is false. */
  unverifiedRules: string[];
  /** Rule keys whose source says the values are placeholders (`UNKNOWN…`). */
  placeholderRules: string[];
  /** Problems found while resolving data (missing optional tables, unknown ids). */
  warnings: string[];
}

const star = (t: { '1': number; '2': number; '3': number }): PerStar => [t['1'], t['2'], t['3']];

function assertFinite(name: string, v: PerStar | number): void {
  const xs = typeof v === 'number' ? [v] : v;
  if (!xs.every(Number.isFinite)) throw new RulesError(`rules.${name} must be finite numbers`);
}

/**
 * 50 §1 `loadContext(master, rules)`. `rules` is taken separately from `master.rules` so callers
 * (tests, T15 calibration) can swap it. The rules object is validated against the 01 §12 schema.
 */
export function loadContext(master: MasterBundle, rulesInput: Rules): EngineContext {
  const parsed = Rules.safeParse(rulesInput);
  if (!parsed.success) throw new RulesError(`invalid rules: ${parsed.error.message}`);
  const rules = parsed.data;
  const warnings: string[] = [];

  const skills = new Map(master.skills.map((s) => [s.id, s]));
  const skillByGameId = new Map<number, string>();
  for (const s of master.skills) if (s.gameId !== undefined) skillByGameId.set(s.gameId, s.id);

  // Open tables.
  const race = RaceTable.safeParse(rules.raceSparkStatGain);
  if (!race.success) warnings.push(`rules.raceSparkStatGain unreadable, race sparks have no effect: ${race.error.message}`);
  const raceT = race.success ? race.data : {};
  const scen = ScenarioTable.safeParse(rules.scenarioSparkEffects);
  if (!scen.success) warnings.push(`rules.scenarioSparkEffects unreadable, scenario sparks have no effect: ${scen.error.message}`);
  const scenT = scen.success ? scen.data : {};

  const races = new Map<string, RaceEffectRow>();
  for (const [raceId, row] of Object.entries(raceT.races ?? {})) {
    const hintSkillIds: string[] = [];
    for (const gid of row.hintSkillIds) {
      const id = skillByGameId.get(gid);
      if (id) hintSkillIds.push(id);
      else warnings.push(`rules.raceSparkStatGain.races.${raceId}: hint skill gameId ${gid} not in master skills`);
    }
    races.set(raceId, { stats: row.stats, hintSkillIds });
  }
  const scenarioSparks = new Map<string, { stats: StatKey[]; perStar: PerStar }>();
  for (const [id, row] of Object.entries(scenT.scenarios ?? {})) {
    scenarioSparks.set(id, { stats: row.stats, perStar: row.perStar });
  }

  if (!raceT.perStar) warnings.push('rules.raceSparkStatGain.perStar missing: race sparks add no stats');
  if (!raceT.activation) warnings.push('rules.raceSparkStatGain.activation missing: race sparks use activation.white');
  if (!scenT.activation) {
    // Not a problem per se: the cited calculator gives scenario sparks the skill table.
    warnings.push('rules.scenarioSparkEffects.activation missing: scenario sparks use activation.white');
  }

  const tables: EngineContext['tables'] = {
    activation: {
      blue: star(rules.activation.blue),
      pink: star(rules.activation.pink),
      green: star(rules.activation.green),
      white: star(rules.activation.white),
      race: raceT.activation ? star(raceT.activation) : star(rules.activation.white),
      scenario: scenT.activation ? star(scenT.activation) : star(rules.activation.white),
    },
    grandparentWeight: rules.grandparentWeight.value,
    blueStatGain: star(rules.blueStatGain),
    blueInitialBonus: star(rules.blueInitialBonus),
    pinkGradeGain: star(rules.pinkGradeGain),
    whiteHintLevels: star(rules.whiteHintLevels),
    raceStatGain: raceT.perStar ?? [0, 0, 0],
    races,
    scenarioSparks,
  };
  for (const [k, v] of Object.entries(tables.activation)) assertFinite(`activation.${k}`, v);
  for (const k of ['grandparentWeight', 'blueStatGain', 'blueInitialBonus', 'whiteHintLevels', 'raceStatGain'] as const) {
    assertFinite(k, tables[k]);
  }
  // Grades are ordinal (01 §1), so a grade gain must be a whole number of steps.
  if (!tables.pinkGradeGain.every((g) => Number.isInteger(g) && g >= 0)) {
    throw new RulesError('rules.pinkGradeGain must be non-negative integers (grade steps)');
  }

  let affinityMultiplier: (a: number) => number;
  try {
    affinityMultiplier = compileAffinityFormula(rules.affinityMultiplier.formula);
    affinityMultiplier(0);
  } catch (e) {
    throw new RulesError(`rules.affinityMultiplier.formula: ${(e as Error).message}`);
  }

  // Provenance summary.
  const sourced: [string, { verified: boolean; source: string }][] = [
    ['activation.blue', rules.activation.blue],
    ['activation.pink', rules.activation.pink],
    ['activation.green', rules.activation.green],
    ['activation.white', rules.activation.white],
    ['affinityMultiplier', rules.affinityMultiplier],
    ['grandparentWeight', rules.grandparentWeight],
    ['blueStatGain', rules.blueStatGain],
    ['blueInitialBonus', rules.blueInitialBonus],
    ['pinkGradeGain', rules.pinkGradeGain],
    ['whiteHintLevels', rules.whiteHintLevels],
    ['raceSparkStatGain', rules.raceSparkStatGain],
    ['scenarioSparkEffects', rules.scenarioSparkEffects],
  ];
  const unverifiedRules = sourced.filter(([, r]) => !r.verified).map(([k]) => k);
  const placeholderRules = sourced.filter(([, r]) => /^\s*UNKNOWN/i.test(r.source)).map(([k]) => k);

  // Affinity: group membership per character, plus the optional pairwise table.
  const affinityGroupsOf = new Map<string, Map<string, number>>();
  for (const g of master.affinity.groups) {
    for (const m of g.members) {
      let row = affinityGroupsOf.get(m);
      if (!row) affinityGroupsOf.set(m, (row = new Map()));
      row.set(g.id, (row.get(g.id) ?? 0) + g.points);
    }
  }
  const affinityPairs = new Map<string, number>();
  for (const p of master.affinity.pairs ?? []) {
    const key = pairKey(p.a, p.b);
    affinityPairs.set(key, (affinityPairs.get(key) ?? 0) + p.points);
  }

  const scenarios = new Map<string, ScenarioPlugin>();
  for (const row of master.scenarios) scenarios.set(row.id, pluginFor(row));

  return {
    masterVersion: master.version,
    rules,
    characters: new Map(master.characters.map((c) => [c.id, c])),
    outfits: new Map(master.outfits.map((o) => [o.id, o])),
    skills,
    sparks: new Map(master.sparks.map((s) => [s.id, s])),
    scenarios,
    affinityGroupsOf,
    affinityPairs,
    affinityMultiplier,
    tables,
    unverifiedRules,
    placeholderRules,
    warnings,
  };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export const STAT_INDEX: Readonly<Record<StatKey, number>> = Object.fromEntries(
  STAT_KEYS.map((k, i) => [k, i]),
) as Record<StatKey, number>;
