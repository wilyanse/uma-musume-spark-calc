/**
 * 50 §8 `calibrateRules(ctx, roster)` (T15). Engine-local `CalibrationReport` (01 has no shared
 * calibration contract; the report never crosses the API). Pure and deterministic: no DOM,
 * network or disk; the split, CV and bootstrap seeds, the clock, the report id and the timer are
 * injectable.
 *
 * Population (50 §8): veterans eligible for the training model (T06 `prepareRow`) whose two
 * recorded parents are each a matched roster veteran or a guest. Every other row is excluded with
 * a reason and counted.
 *
 * Checks:
 * 1. Aptitude: observed grades against the predicted `aptitudeDist` (current rules), on every
 *    used row: log-likelihood, impossible-cell counts and reliability tables. Diagnostics only.
 * 2. Stats: for each multiplier m on a fixed grid, y_m = stat − E[inh | recorded lineage,
 *    blueStatGain × m]; the 50 §4 design, recency weights and per-stat λ re-selected by 5-fold CV
 *    on TRAIN rows only; holdout MAE (Σ over stats) is the 50 §8 selection criterion. The train
 *    5-fold CV MAE gives a second selection that never sees the holdout; its holdout MAE is the
 *    unbiased evaluation. E[inh] is affine in m (blueStatGain only scales event stat gains), so
 *    y_m = stat − (E₀ + m·(E₁ − E₀)) is exact; candidate refits cross-check it.
 * 3. Skills: for each candidate rules context (current, suggested) the model is refitted with
 *    `fitTrainingModelDetailed` (ADR-0002 §2.11) and holdout skills are scored against
 *    q·E[θ] with availability counted once (ADR-0002 §3).
 *
 * Nothing is applied: suggestions are values for the user to apply from S07, then refit.
 */
import { STAT_KEYS } from '@uma/schema';
import type { StatKey } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import { expectationFromPlan, planInheritance } from '../inheritance/inheritance.ts';
import { mulberry32, seedFromString } from '../rng.ts';
import type { Veteran } from '../types.ts';
import { ModelInputError } from '../model/errors.ts';
import { featureNames, featureVector, isCardIdFeature } from '../model/features.ts';
import {
  DEFAULT_CV_SEED,
  fitTrainingModelDetailed,
  prepareRow,
  recency,
  seededSplit,
} from '../model/fit.ts';
import type { ExclusionReason, PreparedRow } from '../model/fit.ts';
import { recordedParent } from '../model/lineage.ts';
import type { ParentKind } from '../model/lineage.ts';
import { CV_FOLDS, dot, fitRidge } from '../model/ridge.ts';
import type { DesignRow } from '../model/ridge.ts';
import { newUlid } from '../model/ulid.ts';
import { aptitudeCheck } from './aptitude.ts';
import type { AptitudeCheck } from './aptitude.ts';
import { withBlueStatGainMultiplier } from './context.ts';
import {
  buildGrid,
  DEFAULT_CALIBRATION_GRID,
  fingerprint,
  percentile,
  selectArgmin,
  validateGrid,
} from './grid.ts';
import type { GridSpec } from './grid.ts';
import { skillHoldoutCheck } from './skills.ts';
import type { SkillHoldoutCheck } from './skills.ts';

export const CALIBRATION_KIND = 'calibration-v1' as const;
export const DEFAULT_CALIBRATION_SPLIT_SEED = 't15-holdout';
export const DEFAULT_BOOTSTRAP = 200;
export const DEFAULT_BOOTSTRAP_SEED = 't15-bootstrap';
export const MAX_BOOTSTRAP = 100_000;
/** Candidate refits whose holdout MAE differs from the grid by more than this raise a warning. */
export const FAST_PATH_TOL = 1e-6;

export interface CalibrationOptions {
  /**
   * Explicit train/holdout ids. Unknown ids and overlaps throw `ModelInputError`; ids outside the
   * 50 §8 population are dropped and listed in `split.dropped`.
   */
  split?: { trainIds: readonly string[]; holdoutIds: readonly string[] };
  /** Seed of the default 80/20 split over the 50 §8 population. */
  splitSeed?: string;
  /** Seed of the 5-fold CV partition (λ selection, OOF, train-CV criterion). Default T06's. */
  cvSeed?: string;
  /** blueStatGain multiplier grid, relative to the context's current table. */
  grid?: GridSpec;
  /** Holdout bootstrap resamples of the argmin (0 disables). Integer in [0, 100000]. */
  bootstrap?: number;
  bootstrapSeed?: string;
  /** Clock for `generatedAt` and the candidate snapshots. Default `new Date()`. */
  now?: () => Date;
  /** Report id (and candidate snapshot id) source. Default a ULID. */
  id?: () => string;
  /**
   * Millisecond timer for `runtime` (measurement only, never an input to any result). Default
   * `performance.now`, or a constant 0 where `performance` is absent. Inject a constant for tests.
   */
  timer?: () => number;
}

export type CalibrationExclusion = ExclusionReason | 'parent-not-matched-or-guest';

export interface PopulationRow {
  id: string;
  included: boolean;
  reason?: CalibrationExclusion;
  detail?: string;
  parents?: [ParentKind, ParentKind];
  role?: 'train' | 'holdout' | 'unused';
}

export interface GridPoint {
  multiplier: number;
  /** Σ over stats of the unweighted holdout MAE (50 §8 criterion; T06 `holdout.mae`). */
  holdoutMae: number;
  perStat: number[];
  /** Σ over stats of the recency-weighted train 5-fold OOF MAE (never sees the holdout). */
  trainCvMae: number;
  /** [λ_id, λ_base] per stat, re-selected by train CV at this multiplier. */
  lambdas: [number, number][];
}

export interface Selection {
  multiplier: number;
  holdoutMae: number;
  trainCvMae: number;
  atBoundary: boolean;
}

export interface StatCheck {
  status: 'suggested' | 'boundary' | 'nonidentifiable' | 'insufficient-data';
  insufficient?: string;
  nonidentifiable?: { reasons: string[] };
  /** The context's current table (the multiplier is relative to it). */
  currentBlueStatGain: [number, number, number];
  gridSpec: GridSpec;
  grid: GridPoint[];
  /** Grid point at m = 1 (current rules); computed even when 1 is off the grid. */
  current: GridPoint | null;
  /** 50 §8: argmin of holdout MAE (selection on the holdout). */
  selected: Selection | null;
  /** Argmin of train CV MAE (holdout unused for selection). */
  trainCvSelected: Selection | null;
  evaluation: {
    selectionSet: 'holdout';
    /** The selected multiplier's holdout MAE is post-selection (optimistic), not independent proof. */
    selectedHoldoutMaeIsPostSelection: true;
    /** Holdout MAE of the train-CV selection: the holdout was not used to choose it. */
    unbiasedHoldoutMae: number | null;
    /** Holdout MAE at m = 1 for comparison. */
    currentHoldoutMae: number | null;
    note: string;
  };
  /** Holdout-row bootstrap of the holdout-MAE argmin (holdout sampling only; train fixed). */
  bootstrap: {
    resamples: number;
    seed: string;
    p05: number;
    p50: number;
    p95: number;
    atBoundaryShare: number;
    containsCurrent: boolean;
  } | null;
  /** The same design and λ procedure on y = stat (no inheritance term). */
  withoutInheritance: { holdoutMae: number; perStat: number[]; trainCvMae: number } | null;
}

export interface CandidateFit {
  holdoutMae: number;
  perStat: Record<StatKey, number>;
  coverage80: number;
  coverageWithoutInheritance: number;
  lambdas: [number, number][];
  sigma: number[];
  covarianceWarnings: string[];
  /** Fingerprint of the train-fitted parameters (β, Σ_N, θ). Not a security hash. */
  trainFingerprint: string;
}

export interface Candidate {
  multiplier: number;
  role: 'current' | 'suggested';
  rulesVersion: string;
  status: 'fitted' | 'skipped' | 'failed';
  error?: string;
  fit: CandidateFit | null;
}

export interface Suggestion {
  rule: 'blueStatGain';
  kind: 'multiplier';
  multiplier: number;
  current: [number, number, number];
  proposed: [number, number, number];
  change: boolean;
  /** Always false: calibration never applies rules. */
  applied: false;
  basis: 'holdout-mae';
  /** Whether the holdout bootstrap interval contains 1 (null without bootstrap). */
  consistentWithCurrent: boolean | null;
  note: string;
}

export interface NotCalibrated {
  rule: string;
  verified: boolean;
  placeholder: boolean;
  reason: string;
}

export interface CalibrationReport {
  kind: typeof CALIBRATION_KIND;
  id: string;
  generatedAt: string;
  masterVersion: string;
  rulesVersion: string;
  status: 'complete' | 'partial' | 'unavailable';
  population: {
    rosterRows: number;
    used: number;
    excluded: { reason: CalibrationExclusion; count: number }[];
    rows: PopulationRow[];
  };
  split: {
    source: 'explicit' | 'seeded';
    seed: string | null;
    cvSeed: string;
    trainIds: string[];
    holdoutIds: string[];
    dropped: { id: string; reason: CalibrationExclusion }[];
    /** Used rows in neither list (explicit split only). */
    unused: number;
    /** ADR-0002: train rows whose recorded matched parent is a holdout veteran. */
    lineageCoupling: { references: number; trainRows: number; holdoutVeterans: number };
  };
  aptitude: AptitudeCheck;
  stats: StatCheck;
  skills: {
    status: 'ok' | 'insufficient-data';
    candidates: { multiplier: number; holdout: SkillHoldoutCheck }[];
    assumptions: string[];
  };
  candidates: Candidate[];
  suggestions: Suggestion[];
  notCalibrated: NotCalibrated[];
  runtime: {
    totalMs: number;
    gridMs: number;
    candidateFitMs: number;
    bootstrapMs: number;
    gridPoints: number;
    candidateFits: number;
  };
  warnings: string[];
}

interface UsedRow extends PreparedRow {
  /** E[inh] stat gain at m = 0 and its blue sensitivity E₁ − E₀ (stat order). */
  e0: number[];
  d: number[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function validateBootstrap(b: number): void {
  if (!Number.isInteger(b) || b < 0 || b > MAX_BOOTSTRAP) {
    throw new ModelInputError('bad-bootstrap', `bootstrap ${b} (integer 0..${MAX_BOOTSTRAP})`);
  }
}

function defaultTimer(): () => number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  // No wall-clock fallback (entry purity test): without `performance`, runtimes report 0.
  return p ? () => p.now() : () => 0;
}

/** 50 §1 `calibrateRules(ctx, roster)`. Never mutates `ctx` or `roster`. */
export function calibrateRules(
  ctx: EngineContext,
  roster: readonly Veteran[],
  opts: CalibrationOptions = {},
): CalibrationReport {
  const timer = opts.timer ?? defaultTimer();
  const t0 = timer();
  const gridSpec = { ...(opts.grid ?? DEFAULT_CALIBRATION_GRID) };
  validateGrid(gridSpec);
  const bootstrapN = opts.bootstrap ?? DEFAULT_BOOTSTRAP;
  validateBootstrap(bootstrapN);
  const cvSeed = opts.cvSeed ?? DEFAULT_CV_SEED;
  const bootstrapSeed = opts.bootstrapSeed ?? DEFAULT_BOOTSTRAP_SEED;
  const now = (opts.now ?? (() => new Date()))();
  const id = (opts.id ?? (() => newUlid(now.getTime())))();
  const warnings: string[] = [];

  // Population.
  const byId = new Map<string, Veteran>();
  for (const v of roster) {
    if (byId.has(v.id)) throw new ModelInputError('duplicate-id', v.id);
    byId.set(v.id, v);
  }
  const rows: PopulationRow[] = [];
  const used = new Map<string, UsedRow>();
  const ctx0 = withBlueStatGainMultiplier(ctx, 0);
  for (const v of [...roster].sort((a, b) => byString(a.id, b.id))) {
    const r = prepareRow(ctx, v, byId);
    if (!('row' in r)) {
      rows.push({ id: v.id, included: false, reason: r.reason, detail: r.detail });
      continue;
    }
    const kinds = r.row.parents;
    if (!kinds.every((k) => k === 'matched' || k === 'guest')) {
      rows.push({
        id: v.id,
        included: false,
        reason: 'parent-not-matched-or-guest',
        detail: `parents ${kinds.join('/')}`,
        parents: kinds,
      });
      continue;
    }
    const p1 = recordedParent(v, 1, byId)!;
    const p2 = recordedParent(v, 2, byId)!;
    const e0 = expectationFromPlan(
      planInheritance(ctx0, v.outfitId, [p1.legacy, p2.legacy], v.scenarioId),
    ).expectedStatGain;
    const e1 = r.row.exp.expectedStatGain;
    used.set(v.id, { ...r.row, e0: [...e0], d: e1.map((x, k) => x - e0[k]!) });
    rows.push({ id: v.id, included: true, parents: kinds, role: 'unused' });
  }
  const excludedCounts = new Map<CalibrationExclusion, number>();
  for (const r of rows) {
    if (!r.included) excludedCounts.set(r.reason!, (excludedCounts.get(r.reason!) ?? 0) + 1);
  }
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Split.
  let trainIds: string[];
  let holdoutIds: string[];
  const dropped: CalibrationReport['split']['dropped'] = [];
  let unused = 0;
  let splitSeed: string | null = null;
  if (opts.split) {
    const seen = new Set<string>();
    for (const sid of [...opts.split.trainIds, ...opts.split.holdoutIds]) {
      if (!byId.has(sid)) throw new ModelInputError('split-unknown', `${sid} is not in the roster`);
      if (seen.has(sid)) throw new ModelInputError('split-overlap', sid);
      seen.add(sid);
    }
    const keep = (ids: readonly string[]) =>
      [...ids].sort(byString).filter((sid) => {
        if (used.has(sid)) return true;
        dropped.push({ id: sid, reason: rowById.get(sid)!.reason! });
        return false;
      });
    trainIds = keep(opts.split.trainIds);
    holdoutIds = keep(opts.split.holdoutIds);
    dropped.sort((a, b) => byString(a.id, b.id));
    unused = [...used.keys()].filter((u) => !seen.has(u)).length;
  } else {
    splitSeed = opts.splitSeed ?? DEFAULT_CALIBRATION_SPLIT_SEED;
    ({ trainIds, holdoutIds } = seededSplit([...used.keys()], splitSeed));
  }
  for (const t of trainIds) rowById.get(t)!.role = 'train';
  for (const h of holdoutIds) rowById.get(h)!.role = 'holdout';
  const train = trainIds.map((t) => used.get(t)!);
  const hold = holdoutIds.map((h) => used.get(h)!);
  const holdSet = new Set(holdoutIds);
  let references = 0;
  const couplingTrain = new Set<string>();
  const couplingHold = new Set<string>();
  for (const r of train) {
    for (const p of r.v.parents) {
      if (p.matchedVeteranId && holdSet.has(p.matchedVeteranId)) {
        references++;
        couplingTrain.add(r.v.id);
        couplingHold.add(p.matchedVeteranId);
      }
    }
  }

  // 1. Aptitude (every used row, current rules).
  const aptitude = aptitudeCheck(ctx, [...used.values()]);
  if (aptitude.impossible > 0) {
    warnings.push(
      `aptitude: ${aptitude.impossible} observed grade(s) have predicted probability 0 (${aptitude.belowBase} below the trainee base, ${aptitude.aboveMax} above every reachable grade); excluded from the log-likelihood`,
    );
  }

  // 2. Stats.
  const current = ctx.tables.blueStatGain;
  const currentArr: [number, number, number] = [current[0], current[1], current[2]];
  const stats: StatCheck = {
    status: 'insufficient-data',
    currentBlueStatGain: currentArr,
    gridSpec,
    grid: [],
    current: null,
    selected: null,
    trainCvSelected: null,
    evaluation: {
      selectionSet: 'holdout',
      selectedHoldoutMaeIsPostSelection: true,
      unbiasedHoldoutMae: null,
      currentHoldoutMae: null,
      note: 'The suggested multiplier minimises holdout MAE (50 §8), so its holdout MAE is a post-selection value, not independent validation. The train-CV selection never used the holdout; its holdout MAE is the unbiased evaluation of that procedure. Holdout rows can still be matched parents in train-row lineages (ADR-0002 related-record coupling).',
    },
    bootstrap: null,
    withoutInheritance: null,
  };
  const tGrid0 = timer();
  let tBoot = 0;
  const enough = train.length >= CV_FOLDS && hold.length >= 1;
  const sensitive = [...used.values()].some((r) => r.d.some((x) => x !== 0));
  if (!enough) {
    stats.insufficient = `need ≥ ${CV_FOLDS} train rows (5-fold CV) and ≥ 1 holdout row; have ${train.length} train, ${hold.length} holdout`;
  } else if (!sensitive) {
    stats.status = 'nonidentifiable';
    const reasons: string[] = [];
    if (currentArr.every((x) => x === 0)) {
      reasons.push(
        'blueStatGain is zero for every star (placeholder): any multiplier of zero is zero, so no factor can be estimated',
      );
    }
    const noTurns = [...new Set([...used.values()].map((r) => r.v.scenarioId))]
      .filter((s) => r0Events(ctx, s) === 0)
      .sort();
    if (noTurns.length) {
      reasons.push(
        `scenario(s) ${noTurns.join(', ')} have no inheritance turns: event blue gains never apply, so blueStatGain cannot affect any stat`,
      );
    }
    if (!reasons.length)
      reasons.push('no used row has a blue spark whose event gain reaches a stat');
    stats.nonidentifiable = { reasons };
    warnings.push(`stats: blueStatGain multiplier is not identifiable (${reasons.join('; ')})`);
  } else {
    const fit = statGrid(ctx, train, hold, cvSeed, buildGrid(gridSpec));
    stats.grid = fit.grid;
    stats.current = fit.grid.find((g) => g.multiplier === 1) ?? fit.point(1);
    stats.withoutInheritance = fit.raw;
    const ms = fit.grid.map((g) => g.multiplier);
    const lo = ms[0]!;
    const hi = ms[ms.length - 1]!;
    const sel = (i: number): Selection => {
      const g = fit.grid[i]!;
      return {
        multiplier: g.multiplier,
        holdoutMae: g.holdoutMae,
        trainCvMae: g.trainCvMae,
        atBoundary: ms.length > 1 && (g.multiplier === lo || g.multiplier === hi),
      };
    };
    stats.selected = sel(
      selectArgmin(
        ms,
        fit.grid.map((g) => g.holdoutMae),
      ),
    );
    stats.trainCvSelected = sel(
      selectArgmin(
        ms,
        fit.grid.map((g) => g.trainCvMae),
      ),
    );
    stats.evaluation.unbiasedHoldoutMae = stats.trainCvSelected.holdoutMae;
    stats.evaluation.currentHoldoutMae = stats.current.holdoutMae;
    stats.status = stats.selected.atBoundary ? 'boundary' : 'suggested';
    if (stats.selected.atBoundary) {
      warnings.push(
        `stats: the holdout-MAE minimum is at the grid boundary (${stats.selected.multiplier} in [${lo}, ${hi}]); widen the grid. No multiplier is suggested.`,
      );
    }
    if (stats.trainCvSelected.atBoundary) {
      warnings.push(
        `stats: the train-CV minimum is at the grid boundary (${stats.trainCvSelected.multiplier})`,
      );
    }
    if (bootstrapN > 0) {
      const tb = timer();
      const rng = mulberry32(seedFromString(bootstrapSeed));
      const n = hold.length;
      const picks: number[] = [];
      let atB = 0;
      const sums = new Float64Array(ms.length);
      for (let b = 0; b < bootstrapN; b++) {
        sums.fill(0);
        for (let j = 0; j < n; j++) {
          const i = Math.floor(rng() * n);
          const rowAbs = fit.rowAbs[i]!;
          for (let g = 0; g < ms.length; g++) sums[g] = sums[g]! + rowAbs[g]!;
        }
        const k = selectArgmin(ms, [...sums]);
        picks.push(ms[k]!);
        if (ms.length > 1 && (k === 0 || k === ms.length - 1)) atB++;
      }
      picks.sort((a, b) => a - b);
      const p05 = percentile(picks, 0.05);
      const p95 = percentile(picks, 0.95);
      stats.bootstrap = {
        resamples: bootstrapN,
        seed: bootstrapSeed,
        p05,
        p50: percentile(picks, 0.5),
        p95,
        atBoundaryShare: atB / bootstrapN,
        containsCurrent: p05 <= 1 && 1 <= p95,
      };
      tBoot = timer() - tb;
    }
  }
  const gridMs = timer() - tGrid0 - tBoot;

  // 3. Candidate refits (ADR-0002 §2.11) and the skill check.
  const tFit0 = timer();
  const mults = [1];
  if (stats.status === 'suggested' && stats.selected!.multiplier !== 1) {
    mults.push(stats.selected!.multiplier);
  }
  const candidates: Candidate[] = [];
  const skillCands: { multiplier: number; holdout: SkillHoldoutCheck }[] = [];
  let fits = 0;
  for (const m of mults) {
    const cctx = m === 1 ? ctx : withBlueStatGainMultiplier(ctx, m);
    const cand: Candidate = {
      multiplier: m,
      role: m === 1 ? 'current' : 'suggested',
      rulesVersion: cctx.rules.version,
      status: 'skipped',
      fit: null,
    };
    candidates.push(cand);
    if (!enough) {
      cand.error = 'insufficient data for a refit';
      continue;
    }
    try {
      fits++;
      const f = fitTrainingModelDetailed(cctx, roster, {
        split: { trainIds, holdoutIds },
        cvSeed,
        now: () => now,
        id: () => id,
      });
      const s = f.snapshot.params;
      cand.status = 'fitted';
      cand.fit = {
        holdoutMae: STAT_KEYS.reduce((a, k) => a + f.report.holdout.mae[k], 0),
        perStat: { ...f.report.holdout.mae },
        coverage80: s.holdout.coverage80,
        coverageWithoutInheritance: f.report.holdout.coverageWithoutInheritance.pooled,
        lambdas: STAT_KEYS.map((k) => [
          f.report.lambdas[k].lambdaId,
          f.report.lambdas[k].lambdaBase,
        ]),
        sigma: STAT_KEYS.map((k) => s.perStat[k].sigma),
        covarianceWarnings: [...f.report.covariance.warnings],
        trainFingerprint: fingerprint(
          JSON.stringify([s.features, s.perStat, s.residualCov, s.skillAcquire]),
        ),
      };
      const g = stats.grid.find((x) => x.multiplier === m) ?? (m === 1 ? stats.current : null);
      if (g && Math.abs(g.holdoutMae - cand.fit.holdoutMae) > FAST_PATH_TOL) {
        warnings.push(
          `stats: fast path mismatch at ×${m}: grid ${g.holdoutMae} vs refit ${cand.fit.holdoutMae}`,
        );
      }
      const holdC = holdoutIds.map((h) => {
        const r = prepareRow(cctx, byId.get(h)!, byId);
        if (!('row' in r)) throw new Error(`holdout row ${h} became ineligible under ×${m}`);
        return r.row;
      });
      skillCands.push({ multiplier: m, holdout: skillHoldoutCheck(cctx, f.snapshot, holdC) });
    } catch (e) {
      cand.status = 'failed';
      cand.error = (e as Error).message;
      warnings.push(`candidate ×${m} refit failed: ${cand.error}`);
    }
  }
  const candidateFitMs = timer() - tFit0;
  const skills: CalibrationReport['skills'] = {
    status: skillCands.length && hold.length ? 'ok' : 'insufficient-data',
    candidates: skillCands,
    assumptions: [
      'P(acquire) = q·E[θ] per (holdout row, candidate skill); availability q counted once (ADR-0002 §3).',
      'Q-130: deck hint/event and innate skills have q = 1 (unverified).',
      'Q-131: acquired skills with q = 0 are contradictions, excluded and counted.',
      "Q-142: the trainee's own unique skill is excluded.",
      'θ comes from each candidate refit on train rows only; blueStatGain does not change q, so θ and the skill check do not discriminate blue multipliers.',
    ],
  };
  for (const s of skillCands) {
    if (s.holdout.contradictions > 0) {
      warnings.push(
        `skills: ${s.holdout.contradictions} acquired holdout skill cell(s) with no observable source (Q-131) under ×${s.multiplier}`,
      );
    }
  }

  // Suggestions (only what the implementation supports).
  const suggestions: Suggestion[] = [];
  if (stats.status === 'suggested') {
    const m = stats.selected!.multiplier;
    suggestions.push({
      rule: 'blueStatGain',
      kind: 'multiplier',
      multiplier: m,
      current: currentArr,
      proposed: currentArr.map((x) => x * m) as [number, number, number],
      change: m !== 1,
      applied: false,
      basis: 'holdout-mae',
      consistentWithCurrent: stats.bootstrap ? stats.bootstrap.containsCurrent : null,
      note: 'Unverified statistical suggestion (verified:false). Apply explicitly, then refit the training model (ADR-0002 §2.11, Q-141).',
    });
  }
  const notCalibrated = notCalibratedRules(ctx, stats.status);
  if (ctx.unverifiedRules.length) {
    warnings.push(`unverified rules in force: ${ctx.unverifiedRules.join(', ')}`);
  }
  if (ctx.placeholderRules.length) {
    warnings.push(`placeholder (UNKNOWN) rules in force: ${ctx.placeholderRules.join(', ')}`);
  }
  if (references > 0) {
    warnings.push(
      `holdout is lineage-coupled: ${references} train→holdout matched-parent reference(s) from ${couplingTrain.size} train row(s) to ${couplingHold.size} holdout veteran(s) (ADR-0002)`,
    );
  }
  if (enough && hold.length < 10)
    warnings.push(`only ${hold.length} holdout rows: the criterion is noisy`);

  const checksRun = [
    aptitude.status === 'ok',
    stats.status === 'suggested' || stats.status === 'boundary',
    skills.status === 'ok',
  ];
  const status = checksRun.every(Boolean)
    ? 'complete'
    : checksRun.some(Boolean)
      ? 'partial'
      : 'unavailable';

  return {
    kind: CALIBRATION_KIND,
    id,
    generatedAt: now.toISOString(),
    masterVersion: ctx.masterVersion,
    rulesVersion: ctx.rules.version,
    status,
    population: {
      rosterRows: roster.length,
      used: used.size,
      excluded: [...excludedCounts]
        .sort((a, b) => byString(a[0], b[0]))
        .map(([reason, count]) => ({ reason, count })),
      rows,
    },
    split: {
      source: opts.split ? 'explicit' : 'seeded',
      seed: splitSeed,
      cvSeed,
      trainIds,
      holdoutIds,
      dropped,
      unused,
      lineageCoupling: {
        references,
        trainRows: couplingTrain.size,
        holdoutVeterans: couplingHold.size,
      },
    },
    aptitude,
    stats,
    skills,
    candidates,
    suggestions,
    notCalibrated,
    runtime: {
      totalMs: timer() - t0,
      gridMs,
      candidateFitMs,
      bootstrapMs: tBoot,
      gridPoints: stats.grid.length,
      candidateFits: fits,
    },
    warnings,
  };
}

function r0Events(ctx: EngineContext, scenarioId: string): number {
  return ctx.scenarios.get(scenarioId)?.inheritanceTurns(ctx).length ?? 0;
}

/** Train-only grid fit. Returns grid points, per-holdout-row Σ_k|e| per grid point, the raw fit. */
function statGrid(
  ctx: EngineContext,
  train: readonly UsedRow[],
  hold: readonly UsedRow[],
  cvSeed: string,
  ms: readonly number[],
) {
  const names = featureNames(
    ctx,
    train.map((r) => r.plan),
  );
  const index = new Map(names.map((n, i) => [n, i]));
  const xOf = (r: UsedRow) => {
    const { x } = featureVector(ctx, names, index, r.plan);
    const full = new Float64Array(names.length + 1);
    full[0] = 1;
    full.set(x, 1);
    return full;
  };
  const xt = train.map(xOf);
  const xh = hold.map(xOf);
  const isId = [false, ...names.map(isCardIdFeature)];
  const clock = Math.max(...train.map((r) => r.time));
  const w = train.map((r) => recency(r.time, clock));
  const W = w.reduce((a, b) => a + b, 0);
  const stat = (r: UsedRow) => STAT_KEYS.map((k) => r.v.stats[k]);
  const yAt = (r: UsedRow, m: number) => stat(r).map((s, k) => s - (r.e0[k]! + m * r.d[k]!));

  const evaluate = (y: (r: UsedRow) => number[]) => {
    const rows: DesignRow[] = train.map((r, i) => ({ id: r.v.id, x: xt[i]!, y: y(r) }));
    for (const r of rows) {
      if (!r.y.every(Number.isFinite)) throw new ModelInputError('non-finite', `y of ${r.id}`);
    }
    const ridge = fitRidge(rows, w, isId, cvSeed);
    const abs = hold.map((r, i) => {
      const yy = y(r);
      return ridge.beta.map((b, k) => Math.abs(yy[k]! - dot(b, xh[i]!)));
    });
    const perStat = STAT_KEYS.map((_, k) => abs.reduce((a, e) => a + e[k]!, 0) / hold.length);
    const cv = STAT_KEYS.map(
      (_, k) => ridge.oof.reduce((a, e, i) => a + w[i]! * Math.abs(e[k]!), 0) / W,
    );
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return {
      holdoutMae: sum(perStat),
      perStat,
      trainCvMae: sum(cv),
      lambdas: ridge.lambdas.map((l) => [l.lambdaId, l.lambdaBase] as [number, number]),
      rowAbs: abs.map(sum),
    };
  };
  const point = (m: number): GridPoint & { rowAbs: number[] } => ({
    multiplier: m,
    ...evaluate((r) => yAt(r, m)),
  });
  const pts = ms.map(point);
  const raw = evaluate(stat);
  const strip = (p: GridPoint & { rowAbs: number[] }): GridPoint => ({
    multiplier: p.multiplier,
    holdoutMae: p.holdoutMae,
    perStat: p.perStat,
    trainCvMae: p.trainCvMae,
    lambdas: p.lambdas,
  });
  return {
    grid: pts.map(strip),
    point: (m: number): GridPoint => strip(point(m)),
    /** rowAbs[i][g]: Σ_k |e| of holdout row i at grid point g. */
    rowAbs: hold.map((_, i) => pts.map((p) => p.rowAbs[i]!)),
    raw: { holdoutMae: raw.holdoutMae, perStat: raw.perStat, trainCvMae: raw.trainCvMae },
  };
}

function notCalibratedRules(ctx: EngineContext, statStatus: StatCheck['status']): NotCalibrated[] {
  const r = ctx.rules;
  const entry = (rule: string, v: { verified: boolean; source: string }, reason: string) => ({
    rule,
    verified: v.verified,
    placeholder: /^\s*UNKNOWN/i.test(v.source),
    reason,
  });
  const unobserved =
    'activations are not observed; T15 implements no estimator for this rule (needs a cited source or a reviewed method)';
  const out: NotCalibrated[] = [
    entry('activation.blue', r.activation.blue, unobserved),
    entry(
      'activation.pink',
      r.activation.pink,
      `${unobserved}; the aptitude check reports fit only`,
    ),
    entry(
      'activation.green',
      r.activation.green,
      `${unobserved}; the skill check reports fit only`,
    ),
    entry(
      'activation.white',
      r.activation.white,
      `${unobserved}; the skill check reports fit only`,
    ),
    entry('affinityMultiplier', r.affinityMultiplier, unobserved),
    entry('grandparentWeight', r.grandparentWeight, unobserved),
    entry(
      'blueInitialBonus',
      r.blueInitialBonus,
      'confounded with the training intercepts and the event gain; parents-only vs every legacy is an open source conflict (Q-3)',
    ),
    entry(
      'pinkGradeGain',
      r.pinkGradeGain,
      'integer grade steps; the aptitude check reports fit only',
    ),
    entry('whiteHintLevels', r.whiteHintLevels, 'hint levels are not observed on veterans'),
    entry('raceSparkStatGain', r.raceSparkStatGain, unobserved),
    entry('scenarioSparkEffects', r.scenarioSparkEffects, unobserved),
  ];
  if (statStatus !== 'suggested') {
    out.unshift(
      entry(
        'blueStatGain',
        r.blueStatGain,
        `stat check status ${statStatus}: no multiplier is suggested`,
      ),
    );
  }
  return out;
}
