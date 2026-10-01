/**
 * TEST-ONLY diagnostic (T08 review round 1, B1/S3): a small 50 §4-style training fit that uses
 * only what T06 will have, to prove the golden dataset is recoverable. It is NOT the production
 * T06 `fitTrainingModel` (that lives in `src/` and is owned by T06); it exists so the golden data
 * can be checked against the intended estimator before T06 is written.
 *
 * Information used (and nothing else):
 * - rows: `truth.holdout.trainIds` (eligible: min confidence ≥ 0.9) for fitting, `holdoutIds` only
 *   for the S3 coverage report;
 * - y = finalStat − E[inheritance stat gain | recorded lineage] (T05 closed form on the lineage
 *   recorded on the veteran: matched parent -> `legacyFromVeteran(roster record)`, otherwise the
 *   parent's recorded sparks with no grandparents). `truth.latent` is never read;
 * - features: intercept, one-hot scenario × trainMode, outfit growth % (5), card id × (1 + lb/4),
 *   card type × (1 + lb/4) (7 pooled features), scenario `deckFeatures` (empty for the default
 *   plugin);
 * - sample weight w = 0.5^(age_days / 60), age = days between the row's dateAcquired and the most
 *   recent dateAcquired among the rows being fitted;
 * - weighted ridge, one fit per stat, λ_id on card-id coefficients and λ_base on everything else
 *   (the intercept included, as 50 §4 says "everything else"); λ from 5-fold CV on the
 *   {0.1, 1, 10, 100} × {0.1, 1, 10} grid.
 *
 * Plain erasable TypeScript; imports only the engine public API and schema types.
 */
import { STAT_KEYS } from '@uma/schema';
import type { RosterVeteran } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import {
  expectationFromPlan,
  legacyFromVeteran,
  mulberry32,
  planInheritance,
  seedFromString,
} from '../../src/index.ts';
import type { EngineContext, Legacy } from '../../src/index.ts';

export const RECENCY_HALF_LIFE_DAYS = 60;
export const LAMBDA_ID_GRID = [0.1, 1, 10, 100] as const;
export const LAMBDA_BASE_GRID = [0.1, 1, 10] as const;
export const CV_FOLDS = 5;
export const CV_SEED = 't08-diagnostic-cv';
/** Two-sided 80% normal quantile. */
export const Z80 = 1.2815515655446004;

export interface DesignRow {
  id: string;
  x: Float64Array;
  /** finalStat − E[inheritance | recorded lineage], stat order. */
  y: number[];
  /** Diagonal of the engine's inheritance covariance on the recorded lineage. */
  inhVar: number[];
  dateAcquired: string;
}

export interface Design {
  names: string[];
  /** true = card-id coefficient (penalised with λ_id). */
  isId: boolean[];
  rows: DesignRow[];
}

/** The lineage recorded on a veteran, as T06 sees it (50 §4 "its real parents, grandparents"). */
export function recordedLegacy(
  v: RosterVeteran,
  slot: 1 | 2,
  byId: ReadonlyMap<string, RosterVeteran>,
): Legacy {
  const p = v.parents.find((x) => x.slot === slot)!;
  const matched = p.matchedVeteranId ? byId.get(p.matchedVeteranId) : undefined;
  if (matched) return legacyFromVeteran(matched);
  const owner = slot === 1 ? 'parent1' : 'parent2';
  return {
    veteranId: null,
    characterId: p.characterId,
    sparks: v.sparks
      .filter((s) => s.owner === owner)
      .map((s) => ({ sparkId: s.sparkId, type: s.type, stars: s.stars })),
    grandparents: [null, null],
  };
}

/**
 * Builds the 50 §4 design. Feature names are fixed by `names` derived from the `fitIds` rows
 * (card ids / scenario cells seen in training); rows outside get zeros for unseen columns.
 */
export function buildDesign(
  ctx: EngineContext,
  master: MasterBundle,
  roster: readonly RosterVeteran[],
  fitIds: readonly string[],
  extraIds: readonly string[] = [],
): Design {
  const byId = new Map(roster.map((v) => [v.id, v]));
  const cards = new Map(master.cards.map((c) => [c.id, c]));
  const outfits = new Map(master.outfits.map((o) => [o.id, o]));
  const fit = fitIds.map((id) => byId.get(id)!);
  const cells = new Set<string>();
  const cardIds = new Set<string>();
  const deckKeys = new Set<string>();
  for (const v of fit) {
    cells.add(`${v.scenarioId ?? 'none'}|${v.trainMode}`);
    for (const d of v.deck) cardIds.add(d.cardId);
    const plugin = v.scenarioId ? ctx.scenarios.get(v.scenarioId) : undefined;
    for (const k of Object.keys(plugin?.deckFeatures(v.deck, ctx) ?? {})) deckKeys.add(k);
  }
  const types = ['speed', 'stamina', 'power', 'guts', 'wit', 'friend', 'group'];
  // The intercept is collinear with the full scenario × mode one-hot; keep every cell and let the
  // ridge penalty resolve it (all predictions and effective contributions are unaffected).
  const names = [
    'intercept',
    ...[...cells].sort().map((c) => `cell:${c}`),
    ...STAT_KEYS.map((k) => `growth:${k}`),
    ...[...cardIds].sort().map((c) => `card:${c}`),
    ...types.map((t) => `type:${t}`),
    ...[...deckKeys].sort().map((k) => `deck:${k}`),
  ];
  const col = new Map(names.map((n, i) => [n, i]));
  const rows: DesignRow[] = [];
  for (const id of [...fitIds, ...extraIds]) {
    const v = byId.get(id)!;
    const x = new Float64Array(names.length);
    x[0] = 1;
    const cell = col.get(`cell:${v.scenarioId ?? 'none'}|${v.trainMode}`);
    if (cell !== undefined) x[cell] = 1;
    const outfit = outfits.get(v.outfitId)!;
    STAT_KEYS.forEach((k) => (x[col.get(`growth:${k}`)!] = outfit.growth[k]));
    for (const d of v.deck) {
      const u = 1 + d.lb / 4;
      const c = col.get(`card:${d.cardId}`);
      if (c !== undefined) x[c]! += u;
      x[col.get(`type:${cards.get(d.cardId)!.type}`)!]! += u;
    }
    const plugin = v.scenarioId ? ctx.scenarios.get(v.scenarioId) : undefined;
    for (const [k, val] of Object.entries(plugin?.deckFeatures(v.deck, ctx) ?? {})) {
      const c = col.get(`deck:${k}`);
      if (c !== undefined) x[c] = val;
    }
    const e = expectationFromPlan(
      planInheritance(
        ctx,
        v.outfitId,
        [recordedLegacy(v, 1, byId), recordedLegacy(v, 2, byId)],
        v.scenarioId,
      ),
    );
    rows.push({
      id,
      x,
      y: STAT_KEYS.map((k, i) => v.stats[k] - e.expectedStatGain[i]!),
      inhVar: STAT_KEYS.map((_, i) => e.statGainCov[i]![i]!),
      dateAcquired: v.career.dateAcquired,
    });
  }
  return { names, isId: names.map((n) => n.startsWith('card:')), rows };
}

const DAY = 86_400_000;
/** 50 §4 recency weights relative to the most recent row of `rows`. */
export function recencyWeights(rows: readonly { dateAcquired: string }[]): number[] {
  const t = rows.map((r) => Date.parse(`${r.dateAcquired}T00:00:00Z`));
  const latest = Math.max(...t);
  return t.map((x) => 0.5 ** ((latest - x) / DAY / RECENCY_HALF_LIFE_DAYS));
}

export const effectiveSampleSize = (w: readonly number[]) =>
  w.reduce((s, x) => s + x, 0) ** 2 / w.reduce((s, x) => s + x * x, 0);

/** Lower Cholesky factor of a symmetric positive-definite matrix. */
function chol(a: Float64Array[], n: number): Float64Array[] {
  const l = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (!(s > 0)) throw new Error('ridge: matrix not positive definite');
        l[i]![i] = Math.sqrt(s);
      } else l[i]![j] = s / l[j]![j]!;
    }
  return l;
}
function cholSolve(l: Float64Array[], b: ArrayLike<number>): Float64Array {
  const n = l.length;
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[i]![k]! * z[k]!;
    z[i] = s / l[i]![i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k]![i]! * x[k]!;
    x[i] = s / l[i]![i]!;
  }
  return x;
}

export interface RidgeFit {
  beta: Float64Array;
  /** Cholesky factor of A = XᵀWX + Λ. */
  l: Float64Array[];
}

/** Weighted ridge for one stat: argmin Σ w (y − xβ)² + Σ λ_g β². */
export function ridge(
  d: Design,
  rows: readonly DesignRow[],
  w: readonly number[],
  stat: number,
  lambdaId: number,
  lambdaBase: number,
): RidgeFit {
  const p = d.names.length;
  const a = Array.from({ length: p }, () => new Float64Array(p));
  const b = new Float64Array(p);
  rows.forEach((r, n) => {
    const wn = w[n]!;
    for (let i = 0; i < p; i++) {
      const xi = r.x[i]!;
      if (xi === 0) continue;
      b[i]! += wn * xi * r.y[stat]!;
      for (let j = 0; j <= i; j++) a[i]![j]! += wn * xi * r.x[j]!;
    }
  });
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < i; j++) a[j]![i] = a[i]![j]!;
    a[i]![i]! += d.isId[i] ? lambdaId : lambdaBase;
  }
  const l = chol(a, p);
  return { beta: cholSolve(l, b), l };
}

export const predict = (beta: Float64Array, x: Float64Array) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += beta[i]! * x[i]!;
  return s;
};

/** Seeded 5-fold assignment of the fit rows (stable: sorted ids, Fisher–Yates). */
export function cvFolds(ids: readonly string[]): Map<string, number> {
  const sorted = [...ids].sort();
  const rng = mulberry32(seedFromString(CV_SEED));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
  }
  return new Map(sorted.map((id, i) => [id, i % CV_FOLDS]));
}

export interface CvChoice {
  lambdaId: number;
  lambdaBase: number;
  /** Weighted CV mean squared error per grid point, `${λid}/${λbase}` -> mse. */
  grid: Record<string, number>;
}

/** 5-fold CV over the 50 §4 grid for one stat (weighted squared error on the left-out fold). */
export function chooseLambda(d: Design, rows: readonly DesignRow[], stat: number): CvChoice {
  const folds = cvFolds(rows.map((r) => r.id));
  const grid: Record<string, number> = {};
  let best: CvChoice | null = null;
  let bestMse = Infinity;
  for (const lambdaId of LAMBDA_ID_GRID)
    for (const lambdaBase of LAMBDA_BASE_GRID) {
      let se = 0;
      let ws = 0;
      for (let f = 0; f < CV_FOLDS; f++) {
        const tr = rows.filter((r) => folds.get(r.id) !== f);
        const te = rows.filter((r) => folds.get(r.id) === f);
        // Recency weights are relative to the newest row of the whole fit set (one clock).
        const wAll = recencyWeights(rows);
        const wOf = new Map(rows.map((r, i) => [r.id, wAll[i]!]));
        const fit = ridge(
          d,
          tr,
          tr.map((r) => wOf.get(r.id)!),
          stat,
          lambdaId,
          lambdaBase,
        );
        for (const r of te) {
          const e = r.y[stat]! - predict(fit.beta, r.x);
          se += wOf.get(r.id)! * e * e;
          ws += wOf.get(r.id)!;
        }
      }
      const mse = se / ws;
      grid[`${lambdaId}/${lambdaBase}`] = mse;
      if (mse < bestMse) {
        bestMse = mse;
        best = { lambdaId, lambdaBase, grid };
      }
    }
  return best!;
}

/**
 * The identified estimand under id + type pooling: a card's effective contribution per unit of
 * (1 + lb/4) is β_id[card] + β_type[type(card)] (Q-122). The type feature equals the sum of the
 * card-id features of that type, so the split between the two is set by the penalty only.
 */
export function effectiveCardEffect(
  d: Design,
  beta: Float64Array,
  cardId: string,
  type: string,
): number {
  const id = d.names.indexOf(`card:${cardId}`);
  const t = d.names.indexOf(`type:${type}`);
  return (id >= 0 ? beta[id]! : 0) + (t >= 0 ? beta[t]! : 0);
}

export interface CoverageResult {
  /** Fraction of (holdout row, stat) cells inside the 80% interval, pooled over the 5 stats. */
  pooled: number;
  perStat: number[];
  cells: number;
  /** Residual sd used per stat (weighted train residuals, leverage-corrected). */
  sd: number[];
}

/**
 * S3: 80% predictive interval coverage on the holdout rows. Per stat: fit on the train rows with
 * the CV-chosen λ; σ̂² = Σ w r² / Σ w (1 − h) from the train residuals (h = the weighted ridge
 * leverage); interval = prediction ± z80 · sqrt(σ̂² (1 + xᵀ A⁻¹ XᵀW²X A⁻¹ x)). No truth input.
 */
export function holdoutCoverage(
  d: Design,
  train: readonly DesignRow[],
  holdout: readonly DesignRow[],
  lambdas: readonly { lambdaId: number; lambdaBase: number }[],
): CoverageResult {
  const w = recencyWeights(train);
  const perStat: number[] = [];
  const sd: number[] = [];
  let hit = 0;
  for (let k = 0; k < STAT_KEYS.length; k++) {
    const fit = ridge(d, train, w, k, lambdas[k]!.lambdaId, lambdas[k]!.lambdaBase);
    const p = d.names.length;
    // A⁻¹xᵢ for every train row gives the leverage and the sandwich XᵀW²X.
    const m = Array.from({ length: p }, () => new Float64Array(p));
    let num = 0;
    let den = 0;
    train.forEach((r, n) => {
      const ainvx = cholSolve(fit.l, r.x);
      let h = 0;
      for (let i = 0; i < p; i++) h += r.x[i]! * ainvx[i]!;
      h *= w[n]!;
      const e = r.y[k]! - predict(fit.beta, r.x);
      num += w[n]! * e * e;
      den += w[n]! * (1 - h);
      const w2 = w[n]! * w[n]!;
      for (let i = 0; i < p; i++) {
        if (r.x[i] === 0) continue;
        for (let j = 0; j < p; j++) m[i]![j]! += w2 * r.x[i]! * r.x[j]!;
      }
    });
    const s2 = num / den;
    sd.push(Math.sqrt(s2));
    let inside = 0;
    for (const r of holdout) {
      const ainvx = cholSolve(fit.l, r.x);
      let q = 0;
      for (let i = 0; i < p; i++) {
        let mi = 0;
        for (let j = 0; j < p; j++) mi += m[i]![j]! * ainvx[j]!;
        q += ainvx[i]! * mi;
      }
      const half = Z80 * Math.sqrt(s2 * (1 + q));
      if (Math.abs(r.y[k]! - predict(fit.beta, r.x)) <= half) inside++;
    }
    perStat.push(inside / holdout.length);
    hit += inside;
  }
  return {
    pooled: hit / (holdout.length * STAT_KEYS.length),
    perStat,
    cells: holdout.length * 5,
    sd,
  };
}
