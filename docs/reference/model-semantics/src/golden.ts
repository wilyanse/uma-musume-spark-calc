/**
 * T05b EVIDENCE adapter: builds the ADR-0002 inputs from the committed T08 golden files using only
 * T06-available information (roster rows, recorded lineage, engine closed form), by reusing the
 * TEST-ONLY T08 design/ridge helpers in `packages/engine/scripts/golden-diagnostic.ts`.
 * `truth.latent` and planted parameters are never read by an estimator here; the only planted
 * values touched are clearly labelled ORACLE diagnostics in the probe output.
 */
import { readFileSync } from 'node:fs';
import { loadPublishedBundle } from '../../../../packages/engine/scripts/published-bundle.ts';
import { loadGoldenContext } from '../../../../packages/engine/scripts/golden-context.ts';
import type { GoldenTruth } from '../../../../packages/engine/scripts/golden-context.ts';
import {
  buildDesign,
  chooseLambda,
  cvFolds,
  effectiveCardEffect,
  predict,
  recencyWeights,
  recordedLegacy,
  ridge,
} from '../../../../packages/engine/scripts/golden-diagnostic.ts';
import type {
  CvChoice,
  Design,
  DesignRow,
} from '../../../../packages/engine/scripts/golden-diagnostic.ts';
import {
  expectationFromPlan,
  mulberry32,
  planInheritance,
  sampleInheritance,
  seedFromString,
} from '../../../../packages/engine/src/index.ts';
import type {
  EngineContext,
  InheritancePlan,
  InheritanceResult,
  Veteran,
} from '../../../../packages/engine/src/index.ts';
import type { Matrix } from './linalg.ts';
import {
  estimateNonInheritanceCov,
  mvnDraw,
  N_STATS,
  predictiveDraws,
  quantileSorted,
} from './covariance.ts';
import type { CovarianceFit, HoldoutCell, WeightedResidual } from './covariance.ts';

export type MasterBundle = ReturnType<typeof loadPublishedBundle>;
const GOLDEN = new URL('../../../../packages/engine/test/golden/', import.meta.url);
const readJson = (f: string): unknown => JSON.parse(readFileSync(new URL(f, GOLDEN), 'utf8'));

export interface Golden {
  master: MasterBundle;
  truth: GoldenTruth;
  roster: Veteran[];
  byId: Map<string, Veteran>;
  ctx: EngineContext;
  /** Per roster id: plan + closed form on the RECORDED lineage (what T06 sees). */
  lineage: Map<string, { plan: InheritancePlan; exp: InheritanceResult }>;
}

export function loadGolden(): Golden {
  const master = loadPublishedBundle();
  const truth = readJson('truth.json') as GoldenTruth;
  const roster = readJson('roster.json') as Veteran[];
  const byId = new Map(roster.map((v) => [v.id, v]));
  const ctx = loadGoldenContext(master, truth);
  const lineage = new Map<string, { plan: InheritancePlan; exp: InheritanceResult }>();
  for (const v of roster) {
    const plan = planInheritance(
      ctx,
      v.outfitId,
      [recordedLegacy(v, 1, byId), recordedLegacy(v, 2, byId)],
      v.scenarioId,
    );
    lineage.set(v.id, { plan, exp: expectationFromPlan(plan) });
  }
  return { master, truth, roster, byId, ctx, lineage };
}

export interface SplitFit {
  design: Design;
  train: DesignRow[];
  hold: DesignRow[];
  lambdas: CvChoice[];
  /** β per stat from the fit on all train rows. */
  beta: Float64Array[];
  oof: WeightedResidual[];
  holdout: HoldoutCell[];
  cov: CovarianceFit;
}

/**
 * ADR-0002 steps 1–8 on one train/holdout split. `lambdas` may be supplied to skip CV (small-
 * sample probes); otherwise chosen by the T08 5-fold CV on the train rows only.
 */
export function fitSplit(
  g: Golden,
  trainIds: readonly string[],
  holdIds: readonly string[],
  opts: {
    lambdas?: CvChoice[];
    yOverride?: Map<string, number[]>;
    /** DIAGNOSTIC ONLY: an alternative OOF fold partition (ADR-0002 requires the CV folds). */
    oofFoldSeed?: string;
  } = {},
): SplitFit {
  const design = buildDesign(g.ctx, g.master, g.roster, trainIds, holdIds);
  if (opts.yOverride)
    for (const r of design.rows) {
      const y = opts.yOverride.get(r.id);
      if (y) r.y = [...y];
    }
  const train = design.rows.slice(0, trainIds.length);
  const hold = design.rows.slice(trainIds.length);
  const lambdas =
    opts.lambdas ?? Array.from({ length: N_STATS }, (_, k) => chooseLambda(design, train, k));
  const w = recencyWeights(train);
  const wOf = new Map(train.map((r, i) => [r.id, w[i]!]));
  const beta = Array.from(
    { length: N_STATS },
    (_, k) => ridge(design, train, w, k, lambdas[k]!.lambdaId, lambdas[k]!.lambdaBase).beta,
  );
  // OOF residuals: the same seeded 5-fold partition as the CV (cvFolds on the train ids), λ fixed
  // at the per-stat CV choice, weights = the full-train recency weights (one clock).
  const folds = opts.oofFoldSeed
    ? new Map(
        shuffled(
          train.map((r) => r.id),
          mulberry32(seedFromString(opts.oofFoldSeed)),
        ).map((id, i) => [id, i % 5]),
      )
    : cvFolds(train.map((r) => r.id));
  const oofE = new Map<string, number[]>(
    train.map((r) => [r.id, new Array<number>(N_STATS).fill(0)]),
  );
  for (let f = 0; f < 5; f++) {
    const tr = train.filter((r) => folds.get(r.id) !== f);
    const te = train.filter((r) => folds.get(r.id) === f);
    if (te.length === 0) continue;
    const wTr = tr.map((r) => wOf.get(r.id)!);
    for (let k = 0; k < N_STATS; k++) {
      const b = ridge(design, tr, wTr, k, lambdas[k]!.lambdaId, lambdas[k]!.lambdaBase).beta;
      for (const r of te) oofE.get(r.id)![k] = r.y[k]! - predict(b, r.x);
    }
  }
  const cov = (id: string): Matrix => g.lineage.get(id)!.exp.statGainCov;
  const oof: WeightedResidual[] = train.map((r) => ({
    id: r.id,
    w: wOf.get(r.id)!,
    e: oofE.get(r.id)!,
    inhCov: cov(r.id),
  }));
  const wh = hold.length ? recencyWeights(hold) : [];
  const holdout: HoldoutCell[] = hold.map((r, i) => ({
    id: r.id,
    e: beta.map((b, k) => r.y[k]! - predict(b, r.x)),
    inhCov: cov(r.id),
    w: wh[i]!,
  }));
  return { design, train, hold, lambdas, beta, oof, holdout, cov: estimateNonInheritanceCov(oof) };
}

/** Seeded Fisher–Yates permutation of sorted ids (mulberry32 from the engine). */
export function shuffled(ids: readonly string[], rng: () => number): string[] {
  const out = [...ids].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The 50 §4 feature vector of a PLAN (trainee outfit, deck, mode, scenario) in a fitted design's
 * column space; the same rules as `buildDesign` (unseen card ids / cells get no id column).
 */
export function planFeatures(
  g: Golden,
  design: Design,
  plan: { traineeOutfitId: string; deck: Veteran['deck']; trainMode: string; scenarioId: string },
): Float64Array {
  const col = new Map(design.names.map((n, i) => [n, i]));
  const x = new Float64Array(design.names.length);
  x[0] = 1;
  const cell = col.get(`cell:${plan.scenarioId}|${plan.trainMode}`);
  if (cell !== undefined) x[cell] = 1;
  const outfit = g.master.outfits.find((o) => o.id === plan.traineeOutfitId)!;
  for (const k of ['spd', 'sta', 'pow', 'gut', 'wit'] as const)
    x[col.get(`growth:${k}`)!] = outfit.growth[k];
  const cards = new Map(g.master.cards.map((c) => [c.id, c]));
  for (const d of plan.deck) {
    const u = 1 + d.lb / 4;
    const c = col.get(`card:${d.cardId}`);
    if (c !== undefined) x[c]! += u;
    x[col.get(`type:${cards.get(d.cardId)!.type}`)!]! += u;
  }
  const plugin = g.ctx.scenarios.get(plan.scenarioId);
  for (const [k, val] of Object.entries(plugin?.deckFeatures(plan.deck, g.ctx) ?? {})) {
    const c = col.get(`deck:${k}`);
    if (c !== undefined) x[c] = val;
  }
  return x;
}

/** One (row, skill) cell of the Q-124 exposure model (observable inputs only). */
export interface SkillCell {
  rowId: string;
  mode: 'independent' | 'manual';
  skillId: string;
  /** 1 for deck hint/event or innate (existing approximation), else lineage skillHintProb. */
  q: number;
  /** True when the availability is guaranteed (q = 1 by source, not by a lineage p = 1). */
  sure: boolean;
  y: 0 | 1;
}

/**
 * Q-124 cells of a set of roster rows: every candidate skill (deck hint/event ∪ innate ∪ recorded-
 * lineage hint) minus the outfit unique skill, plus every acquired non-unique skill without an
 * observable source (q = 0, y = 1: a contradiction under the model, reported and excluded).
 */
export function skillCells(g: Golden, ids: readonly string[]): SkillCell[] {
  const cards = new Map(g.master.cards.map((c) => [c.id, c]));
  const outfits = new Map(g.master.outfits.map((o) => [o.id, o]));
  const out: SkillCell[] = [];
  for (const id of ids) {
    const v = g.byId.get(id)!;
    const outfit = outfits.get(v.outfitId)!;
    const sure = new Set(outfit.innateSkillIds);
    for (const d of v.deck)
      for (const s of [...cards.get(d.cardId)!.hintSkillIds, ...cards.get(d.cardId)!.eventSkillIds])
        sure.add(s);
    const lineage = g.lineage.get(id)!.exp.skillHintProb;
    const cand = new Set([...sure, ...Object.keys(lineage)]);
    cand.delete(outfit.uniqueSkillId);
    const acquired = new Set(
      v.skills.filter((s) => s.skillId !== outfit.uniqueSkillId).map((s) => s.skillId),
    );
    for (const s of [...cand].sort()) {
      const isSure = sure.has(s);
      out.push({
        rowId: id,
        mode: v.trainMode,
        skillId: s,
        q: isSure ? 1 : Math.min(1, Math.max(0, lineage[s] ?? 0)),
        sure: isSure,
        y: acquired.has(s) ? 1 : 0,
      });
    }
    for (const s of [...acquired].sort())
      if (!cand.has(s))
        out.push({ rowId: id, mode: v.trainMode, skillId: s, q: 0, sure: false, y: 1 });
  }
  return out;
}

/** 50 §5 Monte Carlo p10–p90 coverage with Σ_N (eigen factor) + sampled inheritance, once. */
export function mcCoverage(
  g: Golden,
  cov: CovarianceFit,
  holdout: readonly HoldoutCell[],
  seed: string,
  samples = 2000,
) {
  const perStat = new Array<number>(N_STATS).fill(0);
  for (const r of holdout) {
    const { plan, exp } = g.lineage.get(r.id)!;
    const d = predictiveDraws(
      `${seed}:${r.id}`,
      samples,
      (rng) => sampleInheritance(plan, rng).statGain,
      (rng) => mvnDraw(cov.factor, rng),
    );
    const draws: number[][] = Array.from({ length: N_STATS }, () => []);
    for (let s = 0; s < samples; s++)
      for (let k = 0; k < N_STATS; k++)
        draws[k]!.push(d.train[s]![k]! + d.inh[s]![k]! - exp.expectedStatGain[k]!);
    for (let k = 0; k < N_STATS; k++) {
      const d = draws[k]!.sort((a, b) => a - b);
      if (r.e[k]! >= quantileSorted(d, 0.1) && r.e[k]! <= quantileSorted(d, 0.9)) perStat[k]!++;
    }
  }
  const n = holdout.length;
  return {
    pooled: perStat.reduce((s, x) => s + x, 0) / (n * N_STATS),
    perStat: perStat.map((x) => x / n),
  };
}

/** Q-122 estimand: β_id + β_type vs planted perUnit (an ORACLE check, never an estimator input). */
export function recovery(g: Golden, fit: SplitFit) {
  const types = new Map(g.master.cards.map((c) => [c.id, c.type]));
  const keys = ['spd', 'sta', 'pow', 'gut', 'wit'] as const;
  let worst = 0;
  let fails = 0;
  let zero = 0;
  keys.forEach((k, s) => {
    for (const card of g.truth.trainingModel.plantedCards) {
      const want = card.perUnit[k];
      if (!want) continue;
      const err =
        Math.abs(effectiveCardEffect(fit.design, fit.beta[s]!, card.cardId, card.type) - want) /
        want;
      worst = Math.max(worst, err);
      if (err >= 0.15) fails++;
    }
    for (const id of g.truth.trainingModel.zeroEffectCards)
      zero = Math.max(
        zero,
        Math.abs(effectiveCardEffect(fit.design, fit.beta[s]!, id, types.get(id)!)),
      );
  });
  return {
    worstRelErr: Number(worst.toFixed(4)),
    failsAt15pct: fails,
    maxAbsZeroCard: Number(zero.toFixed(2)),
  };
}
