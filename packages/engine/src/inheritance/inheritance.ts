import { APT_KEYS, GRADES, STAT_KEYS } from '@uma/schema';
import type { AptKey, Grade, Spark, SparkType } from '@uma/schema';
import type { EngineContext, PerStar } from '../context.ts';
import { STAT_INDEX } from '../context.ts';
import type { Rng } from '../rng.ts';
import type { Effect, Legacy, SparkSource, Stars, StatVector, Veteran } from '../types.ts';
import { computeAffinity, type AffinityResult } from './affinity.ts';
import { checkLegality, IllegalPairError, traineeCharacter, UnknownIdError } from './legality.ts';

const MAX_GRADE = GRADES.length - 1; // S

/** Which activation table a spark rolls on. */
export type ActivationKind = 'blue' | 'pink' | 'green' | 'white-skill' | 'white-race' | 'white-scenario';

/** One spark that can activate at each inheritance event. */
export interface Activation {
  sparkId: string;
  from: SparkSource;
  type: SparkType;
  kind: ActivationKind;
  stars: Stars;
  /** 50 §3: clamp(activation[kind][stars] × weight × affinityMultiplier(affinity of `from`), 0, 1), per event. */
  p: number;
  /** What one activation does. */
  effect: Effect;
  /** Career-start bonus this spark gives once, independent of events (parent blue sparks only). */
  initialBonus: StatVector;
}

export interface SkippedSpark {
  sparkId: string;
  from: SparkSource;
  reason: string;
}

/**
 * How far the output can be trusted. With the published Global bundle `validated` is false:
 * every rule is `verified:false`, some are `UNKNOWN` zero placeholders, and the scenarios have no
 * inheritance turns, so the outputs are mechanics over placeholder data, not game predictions.
 */
export interface InheritanceProvenance {
  masterVersion: string;
  rulesVersion: string;
  /** False when the scenario lists no inheritance turns: event rolls then contribute nothing. */
  eventsKnown: boolean;
  unverifiedRules: string[];
  placeholderRules: string[];
  /** True only if every rule is verified, none is a placeholder, and the events are known. */
  validated: boolean;
  warnings: string[];
}

/** Precomputed inputs for the closed form and for sampling; reuse it across samples. */
export interface InheritancePlan {
  traineeOutfitId: string;
  traineeCharacterId: string;
  scenarioId: string;
  /** Inheritance turns from the scenario plugin; every activation rolls once per entry. */
  events: number[];
  baseAptitudes: Record<AptKey, Grade>;
  /** Career-start bonus from the parents' (not grandparents') blue sparks (50 §3). */
  initialStatBonus: StatVector;
  activations: Activation[];
  affinity: AffinityResult;
  skipped: SkippedSpark[];
  provenance: InheritanceProvenance;
}

export interface Contribution {
  sparkId: string;
  from: SparkSource;
  type: SparkType;
  kind: ActivationKind;
  stars: Stars;
  /** Activation chance per event. */
  p: number;
  /** Probability of at least one activation over all events: 1 − (1 − p)^events. */
  pAny: number;
  /**
   * This spark's career-start bonus (parent blue sparks only; zeros for everything else,
   * including grandparent blue sparks). Already included in `expectedEffect.stats`.
   */
  initialBonus: StatVector;
  /**
   * Expected effect over the career. `stats` = `initialBonus` + p × events × effect.stats, so
   * summing `stats` over all contributions gives `expectedStatGain` exactly (component-wise).
   * Aptitude steps are p × events × steps (before the S cap); hints carry `prob` = pAny.
   */
  expectedEffect: {
    stats: StatVector;
    aptitudeGrades: Partial<Record<AptKey, number>>;
    hints: { skillId: string; level: number; prob: number }[];
  };
}

/** 50 §3 outputs. Everything is exact (closed form). */
export interface InheritanceResult {
  /** Σ p × gain × events + initial, in stat order. */
  expectedStatGain: StatVector;
  /** Exact covariance of the stat gain (5×5, stat order); the initial bonus is constant. */
  statGainCov: number[][];
  initialStatBonus: StatVector;
  /** Final grade distribution per aptitude: trainee base + pink steps, capped at S. Sums to 1. */
  aptitudeDist: Record<AptKey, Record<Grade, number>>;
  /** Distribution of the (uncapped) number of grade steps gained per aptitude; index = steps. */
  aptitudeGainDist: Record<AptKey, number[]>;
  /** 1 − Π(1 − p) over all activations (and events) that hint the skill. */
  skillHintProb: Record<string, number>;
  contributions: Contribution[];
  affinity: AffinityResult;
  events: number[];
  skipped: SkippedSpark[];
  provenance: InheritanceProvenance;
}

/** One Monte Carlo draw (50 §5 step 1). */
export interface InheritanceSample {
  statGain: StatVector;
  /** Grade steps gained per aptitude, before the S cap. */
  pinkGain: Record<AptKey, number>;
  /** Trainee base + pinkGain, capped at S. */
  aptitudes: Record<AptKey, Grade>;
  /** Skill id -> number of hint activations (only hinted skills are present). */
  hints: Record<string, number>;
}

const zeros = (): StatVector => [0, 0, 0, 0, 0];
const addAt = (v: number[], k: number, x: number): void => {
  v[k] = (v[k] ?? 0) + x;
};

/** A roster veteran as a legacy: own sparks + its parents' sparks as the grandparents. */
export function legacyFromVeteran(v: Veteran): Legacy {
  const own = (owner: 'self' | 'parent1' | 'parent2') =>
    v.sparks.filter((s) => s.owner === owner).map((s) => ({ sparkId: s.sparkId, type: s.type, stars: s.stars }));
  const gp = (slot: 1 | 2) => {
    const p = v.parents.find((x) => x.slot === slot);
    return { characterId: p?.characterId ?? null, sparks: own(slot === 1 ? 'parent1' : 'parent2') };
  };
  return { veteranId: v.id, characterId: v.characterId, sparks: own('self'), grandparents: [gp(1), gp(2)] };
}

function starValue(t: PerStar, stars: Stars): number {
  return t[stars - 1] as number;
}

function kindOf(spark: Spark): ActivationKind {
  if (spark.type !== 'white') return spark.type;
  if (spark.target.kind === 'race') return 'white-race';
  if (spark.target.kind === 'scenario') return 'white-scenario';
  return 'white-skill';
}

function baseRate(ctx: EngineContext, kind: ActivationKind, stars: Stars): number {
  const a = ctx.tables.activation;
  const table =
    kind === 'blue'
      ? a.blue
      : kind === 'pink'
        ? a.pink
        : kind === 'green'
          ? a.green
          : kind === 'white-race'
            ? a.race
            : kind === 'white-scenario'
              ? a.scenario
              : a.white;
  return starValue(table, stars);
}

/** The rules-driven effect of one activation (50 §3 "Effects of one activation"). */
function defaultEffect(ctx: EngineContext, spark: Spark, stars: Stars, warn: (m: string) => void): Effect {
  const t = ctx.tables;
  const effect: Effect = { stats: zeros(), aptitudeGrades: {}, hints: [] };
  const hintLevel = starValue(t.whiteHintLevels, stars);
  const target = spark.target;
  switch (target.kind) {
    case 'stat':
      addAt(effect.stats, STAT_INDEX[target.stat], starValue(t.blueStatGain, stars));
      break;
    case 'aptitude':
      effect.aptitudeGrades[target.apt] = starValue(t.pinkGradeGain, stars);
      break;
    case 'skill':
      effect.hints.push({ skillId: target.skillId, level: hintLevel });
      break;
    case 'race': {
      const row = t.races.get(target.raceId);
      if (!row) {
        warn(`${spark.id}: race ${target.raceId} not in rules.raceSparkStatGain.races; no effect`);
        break;
      }
      for (const s of row.stats) addAt(effect.stats, STAT_INDEX[s], starValue(t.raceStatGain, stars));
      for (const skillId of row.hintSkillIds) effect.hints.push({ skillId, level: hintLevel });
      break;
    }
    case 'scenario': {
      const row = t.scenarioSparks.get(target.scenarioId);
      if (!row) {
        warn(`${spark.id}: ${target.scenarioId} not in rules.scenarioSparkEffects.scenarios; no effect`);
        break;
      }
      for (const s of row.stats) addAt(effect.stats, STAT_INDEX[s], starValue(row.perStar, stars));
      break;
    }
  }
  return effect;
}

function mergeEffect(sparkId: string, partial: Partial<Effect>): Effect {
  const stats = partial.stats ? ([...partial.stats] as StatVector) : zeros();
  if (stats.length !== 5 || !stats.every(Number.isFinite)) {
    throw new RangeError(`${sparkId}: scenario plugin stats must be 5 finite numbers`);
  }
  return {
    stats,
    aptitudeGrades: { ...(partial.aptitudeGrades ?? {}) },
    hints: [...(partial.hints ?? [])],
  };
}

/** One activation hints a skill at most once (N1): duplicates keep the highest level. */
function dedupeHints(hints: Effect['hints']): Effect['hints'] {
  const byId = new Map<string, number>();
  for (const h of hints) byId.set(h.skillId, Math.max(byId.get(h.skillId) ?? -Infinity, h.level));
  return [...byId].map(([skillId, level]) => ({ skillId, level }));
}

/**
 * Builds the activation list for a trainee, two legacies and a scenario. Throws
 * `IllegalPairError` for an illegal pair, `UnknownIdError` for an unknown outfit / scenario, and
 * `RulesError` when the affinity multiplier formula is non-finite or negative at a source's
 * actual affinity. Unknown spark ids are skipped and reported (never guessed).
 */
export function planInheritance(
  ctx: EngineContext,
  traineeOutfitId: string,
  parents: readonly [Legacy, Legacy],
  scenarioId: string,
): InheritancePlan {
  const T = traineeCharacter(ctx, traineeOutfitId);
  const legality = checkLegality(T, parents[0], parents[1]);
  if (!legality.legal) throw new IllegalPairError(legality.reasons);
  const plugin = ctx.scenarios.get(scenarioId);
  if (!plugin) throw new UnknownIdError(`unknown scenario ${scenarioId}`);
  const outfit = ctx.outfits.get(traineeOutfitId);
  if (!outfit) throw new UnknownIdError(`unknown trainee outfit ${traineeOutfitId}`);

  const warnings: string[] = [...ctx.warnings];
  const warn = (m: string) => warnings.push(m);
  const events = plugin.inheritanceTurns(ctx);
  if (events.length === 0) {
    warn(`${scenarioId} has no inheritanceTurns in master data: event rolls contribute nothing; only the career-start blue bonus applies`);
  }

  const affinity = computeAffinity(ctx, T, parents);
  const activations: Activation[] = [];
  const skipped: SkippedSpark[] = [];
  const initialStatBonus = zeros();

  const sources: [SparkSource, Legacy['sparks'], number][] = [
    ['P1', parents[0].sparks, 1],
    ['P2', parents[1].sparks, 1],
    ['GP1a', parents[0].grandparents[0]?.sparks ?? [], ctx.tables.grandparentWeight],
    ['GP1b', parents[0].grandparents[1]?.sparks ?? [], ctx.tables.grandparentWeight],
    ['GP2a', parents[1].grandparents[0]?.sparks ?? [], ctx.tables.grandparentWeight],
    ['GP2b', parents[1].grandparents[1]?.sparks ?? [], ctx.tables.grandparentWeight],
  ];
  for (const [from, sparks, weight] of sources) {
    const mult = ctx.affinityMultiplier(affinity.perSource[from]);
    for (const ref of sparks) {
      const spark = ctx.sparks.get(ref.sparkId);
      if (!spark) {
        skipped.push({ sparkId: ref.sparkId, from, reason: 'not in master sparks' });
        continue;
      }
      if (spark.type !== ref.type) {
        warn(`${ref.sparkId} (${from}) recorded as ${ref.type}, master says ${spark.type}; using master`);
      }
      const kind = kindOf(spark);
      const p = Math.min(1, Math.max(0, baseRate(ctx, kind, ref.stars) * weight * mult));
      let effect = defaultEffect(ctx, spark, ref.stars, warn);
      if (spark.type === 'white' && plugin.sparkEffects) {
        const custom = plugin.sparkEffects({ spark, stars: ref.stars }, ctx);
        if (custom) effect = mergeEffect(spark.id, custom);
      }
      // 50 §3: parents' blue sparks only. rules.json's cited source says the bonus is additive
      // over every legacy *and sub-legacy*; the spec wins here (see Q-3 / T15 in the changelog).
      const initialBonus = zeros();
      if (spark.type === 'blue' && spark.target.kind === 'stat' && (from === 'P1' || from === 'P2')) {
        const k = STAT_INDEX[spark.target.stat];
        const bonus = starValue(ctx.tables.blueInitialBonus, ref.stars);
        addAt(initialBonus, k, bonus);
        addAt(initialStatBonus, k, bonus);
      }
      for (const [apt, g] of Object.entries(effect.aptitudeGrades)) {
        if (!Number.isInteger(g) || g < 0) {
          throw new RangeError(`${spark.id}: aptitude gain for ${apt} must be a non-negative integer, got ${g}`);
        }
      }
      effect = { ...effect, hints: dedupeHints(effect.hints) };
      activations.push({ sparkId: spark.id, from, type: spark.type, kind, stars: ref.stars, p, effect, initialBonus });
    }
  }
  for (const s of skipped) warn(`skipped ${s.sparkId} (${s.from}): ${s.reason}`);

  const eventsKnown = events.length > 0;
  return {
    traineeOutfitId,
    traineeCharacterId: T,
    scenarioId,
    events,
    baseAptitudes: { ...outfit.aptitudes },
    initialStatBonus,
    activations,
    affinity,
    skipped,
    provenance: {
      masterVersion: ctx.masterVersion,
      rulesVersion: ctx.rules.version,
      eventsKnown,
      unverifiedRules: [...ctx.unverifiedRules],
      placeholderRules: [...ctx.placeholderRules],
      validated: eventsKnown && ctx.unverifiedRules.length === 0 && ctx.placeholderRules.length === 0,
      warnings,
    },
  };
}

/** Distribution of the sum of independent integer-valued Bernoulli gains. */
function convolve(items: { p: number; gain: number }[]): number[] {
  let dist = [1];
  for (const { p, gain } of items) {
    if (gain === 0 || p === 0) continue;
    const next = new Array<number>(dist.length + gain).fill(0);
    for (let i = 0; i < dist.length; i++) {
      const d = dist[i] as number;
      next[i] = (next[i] as number) + d * (1 - p);
      next[i + gain] = (next[i + gain] as number) + d * p;
    }
    dist = next;
  }
  return dist;
}

/** The closed-form summary of a plan (50 §3 Outputs). */
export function expectationFromPlan(plan: InheritancePlan): InheritanceResult {
  const n = plan.events.length;
  const expected = [...plan.initialStatBonus] as StatVector;
  const cov: number[][] = STAT_KEYS.map(() => STAT_KEYS.map(() => 0));
  const aptItems = new Map<AptKey, { p: number; gain: number }[]>();
  const missProb = new Map<string, number>();
  const contributions: Contribution[] = [];

  for (const a of plan.activations) {
    const pAny = 1 - (1 - a.p) ** n;
    // B1: the initial bonus is part of this spark's effect (already in `expected` via
    // `plan.initialStatBonus`, so it is added here to the contribution only).
    const stats = [...a.initialBonus] as StatVector;
    for (let k = 0; k < 5; k++) {
      const g = a.effect.stats[k] as number;
      const mean = n * a.p * g;
      addAt(stats, k, mean);
      addAt(expected, k, mean);
      const row = cov[k] as number[];
      for (let j = 0; j < 5; j++) addAt(row, j, n * a.p * (1 - a.p) * g * (a.effect.stats[j] as number));
    }
    const aptitudeGrades: Partial<Record<AptKey, number>> = {};
    for (const [apt, g] of Object.entries(a.effect.aptitudeGrades) as [AptKey, number][]) {
      aptitudeGrades[apt] = n * a.p * g;
      let list = aptItems.get(apt);
      if (!list) aptItems.set(apt, (list = []));
      for (let e = 0; e < n; e++) list.push({ p: a.p, gain: g });
    }
    const hints = a.effect.hints.map((h) => {
      missProb.set(h.skillId, (missProb.get(h.skillId) ?? 1) * (1 - a.p) ** n);
      return { skillId: h.skillId, level: h.level, prob: pAny };
    });
    contributions.push({
      sparkId: a.sparkId,
      from: a.from,
      type: a.type,
      kind: a.kind,
      stars: a.stars,
      p: a.p,
      pAny,
      initialBonus: [...a.initialBonus] as StatVector,
      expectedEffect: { stats, aptitudeGrades, hints },
    });
  }

  const aptitudeDist = {} as Record<AptKey, Record<Grade, number>>;
  const aptitudeGainDist = {} as Record<AptKey, number[]>;
  for (const apt of APT_KEYS) {
    const gain = convolve(aptItems.get(apt) ?? []);
    aptitudeGainDist[apt] = gain;
    const row = Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>;
    const base = GRADES.indexOf(plan.baseAptitudes[apt]);
    gain.forEach((pr, steps) => {
      const g = GRADES[Math.min(MAX_GRADE, base + steps)] as Grade;
      row[g] += pr;
    });
    aptitudeDist[apt] = row;
  }
  const skillHintProb: Record<string, number> = {};
  for (const [id, miss] of missProb) skillHintProb[id] = 1 - miss;

  return {
    expectedStatGain: expected,
    statGainCov: cov,
    initialStatBonus: [...plan.initialStatBonus] as StatVector,
    aptitudeDist,
    aptitudeGainDist,
    skillHintProb,
    contributions,
    affinity: plan.affinity,
    events: [...plan.events],
    skipped: [...plan.skipped],
    provenance: plan.provenance,
  };
}

/**
 * 50 §3 `inheritanceExpectation(ctx, trainee, parents, scenarioId)`: closed-form expectation for
 * two roster veterans (their own parents are the grandparents).
 */
export function inheritanceExpectation(
  ctx: EngineContext,
  traineeOutfitId: string,
  parents: readonly [Veteran, Veteran],
  scenarioId: string,
): InheritanceResult {
  const plan = planInheritance(ctx, traineeOutfitId, [legacyFromVeteran(parents[0]), legacyFromVeteran(parents[1])], scenarioId);
  return expectationFromPlan(plan);
}

/**
 * 50 §3 `sampleInheritance`: one Monte Carlo draw from a plan. Each activation rolls
 * independently at each event, in a fixed order, so a seeded `rng` gives a reproducible draw.
 */
export function sampleInheritance(plan: InheritancePlan, rng: Rng): InheritanceSample {
  const statGain = [...plan.initialStatBonus] as StatVector;
  const pinkGain = Object.fromEntries(APT_KEYS.map((k) => [k, 0])) as Record<AptKey, number>;
  const hints: Record<string, number> = {};
  for (let e = 0; e < plan.events.length; e++) {
    for (const a of plan.activations) {
      if (!(rng() < a.p)) continue;
      for (let k = 0; k < 5; k++) addAt(statGain, k, a.effect.stats[k] as number);
      for (const [apt, g] of Object.entries(a.effect.aptitudeGrades) as [AptKey, number][]) pinkGain[apt] += g;
      for (const h of a.effect.hints) hints[h.skillId] = (hints[h.skillId] ?? 0) + 1;
    }
  }
  const aptitudes = {} as Record<AptKey, Grade>;
  for (const apt of APT_KEYS) {
    aptitudes[apt] = GRADES[Math.min(MAX_GRADE, GRADES.indexOf(plan.baseAptitudes[apt]) + pinkGain[apt])] as Grade;
  }
  return { statGain, pinkGain, aptitudes, hints };
}
