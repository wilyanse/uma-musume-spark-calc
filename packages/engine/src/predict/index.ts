/**
 * 50 §5 `predictChild` and 50 §6 `scoreTarget`, with the ADR-0002 errata:
 *
 * - inheritance is drawn from its own stream `${seed}:inh` (T05 `sampleInheritance`), training
 *   from `${seed}:train` as xβ + L z (L = eigen factor of the NON-inheritance Σ_N, z = five
 *   Box–Muller normals in stat order), and skills from `${seed}:skill` (one uniform per sample and
 *   skill, ALWAYS consumed, so no stream's consumption depends on another's draws);
 * - stats = clip(train + inh.statGain, 1, statCap), never rounded;
 * - a skill is available once: deck hint/event ∪ innate ∪ THIS sample's inheritance hints; then
 *   acquired ~ Bernoulli(E[θ_{mode,S}]). The Beta is never multiplied by P(hinted) a second time.
 */
import { APT_KEYS, GRADES, STAT_KEYS } from '@uma/schema';
import type { AptKey, CmTarget, Grade, StatKey } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import {
  expectationFromPlan,
  legacyFromVeteran,
  planInheritance,
  sampleInheritance,
} from '../inheritance/inheritance.ts';
import type {
  Contribution,
  InheritancePlan,
  InheritanceProvenance,
  InheritanceResult,
} from '../inheritance/inheritance.ts';
import type { AffinityResult } from '../inheritance/affinity.ts';
import { UnknownIdError } from '../inheritance/legality.ts';
import type { Matrix } from '../linalg.ts';
import { mulberry32, seedFromString } from '../rng.ts';
import type { PlanInput, Veteran } from '../types.ts';
import { ModelInputError, ScoreRequiresSamplesError } from '../model/errors.ts';
import { featureVector } from '../model/features.ts';
import type { FeatureWarnings } from '../model/features.ts';
import { prepareModel } from '../model/prepared.ts';
import type { PreparedModel } from '../model/prepared.ts';
import { dot } from '../model/ridge.ts';
import { boxMuller, expectedExcess, quantileSorted, upperTail } from './normal.ts';

export const DEFAULT_SAMPLES = 2000;
const MAX_GRADE = GRADES.length - 1;

export interface PredictOptions {
  /** Monte Carlo sample count (default 2000). */
  samples?: number;
  /** Seed; the three streams are `${seed}:inh`, `${seed}:train`, `${seed}:skill`. */
  seed: number | string;
  /** Return the raw per-sample arrays (`ChildPrediction.samples`). */
  keepSamples?: boolean;
  /**
   * Skills to simulate. Default: the target's skills when `target` is given, else every candidate
   * skill (deck hint/event ∪ innate ∪ lineage hints, minus the trainee's unique skill).
   */
  skills?: readonly string[];
  /** Also score this target from the joint samples before they are dropped (50 §6). */
  target?: CmTarget;
}

export interface StatSummary {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  sd: number;
  /** Share of samples clipped at 1 / at statCap. */
  clippedLow: number;
  clippedHigh: number;
}

export interface SkillPrediction {
  /** Closed-form availability: 1 for deck hint/event or innate, else the pair's skillHintProb. */
  pHinted: number;
  /** Deck hint/event or innate (Q-130: certain availability). */
  guaranteed: boolean;
  /** E[θ_{mode,skill}], the conditional acquisition rate. */
  theta: number;
  /** True when θ is the global prior `'*'` (no evidence for this skill in this mode). */
  thetaFromPrior: boolean;
  /** Closed form P(acquire) = pHinted · θ (availability counted once). */
  pAcquire: number;
  /** Monte Carlo share of samples where it was acquired. */
  pAcquireMc: number;
}

/** Raw draws, one entry per sample (kept only with `keepSamples`). */
export interface PredictionSamples {
  n: number;
  /** Final clipped (unrounded) stats, `stats[k][s]`. */
  stats: Record<StatKey, Float64Array>;
  /** The training draw xβ + L z per stat (stream `${seed}:train`), before clipping. */
  training: Record<StatKey, Float64Array>;
  /** The inheritance stat gain per stat (stream `${seed}:inh`). */
  inheritance: Record<StatKey, Float64Array>;
  /** The skill-stream uniform per (skill, sample) (stream `${seed}:skill`). */
  skillUniforms: Record<string, Float64Array>;
  /** Grade ordinals 0..7 per aptitude. */
  aptitudes: Record<AptKey, Uint8Array>;
  /** 1 = acquired. */
  skills: Record<string, Uint8Array>;
}

/** Closed-form (Gaussian / exact) summary used by the 50 §7 fast pass. */
export interface GaussianSummary {
  /** μ_train + E[inh]. */
  mean: number[];
  /** Σ_N,kk + Var[inh_k] (each once). */
  variance: number[];
  statCap: number;
  /** Exact T05 aptitude distribution (base + pink, capped at S). */
  aptitudeDist: Record<AptKey, Record<Grade, number>>;
}

export interface ChildPrediction {
  modelId: string;
  seed: string;
  samples: number;
  statCap: number;
  /** x·β, the training mean of the plan (without inheritance). */
  trainingMean: number[];
  stats: Record<StatKey, StatSummary>;
  /** MC grade frequencies per aptitude; each row sums to 1. */
  aptitudes: Record<AptKey, Record<Grade, number>>;
  skills: Record<string, SkillPrediction>;
  gaussian: GaussianSummary;
  affinity: AffinityResult;
  contributions: Contribution[];
  provenance: InheritanceProvenance;
  featureWarnings: FeatureWarnings;
  /** Joint MC scores recorded during sampling, keyed by `targetKey(target)`. */
  targetScores: Record<string, TargetScore>;
  /** Present only with `keepSamples`. */
  rawSamples?: PredictionSamples;
}

export type Requirement =
  | { kind: 'stat'; key: StatKey; min: number; passRate: number }
  | { kind: 'aptitude'; key: AptKey; min: Grade; passRate: number }
  | { kind: 'skill'; key: string; passRate: number };

export interface TargetScore {
  /** Share of samples meeting ALL requirements jointly (or the fast-pass product). */
  pMeet: number;
  /** Σ w_k E[max(0, stat_k − min_k)] + Σ optional weight × P(acquired). */
  surplus: number;
  /** The single requirement with the lowest marginal pass rate (first in requirement order on ties). */
  bottleneck: Requirement | null;
  requirements: Requirement[];
  method: 'monte-carlo' | 'gaussian';
  samples: number;
}

/** Canonical key of the scoring-relevant target fields. */
export function targetKey(t: CmTarget): string {
  const sortObj = (o: Record<string, unknown> | undefined) =>
    o
      ? Object.keys(o)
          .sort()
          .map((k) => [k, o[k]])
      : [];
  return JSON.stringify([
    sortObj(t.minStats),
    sortObj(t.minAptitudes),
    [...t.requiredSkills],
    t.optionalSkills.map((s) => [s.skillId, s.weight]),
    sortObj(t.statWeights),
  ]);
}

/**
 * The scoring-relevant part of a `CmTarget`, typed and validated (the shared schema types the
 * partial records loosely). Stat minima must be finite numbers, grades valid, weights finite.
 */
export interface NormalizedTarget {
  minStats: { key: StatKey; index: number; min: number; weight: number }[];
  minAptitudes: { key: AptKey; min: Grade; ordinal: number }[];
  requiredSkills: string[];
  optionalSkills: { skillId: string; weight: number }[];
}

export function normalizeTarget(t: CmTarget): NormalizedTarget {
  const stats = t.minStats as Partial<Record<StatKey, unknown>>;
  const apts = t.minAptitudes as Partial<Record<AptKey, unknown>>;
  const weights = (t.statWeights ?? {}) as Partial<Record<StatKey, unknown>>;
  const minStats: NormalizedTarget['minStats'] = [];
  STAT_KEYS.forEach((key, index) => {
    const min = stats[key];
    if (min === undefined) return;
    const w = weights[key] ?? 1;
    if (typeof min !== 'number' || !Number.isFinite(min)) {
      throw new ModelInputError('target', `minStats.${key} must be a finite number`);
    }
    if (typeof w !== 'number' || !Number.isFinite(w)) {
      throw new ModelInputError('target', `statWeights.${key} must be a finite number`);
    }
    minStats.push({ key, index, min, weight: w });
  });
  const minAptitudes: NormalizedTarget['minAptitudes'] = [];
  for (const key of APT_KEYS) {
    const min = apts[key];
    if (min === undefined) continue;
    const ordinal = GRADES.indexOf(min as Grade);
    if (ordinal < 0) throw new ModelInputError('target', `minAptitudes.${key} is not a grade`);
    minAptitudes.push({ key, min: min as Grade, ordinal });
  }
  for (const o of t.optionalSkills) {
    if (!Number.isFinite(o.weight)) {
      throw new ModelInputError('target', `optional skill ${o.skillId} weight must be finite`);
    }
  }
  return {
    minStats,
    minAptitudes,
    requiredSkills: [...t.requiredSkills],
    optionalSkills: t.optionalSkills.map((o) => ({ skillId: o.skillId, weight: o.weight })),
  };
}

// ---------------------------------------------------------------------------------------------
// Plan-level preparation (shared by predictChild and rankPairs).
// ---------------------------------------------------------------------------------------------

/** Everything about a plan that does not depend on the parent pair. */
export interface PlanContext {
  model: PreparedModel;
  input: PlanInput;
  traineeCharacterId: string;
  uniqueSkillId: string;
  statCap: number;
  /** x·β per stat. */
  trainingMean: number[];
  featureWarnings: FeatureWarnings;
  /** Deck hint/event ∪ innate skills (certain availability, Q-130), minus the unique skill. */
  sure: Set<string>;
}

export function preparePlan(
  ctx: EngineContext,
  model: PreparedModel,
  input: PlanInput,
): PlanContext {
  if (!Array.isArray(input.deck) || input.deck.length !== 6) {
    throw new ModelInputError('deck-size', `PlanInput.deck must have 6 slots`);
  }
  if (input.trainMode !== 'independent' && input.trainMode !== 'manual') {
    throw new ModelInputError('train-mode', String(input.trainMode));
  }
  const outfit = ctx.outfits.get(input.traineeOutfitId);
  if (!outfit) throw new UnknownIdError(`unknown trainee outfit ${input.traineeOutfitId}`);
  const plugin = ctx.scenarios.get(input.scenarioId);
  if (!plugin) throw new UnknownIdError(`unknown scenario ${input.scenarioId}`);
  const statCap = plugin.statCap(ctx);
  if (!(statCap >= 1) || !Number.isFinite(statCap)) {
    throw new ModelInputError('stat-cap', `${input.scenarioId} statCap ${statCap}`);
  }
  const { x, warnings } = featureVector(ctx, model.names, model.index, input);
  const full = new Float64Array(x.length + 1);
  full[0] = 1;
  full.set(x, 1);
  const trainingMean = model.beta.map((b) => dot(b, full));
  const sure = new Set(outfit.innateSkillIds);
  for (const d of input.deck) {
    const c = ctx.cards.get(d.cardId)!;
    for (const s of c.hintSkillIds) sure.add(s);
    for (const s of c.eventSkillIds) sure.add(s);
  }
  sure.delete(outfit.uniqueSkillId);
  return {
    model,
    input,
    traineeCharacterId: outfit.characterId,
    uniqueSkillId: outfit.uniqueSkillId,
    statCap,
    trainingMean,
    featureWarnings: warnings,
    sure,
  };
}

/** Closed-form availability and acquisition of one skill for a pair (50 §7 erratum). */
export function skillClosedForm(
  pc: PlanContext,
  exp: InheritanceResult,
  skillId: string,
): SkillPrediction {
  const guaranteed = pc.sure.has(skillId);
  const pHinted =
    skillId === pc.uniqueSkillId
      ? 0
      : guaranteed
        ? 1
        : Math.min(1, Math.max(0, exp.skillHintProb[skillId] ?? 0));
  const th = pc.model.theta(pc.input.trainMode, skillId);
  return {
    pHinted,
    guaranteed,
    theta: th.mean,
    thetaFromPrior: th.fromPrior,
    pAcquire: pHinted * th.mean,
    pAcquireMc: NaN,
  };
}

export function gaussianSummary(pc: PlanContext, exp: InheritanceResult): GaussianSummary {
  const cov: Matrix = pc.model.residualCov;
  return {
    mean: pc.trainingMean.map((m, k) => m + exp.expectedStatGain[k]!),
    variance: pc.trainingMean.map((_, k) => cov[k]![k]! + exp.statGainCov[k]![k]!),
    statCap: pc.statCap,
    aptitudeDist: exp.aptitudeDist,
  };
}

// ---------------------------------------------------------------------------------------------
// Monte Carlo.
// ---------------------------------------------------------------------------------------------

function validateSamples(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new ModelInputError('samples', `samples must be a positive integer, got ${n}`);
  }
  return n;
}

/** Draws the joint samples (50 §5). Exported for ranking; consumers use `predictChild`. */
export function simulate(
  pc: PlanContext,
  plan: InheritancePlan,
  samples: number,
  seed: string,
  skills: readonly string[],
): PredictionSamples {
  const inhRng = mulberry32(seedFromString(`${seed}:inh`));
  const trainRng = mulberry32(seedFromString(`${seed}:train`));
  const skillRng = mulberry32(seedFromString(`${seed}:skill`));
  const L = pc.model.factor;
  const mu = pc.trainingMean;
  const cap = pc.statCap;
  const perStat = () =>
    Object.fromEntries(STAT_KEYS.map((k) => [k, new Float64Array(samples)])) as Record<
      StatKey,
      Float64Array
    >;
  const stats = perStat();
  const training = perStat();
  const inheritance = perStat();
  const statArr = STAT_KEYS.map((k) => stats[k]);
  const trainArr = STAT_KEYS.map((k) => training[k]);
  const inhArr = STAT_KEYS.map((k) => inheritance[k]);
  const aptitudes = Object.fromEntries(APT_KEYS.map((k) => [k, new Uint8Array(samples)])) as Record<
    AptKey,
    Uint8Array
  >;
  const aptArr = APT_KEYS.map((k) => aptitudes[k]);
  const baseOrd = APT_KEYS.map((k) => GRADES.indexOf(plan.baseAptitudes[k]));
  const skillOut: Record<string, Uint8Array> = {};
  const skillList = [...new Set(skills)];
  const skillArr = skillList.map((s) => (skillOut[s] = new Uint8Array(samples)));
  const skillUniforms: Record<string, Float64Array> = {};
  const uArr = skillList.map((s) => (skillUniforms[s] = new Float64Array(samples)));
  const theta = skillList.map((s) => pc.model.theta(pc.input.trainMode, s).mean);
  const sure = skillList.map((s) => s !== pc.uniqueSkillId && pc.sure.has(s));
  const never = skillList.map((s) => s === pc.uniqueSkillId);
  const z = new Float64Array(5);
  for (let s = 0; s < samples; s++) {
    const inh = sampleInheritance(plan, inhRng);
    for (let k = 0; k < 5; k++) z[k] = boxMuller(trainRng);
    for (let k = 0; k < 5; k++) {
      const row = L[k]!;
      let t = mu[k]!;
      for (let j = 0; j < 5; j++) t += row[j]! * z[j]!;
      const g = inh.statGain[k]!;
      trainArr[k]![s] = t;
      inhArr[k]![s] = g;
      const v = t + g;
      statArr[k]![s] = v < 1 ? 1 : v > cap ? cap : v;
    }
    for (let a = 0; a < APT_KEYS.length; a++) {
      aptArr[a]![s] = Math.min(MAX_GRADE, baseOrd[a]! + inh.pinkGain[APT_KEYS[a]!]);
    }
    for (let i = 0; i < skillList.length; i++) {
      const u = skillRng(); // always consumed: skill stream independent of the other draws
      uArr[i]![s] = u;
      const hinted = !never[i] && (sure[i] || (inh.hints[skillList[i]!] ?? 0) > 0);
      skillArr[i]![s] = hinted && u < theta[i]! ? 1 : 0;
    }
  }
  return {
    n: samples,
    stats,
    training,
    inheritance,
    aptitudes,
    skills: skillOut,
    skillUniforms,
  };
}

function summarize(x: Float64Array, cap: number): StatSummary {
  const n = x.length;
  let sum = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    sum += x[i]!;
    if (x[i] === 1) lo++;
    if (x[i] === cap) hi++;
  }
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (x[i]! - mean) ** 2;
  const sorted = Float64Array.from(x).sort();
  return {
    mean,
    p10: quantileSorted(sorted, 0.1),
    p50: quantileSorted(sorted, 0.5),
    p90: quantileSorted(sorted, 0.9),
    sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
    clippedLow: lo / n,
    clippedHigh: hi / n,
  };
}

/** 50 §6 from joint samples. */
export function scoreSamples(samples: PredictionSamples, target: CmTarget): TargetScore {
  const t = normalizeTarget(target);
  const n = samples.n;
  const ok = new Uint8Array(n).fill(1);
  const requirements: Requirement[] = [];
  for (const { key, min } of t.minStats) {
    const xs = samples.stats[key];
    let pass = 0;
    for (let s = 0; s < n; s++) {
      if (xs[s]! >= min) pass++;
      else ok[s] = 0;
    }
    requirements.push({ kind: 'stat', key, min, passRate: pass / n });
  }
  for (const { key, min, ordinal } of t.minAptitudes) {
    const g = samples.aptitudes[key];
    let pass = 0;
    for (let s = 0; s < n; s++) {
      if (g[s]! >= ordinal) pass++;
      else ok[s] = 0;
    }
    requirements.push({ kind: 'aptitude', key, min, passRate: pass / n });
  }
  for (const sk of t.requiredSkills) {
    const acq = samples.skills[sk];
    if (!acq) throw new ScoreRequiresSamplesError(`required skill ${sk} was not simulated`);
    let pass = 0;
    for (let s = 0; s < n; s++) {
      if (acq[s]) pass++;
      else ok[s] = 0;
    }
    requirements.push({ kind: 'skill', key: sk, passRate: pass / n });
  }
  let meet = 0;
  for (let s = 0; s < n; s++) meet += ok[s]!;
  let surplus = 0;
  for (const { key, min, weight } of t.minStats) {
    const xs = samples.stats[key];
    let ex = 0;
    for (let s = 0; s < n; s++) ex += Math.max(0, xs[s]! - min);
    surplus += (weight * ex) / n;
  }
  for (const o of t.optionalSkills) {
    const acq = samples.skills[o.skillId];
    if (!acq) throw new ScoreRequiresSamplesError(`optional skill ${o.skillId} was not simulated`);
    let c = 0;
    for (let s = 0; s < n; s++) c += acq[s]!;
    surplus += (o.weight * c) / n;
  }
  return {
    pMeet: meet / n,
    surplus,
    bottleneck: pickBottleneck(requirements),
    requirements,
    method: 'monte-carlo',
    samples: n,
  };
}

function pickBottleneck(reqs: readonly Requirement[]): Requirement | null {
  let best: Requirement | null = null;
  for (const r of reqs) if (!best || r.passRate < best.passRate) best = r;
  return best;
}

/** Skills a target needs simulated. */
export const targetSkills = (t: CmTarget): string[] => [
  ...t.requiredSkills,
  ...t.optionalSkills.map((o) => o.skillId),
];

/** Builds a `ChildPrediction` for an already-planned pair. */
export function predictPlanned(
  pc: PlanContext,
  plan: InheritancePlan,
  exp: InheritanceResult,
  opts: PredictOptions,
): ChildPrediction {
  const n = validateSamples(opts.samples ?? DEFAULT_SAMPLES);
  const seed = String(opts.seed);
  const skillIds = [
    ...new Set([
      ...(opts.skills ??
        (opts.target
          ? []
          : [...pc.sure, ...Object.keys(exp.skillHintProb)].filter((s) => s !== pc.uniqueSkillId))),
      ...(opts.target ? targetSkills(opts.target) : []),
    ]),
  ].sort();
  const raw = simulate(pc, plan, n, seed, skillIds);
  const stats = Object.fromEntries(
    STAT_KEYS.map((k) => [k, summarize(raw.stats[k], pc.statCap)]),
  ) as Record<StatKey, StatSummary>;
  const aptitudes = {} as Record<AptKey, Record<Grade, number>>;
  for (const a of APT_KEYS) {
    const counts = new Array<number>(GRADES.length).fill(0);
    const g = raw.aptitudes[a];
    for (let s = 0; s < n; s++) counts[g[s]!]!++;
    aptitudes[a] = Object.fromEntries(GRADES.map((gr, i) => [gr, counts[i]! / n])) as Record<
      Grade,
      number
    >;
  }
  const skills: Record<string, SkillPrediction> = {};
  for (const s of skillIds) {
    const cf = skillClosedForm(pc, exp, s);
    let c = 0;
    const acq = raw.skills[s]!;
    for (let i = 0; i < n; i++) c += acq[i]!;
    skills[s] = { ...cf, pAcquireMc: c / n };
  }
  const targetScores: Record<string, TargetScore> = {};
  if (opts.target) targetScores[targetKey(opts.target)] = scoreSamples(raw, opts.target);
  const pred: ChildPrediction = {
    modelId: pc.model.snapshot.id,
    seed,
    samples: n,
    statCap: pc.statCap,
    trainingMean: [...pc.trainingMean],
    stats,
    aptitudes,
    skills,
    gaussian: gaussianSummary(pc, exp),
    affinity: exp.affinity,
    contributions: exp.contributions,
    provenance: exp.provenance,
    featureWarnings: pc.featureWarnings,
    targetScores,
  };
  if (opts.keepSamples) pred.rawSamples = raw;
  return pred;
}

/**
 * 50 §1/§5 `predictChild(ctx, model, input, pair, opts)`. `model` must be a `training-v2`
 * snapshot fitted on `ctx.masterVersion` (else `RefitRequiredError`). The pair is two roster
 * veterans; their own recorded parents are the grandparents (T05 `legacyFromVeteran`).
 */
export function predictChild(
  ctx: EngineContext,
  model: unknown,
  input: PlanInput,
  pair: readonly [Veteran, Veteran],
  opts: PredictOptions,
): ChildPrediction {
  const prepared = prepareModel(ctx, model);
  const pc = preparePlan(ctx, prepared, input);
  const plan = planInheritance(
    ctx,
    input.traineeOutfitId,
    [legacyFromVeteran(pair[0]), legacyFromVeteran(pair[1])],
    input.scenarioId,
  );
  return predictPlanned(pc, plan, expectationFromPlan(plan), opts);
}

/**
 * 50 §6 `scoreTarget(pred, target)`. Computes the JOINT share of samples meeting every
 * requirement from the kept samples, or returns the joint score recorded for this exact target
 * during sampling (`PredictOptions.target`). Never substitutes a product of marginals: without
 * either, it throws `ScoreRequiresSamplesError`.
 */
export function scoreTarget(pred: ChildPrediction, target: CmTarget): TargetScore {
  if (pred.rawSamples) return scoreSamples(pred.rawSamples, target);
  const rec = pred.targetScores[targetKey(target)];
  if (rec) return rec;
  throw new ScoreRequiresSamplesError(
    'scoreTarget needs joint samples: predict with keepSamples, or pass this target in PredictOptions.target',
  );
}

/**
 * 50 §7.2 fast-pass score (no sampling): independent requirement groups multiplied, with exact
 * T05 aptitude distributions, Gaussian stats N(μ_train + E[inh], Σ_N,kk + Var[inh_k]) clipped to
 * [1, statCap], and P(acquire) = P(hinted)·E[θ] for skills.
 */
export function gaussianScore(
  pc: PlanContext,
  exp: InheritanceResult,
  target: CmTarget | NormalizedTarget,
): TargetScore {
  const t = 'id' in target ? normalizeTarget(target) : target;
  const g = gaussianSummary(pc, exp);
  const requirements: Requirement[] = [];
  let p = 1;
  let surplus = 0;
  for (const { key, index, min, weight } of t.minStats) {
    const sd = Math.sqrt(g.variance[index]!);
    const mu = g.mean[index]!;
    let pass: number;
    if (min <= 1) pass = 1;
    else if (min > g.statCap) pass = 0;
    else pass = sd > 0 ? upperTail((min - mu) / sd) : mu >= min ? 1 : 0;
    requirements.push({ kind: 'stat', key, min, passRate: pass });
    p *= pass;
    // E[max(0, clip(X) − m)] = E[(X − m)+] − E[(X − cap)+] for 1 ≤ m ≤ cap.
    const m = Math.max(1, min);
    const ex = m >= g.statCap ? 0 : expectedExcess(mu, sd, m) - expectedExcess(mu, sd, g.statCap);
    surplus += weight * Math.max(0, ex);
  }
  for (const { key, min, ordinal } of t.minAptitudes) {
    let pass = 0;
    GRADES.forEach((gr, i) => {
      if (i >= ordinal) pass += g.aptitudeDist[key][gr];
    });
    pass = Math.min(1, pass);
    requirements.push({ kind: 'aptitude', key, min, passRate: pass });
    p *= pass;
  }
  for (const s of t.requiredSkills) {
    const pass = skillClosedForm(pc, exp, s).pAcquire;
    requirements.push({ kind: 'skill', key: s, passRate: pass });
    p *= pass;
  }
  for (const o of t.optionalSkills) {
    surplus += o.weight * skillClosedForm(pc, exp, o.skillId).pAcquire;
  }
  return {
    pMeet: p,
    surplus,
    bottleneck: pickBottleneck(requirements),
    requirements,
    method: 'gaussian',
    samples: 0,
  };
}
