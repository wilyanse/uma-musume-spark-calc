/**
 * 50 §4 `fitTrainingModel` with the ADR-0002 errata: training rows, recorded-lineage residuals,
 * features, recency weights, two-group ridge with 5-fold CV, the non-inheritance covariance Σ_N,
 * the exposure-aware skill posteriors and an untouched holdout used only for evaluation.
 * Emits `training-v2` snapshots only.
 */
import { ModelSnapshot, STAT_KEYS } from '@uma/schema';
import type { StatKey, TrainMode } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import { expectationFromPlan, planInheritance } from '../inheritance/inheritance.ts';
import type { InheritanceResult } from '../inheritance/inheritance.ts';
import { IllegalPairError, UnknownIdError } from '../inheritance/legality.ts';
import type { Matrix } from '../linalg.ts';
import { mulberry32, seedFromString } from '../rng.ts';
import type { Veteran } from '../types.ts';
import { estimateNonInheritanceCov, gaussianCoverage, holdoutBias } from './covariance.ts';
import type { CovarianceDiagnostics, Coverage, HoldoutBias, HoldoutCell } from './covariance.ts';
import { InsufficientDataError, ModelInputError } from './errors.ts';
import { featureNames, featureVector, isCardIdFeature } from './features.ts';
import type { FeaturePlan } from './features.ts';
import { recordedParent } from './lineage.ts';
import type { ParentKind } from './lineage.ts';
import { CV_FOLDS, dot, fitRidge } from './ridge.ts';
import type { DesignRow, LambdaChoice } from './ridge.ts';
import { fitGlobalPrior, skillPosterior } from './skills.ts';
import type { BetaParams, Exposure, PriorFit, SkillPosterior } from './skills.ts';
import { newUlid } from './ulid.ts';

export const MODEL_KIND = 'training-v2' as const;
export const MIN_CONFIDENCE = 0.9;
export const RECENCY_HALF_LIFE_DAYS = 60;
export const HOLDOUT_FRACTION = 0.2;
export const DEFAULT_SPLIT_SEED = 't06-holdout';
export const DEFAULT_CV_SEED = 't06-cv';
const TRAIN_MODES: readonly TrainMode[] = ['independent', 'manual'];
const DAY_MS = 86_400_000;

/** Optional `fitTrainingModel` inputs (50 §1 `FitOptions`). Every source of variation is injected. */
export interface FitOptions {
  /**
   * An explicit train/holdout split (e.g. the stored golden split). Every id must be an eligible
   * row; the lists must be disjoint and both non-empty. Eligible rows in neither list are unused.
   */
  split?: { trainIds: readonly string[]; holdoutIds: readonly string[] };
  /** Seed of the default split (eligible ids sorted, Fisher–Yates, first ceil(20%) = holdout). */
  splitSeed?: string | number;
  /** Seed of the 5-fold CV partition (also the OOF folds, ADR-0002 §2.3). */
  cvSeed?: string;
  /** Snapshot id source (a ULID). Default: a random ULID from `crypto.getRandomValues`. */
  id?: () => string;
  /** Clock for `trainedAt` and the default ULID time. Default: `new Date()`. */
  now?: () => Date;
}

export type ExclusionReason =
  | 'low-confidence'
  | 'unknown-scenario'
  | 'unknown-outfit'
  | 'unknown-card'
  | 'deck-size'
  | 'parent-missing'
  | 'parent-sparks-unread'
  | 'illegal-lineage'
  | 'bad-date'
  | 'non-finite-stat';

export interface RowLineage {
  id: string;
  eligible: boolean;
  reason?: ExclusionReason;
  detail?: string;
  role?: 'train' | 'holdout' | 'unused';
  parents?: [ParentKind, ParentKind];
}

export interface SkillDiagnostics {
  prior: Record<TrainMode, PriorFit>;
  cells: { total: number; guaranteed: number; lineageOnly: number; lineageOnlyMeanQ: number };
  /** (mode, skill) -> number of q = 0 acquisitions excluded from the likelihood (Q-131). */
  contradictions: { mode: TrainMode; skillId: string; count: number }[];
  /** Posterior method counts per mode. */
  methods: Record<TrainMode, Record<SkillPosterior['method'], number>>;
  maxQuadratureRelErr: number;
  /** Q-130/Q-131 assumptions in force (kept visible on every fit). */
  assumptions: string[];
}

/** Everything the snapshot shape (01 §13) has no room for. Not stored by the API. */
export interface FitReport {
  kind: typeof MODEL_KIND;
  rows: RowLineage[];
  trainIds: string[];
  holdoutIds: string[];
  splitSource: 'explicit' | 'seeded';
  splitSeed: string | null;
  cvSeed: string;
  /** Newest train dateAcquired (the recency clock). */
  recencyClock: string;
  lambdas: Record<StatKey, { lambdaId: number; lambdaBase: number; grid: Record<string, number> }>;
  covariance: CovarianceDiagnostics;
  /** Factor L = V diag(√λ') of residualCov (for sampling; recomputed at prediction). */
  covarianceFactor: Matrix;
  holdout: {
    mae: Record<StatKey, number>;
    coverage: Coverage;
    coverageWithoutInheritance: Coverage;
    bias: HoldoutBias;
  };
  skills: SkillDiagnostics;
  warnings: string[];
}

export interface TrainingFit {
  snapshot: ModelSnapshot;
  report: FitReport;
}

interface PreparedRow {
  v: Veteran;
  plan: FeaturePlan;
  exp: InheritanceResult;
  y: number[];
  time: number;
  parents: [ParentKind, ParentKind];
}

function prepareRow(
  ctx: EngineContext,
  v: Veteran,
  byId: ReadonlyMap<string, Veteran>,
): { row: PreparedRow } | { reason: ExclusionReason; detail: string } {
  if (!(v.minConfidence >= MIN_CONFIDENCE)) {
    return { reason: 'low-confidence', detail: `minConfidence ${v.minConfidence}` };
  }
  if (!v.scenarioId || !ctx.scenarios.has(v.scenarioId)) {
    return { reason: 'unknown-scenario', detail: String(v.scenarioId) };
  }
  if (!ctx.outfits.has(v.outfitId)) return { reason: 'unknown-outfit', detail: v.outfitId };
  if (v.deck.length !== 6) return { reason: 'deck-size', detail: `${v.deck.length} slots` };
  for (const d of v.deck) {
    if (!ctx.cards.has(d.cardId)) return { reason: 'unknown-card', detail: d.cardId };
  }
  const p1 = recordedParent(v, 1, byId);
  const p2 = recordedParent(v, 2, byId);
  if (!p1 || !p2) return { reason: 'parent-missing', detail: 'parent slot missing' };
  for (const [slot, p] of [
    [1, p1],
    [2, p2],
  ] as const) {
    // A non-matched parent whose spark block is empty was not read: its lineage is unknown.
    if (p.kind !== 'matched' && p.recordedSparks === 0) {
      return { reason: 'parent-sparks-unread', detail: `parent${slot} has no recorded sparks` };
    }
  }
  const time = Date.parse(`${v.career.dateAcquired}T00:00:00Z`);
  if (!Number.isFinite(time)) return { reason: 'bad-date', detail: v.career.dateAcquired };
  let exp: InheritanceResult;
  try {
    exp = expectationFromPlan(
      planInheritance(ctx, v.outfitId, [p1.legacy, p2.legacy], v.scenarioId),
    );
  } catch (e) {
    if (e instanceof IllegalPairError || e instanceof UnknownIdError) {
      return { reason: 'illegal-lineage', detail: e.message };
    }
    throw e;
  }
  const y = STAT_KEYS.map((k, i) => v.stats[k] - exp.expectedStatGain[i]!);
  if (!y.every(Number.isFinite)) return { reason: 'non-finite-stat', detail: 'residual' };
  return {
    row: {
      v,
      plan: {
        traineeOutfitId: v.outfitId,
        deck: v.deck,
        trainMode: v.trainMode,
        scenarioId: v.scenarioId,
      },
      exp,
      y,
      time,
      parents: [p1.kind, p2.kind],
    },
  };
}

function seededSplit(ids: readonly string[], seed: string | number) {
  const sorted = [...ids].sort();
  const rng = mulberry32(typeof seed === 'number' ? seed : seedFromString(seed));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
  }
  const nHold = Math.ceil(HOLDOUT_FRACTION * sorted.length);
  return {
    holdoutIds: sorted.slice(0, nHold).sort(),
    trainIds: sorted.slice(nHold).sort(),
  };
}

/** Recency weights 0.5^(age/60) with the clock at `clock` (ms). */
const recency = (time: number, clock: number) =>
  0.5 ** ((clock - time) / DAY_MS / RECENCY_HALF_LIFE_DAYS);

/** Skill candidate cells of one row (ADR-0002 §3), sorted by skill id. */
export function skillCellsOf(
  ctx: EngineContext,
  v: Veteran,
  exp: InheritanceResult,
): { skillId: string; q: number; sure: boolean; y: 0 | 1 }[] {
  const outfit = ctx.outfits.get(v.outfitId)!;
  const sure = new Set(outfit.innateSkillIds);
  for (const d of v.deck) {
    const c = ctx.cards.get(d.cardId)!;
    for (const s of c.hintSkillIds) sure.add(s);
    for (const s of c.eventSkillIds) sure.add(s);
  }
  const cand = new Set([...sure, ...Object.keys(exp.skillHintProb)]);
  cand.delete(outfit.uniqueSkillId);
  const acquired = new Set(
    v.skills.filter((s) => s.skillId !== outfit.uniqueSkillId).map((s) => s.skillId),
  );
  const out: { skillId: string; q: number; sure: boolean; y: 0 | 1 }[] = [];
  for (const s of [...cand].sort()) {
    const isSure = sure.has(s);
    out.push({
      skillId: s,
      q: isSure ? 1 : Math.min(1, Math.max(0, exp.skillHintProb[s] ?? 0)),
      sure: isSure,
      y: acquired.has(s) ? 1 : 0,
    });
  }
  for (const s of [...acquired].sort()) {
    if (!cand.has(s)) out.push({ skillId: s, q: 0, sure: false, y: 1 });
  }
  return out;
}

/** 50 §4 fit plus the report of everything the snapshot cannot hold. */
export function fitTrainingModelDetailed(
  ctx: EngineContext,
  roster: readonly Veteran[],
  opts: FitOptions = {},
): TrainingFit {
  const byId = new Map<string, Veteran>();
  for (const v of roster) {
    if (byId.has(v.id)) throw new ModelInputError('duplicate-id', v.id);
    byId.set(v.id, v);
  }
  const lineage = new Map<string, RowLineage>();
  const prepared = new Map<string, PreparedRow>();
  for (const v of [...roster].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const r = prepareRow(ctx, v, byId);
    if ('row' in r) {
      prepared.set(v.id, r.row);
      lineage.set(v.id, { id: v.id, eligible: true, role: 'unused', parents: r.row.parents });
    } else {
      lineage.set(v.id, { id: v.id, eligible: false, reason: r.reason, detail: r.detail });
    }
  }
  const eligibleIds = [...prepared.keys()];

  // Split.
  let trainIds: string[];
  let holdoutIds: string[];
  let splitSeed: string | null = null;
  if (opts.split) {
    trainIds = [...opts.split.trainIds].sort();
    holdoutIds = [...opts.split.holdoutIds].sort();
    const seen = new Set<string>();
    for (const id of [...trainIds, ...holdoutIds]) {
      if (seen.has(id)) throw new ModelInputError('split-overlap', id);
      seen.add(id);
      if (!prepared.has(id)) {
        const l = lineage.get(id);
        throw new ModelInputError(
          'split-ineligible',
          `${id} is ${l ? `ineligible (${l.reason})` : 'not in the roster'}`,
        );
      }
    }
  } else {
    splitSeed = String(opts.splitSeed ?? DEFAULT_SPLIT_SEED);
    ({ trainIds, holdoutIds } = seededSplit(eligibleIds, opts.splitSeed ?? DEFAULT_SPLIT_SEED));
  }
  if (trainIds.length < CV_FOLDS || holdoutIds.length < 1) {
    throw new InsufficientDataError(
      eligibleIds.length,
      trainIds.length,
      holdoutIds.length,
      `need ≥ ${CV_FOLDS} train rows (5-fold CV) and ≥ 1 holdout row`,
    );
  }
  for (const id of trainIds) lineage.get(id)!.role = 'train';
  for (const id of holdoutIds) lineage.get(id)!.role = 'holdout';
  const train = trainIds.map((id) => prepared.get(id)!);
  const hold = holdoutIds.map((id) => prepared.get(id)!);

  // Design (columns from TRAIN rows only).
  const names = featureNames(
    ctx,
    train.map((r) => r.plan),
  );
  const index = new Map(names.map((n, i) => [n, i]));
  const toDesign = (r: PreparedRow): DesignRow => {
    const { x } = featureVector(ctx, names, index, r.plan);
    const full = new Float64Array(names.length + 1);
    full[0] = 1;
    full.set(x, 1);
    return { id: r.v.id, x: full, y: r.y };
  };
  const trainRows = train.map(toDesign);
  const holdRows = hold.map(toDesign);
  const isId = [false, ...names.map(isCardIdFeature)];

  // Recency weights, clock = newest TRAIN row (holdout never enters the clock).
  const clock = Math.max(...train.map((r) => r.time));
  const w = train.map((r) => recency(r.time, clock));
  const cvSeed = opts.cvSeed ?? DEFAULT_CV_SEED;
  const ridge = fitRidge(trainRows, w, isId, cvSeed);

  // Σ_N from OOF train residuals (ADR-0002 §2).
  const cov = estimateNonInheritanceCov(
    train.map((r, i) => ({ id: r.v.id, w: w[i]!, e: ridge.oof[i]!, inhCov: r.exp.statGainCov })),
  );

  // Holdout: evaluation only.
  const holdClock = Math.max(...hold.map((r) => r.time));
  const cells: HoldoutCell[] = hold.map((r, i) => ({
    id: r.v.id,
    e: ridge.beta.map((b, k) => holdRows[i]!.y[k]! - dot(b, holdRows[i]!.x)),
    inhCov: r.exp.statGainCov,
    w: recency(r.time, holdClock),
  }));
  const mae = Object.fromEntries(
    STAT_KEYS.map((k, s) => [k, cells.reduce((a, c) => a + Math.abs(c.e[s]!), 0) / cells.length]),
  ) as Record<StatKey, number>;
  const coverage = gaussianCoverage(cov.residualCov, cells);

  // Skills (ADR-0002 §3), train rows only.
  const perMode = new Map<TrainMode, Map<string, Exposure[]>>(
    TRAIN_MODES.map((m) => [m, new Map()]),
  );
  let total = 0;
  let guaranteed = 0;
  let lineageOnly = 0;
  let lineageQ = 0;
  for (const r of train) {
    const m = perMode.get(r.v.trainMode)!;
    for (const c of skillCellsOf(ctx, r.v, r.exp)) {
      total++;
      if (c.sure) guaranteed++;
      else if (c.q > 0) {
        lineageOnly++;
        lineageQ += c.q;
      }
      let list = m.get(c.skillId);
      if (!list) m.set(c.skillId, (list = []));
      list.push({ q: c.q, y: c.y });
    }
  }
  const skillAcquire = {} as Record<TrainMode, Record<string, BetaParams>>;
  const priorFits = {} as Record<TrainMode, PriorFit>;
  const methods = {} as SkillDiagnostics['methods'];
  const contradictions: SkillDiagnostics['contradictions'] = [];
  let maxRelErr = 0;
  for (const mode of TRAIN_MODES) {
    const m = perMode.get(mode)!;
    const pf = fitGlobalPrior(m);
    priorFits[mode] = pf;
    const entries: Record<string, BetaParams> = { '*': pf.prior };
    methods[mode] = { prior: 0, conjugate: 0, quadrature: 0 };
    for (const skillId of [...m.keys()].sort()) {
      const post = skillPosterior(pf.prior, m.get(skillId)!);
      if (post.contradictions > 0) {
        contradictions.push({ mode, skillId, count: post.contradictions });
      }
      if (post.used === 0) continue; // no opportunity in this mode: falls back to '*'
      methods[mode][post.method]++;
      maxRelErr = Math.max(maxRelErr, post.quadratureRelErr);
      entries[skillId] = post.beta;
    }
    skillAcquire[mode] = entries;
  }

  const now = (opts.now ?? (() => new Date()))();
  const snapshot = ModelSnapshot.parse({
    id: (opts.id ?? (() => newUlid(now.getTime())))(),
    kind: MODEL_KIND,
    masterVersion: ctx.masterVersion,
    trainedAt: now.toISOString(),
    nSamples: train.length,
    params: {
      features: names,
      perStat: Object.fromEntries(
        STAT_KEYS.map((k, s) => [
          k,
          {
            coef: [...ridge.beta[s]!.subarray(1)],
            intercept: ridge.beta[s]![0]!,
            sigma: cov.sigma[s]!,
          },
        ]),
      ),
      residualCov: cov.residualCov,
      skillAcquire,
      holdout: { mae, coverage80: coverage.pooled },
    },
  });

  const warnings = [...cov.diagnostics.warnings];
  if (contradictions.length) {
    warnings.push(
      `${contradictions.reduce((s, c) => s + c.count, 0)} acquired skill cell(s) with no observable source were excluded (Q-131)`,
    );
  }
  const report: FitReport = {
    kind: MODEL_KIND,
    rows: [...lineage.values()],
    trainIds,
    holdoutIds,
    splitSource: opts.split ? 'explicit' : 'seeded',
    splitSeed,
    cvSeed,
    recencyClock: new Date(clock).toISOString().slice(0, 10),
    lambdas: Object.fromEntries(
      STAT_KEYS.map((k, s) => {
        const c: LambdaChoice = ridge.lambdas[s]!;
        return [k, { lambdaId: c.lambdaId, lambdaBase: c.lambdaBase, grid: { ...c.grid } }];
      }),
    ) as FitReport['lambdas'],
    covariance: cov.diagnostics,
    covarianceFactor: cov.factor,
    holdout: {
      mae,
      coverage,
      coverageWithoutInheritance: gaussianCoverage(cov.residualCov, cells, false),
      bias: holdoutBias(cells),
    },
    skills: {
      prior: priorFits,
      cells: {
        total,
        guaranteed,
        lineageOnly,
        lineageOnlyMeanQ: lineageOnly ? lineageQ / lineageOnly : 0,
      },
      contradictions,
      methods,
      maxQuadratureRelErr: maxRelErr,
      assumptions: [
        'Q-130: deck hint/event and innate skills count as certainly available (q = 1); unverified game mechanic.',
        'Q-131: acquired skills with no observable source (q = 0) are excluded from the likelihood and counted, never treated as observed hints.',
        'Lineage sparks are potential hints only: q = closed-form skillHintProb on the recorded lineage; activation is never observed.',
      ],
    },
    warnings,
  };
  if (cells.length < 10) warnings.push(`only ${cells.length} holdout rows: coverage is noisy`);
  return { snapshot, report };
}

/** 50 §1 `fitTrainingModel(ctx, roster, opts?)`: a `training-v2` snapshot. */
export function fitTrainingModel(
  ctx: EngineContext,
  roster: readonly Veteran[],
  opts: FitOptions = {},
): ModelSnapshot {
  return fitTrainingModelDetailed(ctx, roster, opts).snapshot;
}

/**
 * Q-122 estimand: a card's effective contribution per unit of (1 + lb/4) for one stat,
 * β_id[card] + β_type[type(card)]. A card unseen in training contributes β_type only.
 */
export function effectiveCardEffect(
  ctx: EngineContext,
  snapshot: ModelSnapshot,
  cardId: string,
  stat: StatKey,
): number {
  const card = ctx.cards.get(cardId);
  if (!card) throw new ModelInputError('unknown-card', cardId);
  const names = snapshot.params.features;
  const coef = snapshot.params.perStat[stat].coef;
  const id = names.indexOf(`card:${cardId}`);
  const t = names.indexOf(`type:${card.type}`);
  return (id >= 0 ? coef[id]! : 0) + (t >= 0 ? coef[t]! : 0);
}
