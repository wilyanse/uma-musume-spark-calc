/**
 * 50 §4 estimation: weighted two-group ridge, one fit per stat, λ chosen by 5-fold CV on the
 * {0.1, 1, 10, 100} (λ_id) × {0.1, 1, 10} (λ_base) grid, and the ADR-0002 §2.3 out-of-fold
 * residuals on the same folds with the per-stat CV choice.
 */
import { mulberry32, seedFromString } from '../rng.ts';
import { choleskyFactor, choleskySolve, NumericError } from '../linalg.ts';

export const LAMBDA_ID_GRID = [0.1, 1, 10, 100] as const;
export const LAMBDA_BASE_GRID = [0.1, 1, 10] as const;
export const CV_FOLDS = 5;
export const N_STATS = 5;

export interface DesignRow {
  id: string;
  /** Column 0 is the intercept (1); the rest follow the snapshot feature names. */
  x: Float64Array;
  /** finalStat − E[inheritance | recorded lineage], stat order. */
  y: number[];
}

export interface LambdaChoice {
  lambdaId: number;
  lambdaBase: number;
  /** Weighted CV MSE per grid point, key `${λ_id}/${λ_base}`. */
  grid: Record<string, number>;
}

/**
 * Seeded fold assignment: ids sorted ascending, Fisher–Yates with mulberry32(seedFromString(seed)),
 * fold = position mod 5. Deterministic and independent of the input order.
 */
export function cvFolds(ids: readonly string[], seed: string): Map<string, number> {
  const sorted = [...ids].sort();
  const rng = mulberry32(seedFromString(seed));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
  }
  return new Map(sorted.map((id, i) => [id, i % CV_FOLDS]));
}

/** Gram matrix XᵀWX and right-hand sides XᵀW y_k for all 5 stats (shared across stats). */
export interface Normal {
  p: number;
  xtx: Float64Array[];
  xty: Float64Array[];
}

export function normalEquations(rows: readonly DesignRow[], w: readonly number[]): Normal {
  const p = rows[0]?.x.length ?? 0;
  const xtx = Array.from({ length: p }, () => new Float64Array(p));
  const xty = Array.from({ length: N_STATS }, () => new Float64Array(p));
  const nz = new Int32Array(p);
  rows.forEach((r, n) => {
    const wn = w[n]!;
    if (!(wn > 0) || !Number.isFinite(wn)) {
      throw new NumericError('bad-weight', `weight of ${r.id} must be finite and > 0`);
    }
    let m = 0;
    for (let i = 0; i < p; i++) if (r.x[i] !== 0) nz[m++] = i;
    for (let a = 0; a < m; a++) {
      const i = nz[a]!;
      const wxi = wn * r.x[i]!;
      for (let k = 0; k < N_STATS; k++) xty[k]![i] = xty[k]![i]! + wxi * r.y[k]!;
      const row = xtx[i]!;
      for (let b = 0; b <= a; b++) {
        const j = nz[b]!;
        row[j] = row[j]! + wxi * r.x[j]!;
      }
    }
  });
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) xtx[j]![i] = xtx[i]![j]!;
  return { p, xtx, xty };
}

/** Cholesky factor of XᵀWX + diag(λ). `isId[i]` selects λ_id, else λ_base. */
export function penalisedFactor(
  n: Normal,
  isId: readonly boolean[],
  lambdaId: number,
  lambdaBase: number,
): Float64Array[] {
  const a = n.xtx.map((r) => Float64Array.from(r));
  for (let i = 0; i < n.p; i++) a[i]![i] = a[i]![i]! + (isId[i] ? lambdaId : lambdaBase);
  return choleskyFactor(a);
}

export const dot = (beta: ArrayLike<number>, x: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += beta[i]! * x[i]!;
  return s;
};

/** Fold partitions of the fit rows, built once (one recency clock: the full-train weights). */
function partitions(rows: readonly DesignRow[], w: readonly number[], folds: Map<string, number>) {
  return Array.from({ length: CV_FOLDS }, (_, f) => {
    const trIdx: number[] = [];
    const teIdx: number[] = [];
    rows.forEach((r, i) => (folds.get(r.id) === f ? teIdx : trIdx).push(i));
    return {
      normal: normalEquations(
        trIdx.map((i) => rows[i]!),
        trIdx.map((i) => w[i]!),
      ),
      te: teIdx,
    };
  });
}

export interface RidgeFit {
  lambdas: LambdaChoice[];
  /** β per stat on all fit rows (column 0 = intercept). */
  beta: Float64Array[];
  /** OOF residual vector per fit row (same order as `rows`). */
  oof: number[][];
}

/**
 * CV over the grid (ties keep the first grid point in λ_id-major order), the full-train fit per
 * stat, and OOF residuals with the chosen λ on the same folds (ADR-0002 §2.1–2.3).
 */
export function fitRidge(
  rows: readonly DesignRow[],
  w: readonly number[],
  isId: readonly boolean[],
  foldSeed: string,
): RidgeFit {
  const folds = cvFolds(
    rows.map((r) => r.id),
    foldSeed,
  );
  const parts = partitions(rows, w, folds);
  const best: { mse: number; choice: LambdaChoice | null }[] = Array.from(
    { length: N_STATS },
    () => ({ mse: Infinity, choice: null }),
  );
  const grids: Record<string, number>[] = Array.from({ length: N_STATS }, () => ({}));
  const oofByLambda = new Map<string, number[][]>();
  for (const lambdaId of LAMBDA_ID_GRID) {
    for (const lambdaBase of LAMBDA_BASE_GRID) {
      const key = `${lambdaId}/${lambdaBase}`;
      const se = new Array<number>(N_STATS).fill(0);
      let ws = 0;
      const oof = rows.map(() => new Array<number>(N_STATS).fill(0));
      for (const part of parts) {
        if (part.te.length === 0) continue;
        const l = penalisedFactor(part.normal, isId, lambdaId, lambdaBase);
        const betas = part.normal.xty.map((b) => choleskySolve(l, b));
        for (const i of part.te) {
          const r = rows[i]!;
          ws += w[i]!;
          for (let k = 0; k < N_STATS; k++) {
            const e = r.y[k]! - dot(betas[k]!, r.x);
            oof[i]![k] = e;
            se[k] = se[k]! + w[i]! * e * e;
          }
        }
      }
      oofByLambda.set(key, oof);
      for (let k = 0; k < N_STATS; k++) {
        const mse = se[k]! / ws;
        if (!Number.isFinite(mse)) throw new NumericError('non-finite', `CV mse ${key} stat ${k}`);
        grids[k]![key] = mse;
        if (mse < best[k]!.mse) {
          best[k] = { mse, choice: { lambdaId, lambdaBase, grid: grids[k]! } };
        }
      }
    }
  }
  const lambdas = best.map((b) => b.choice!);
  const full = normalEquations(rows, w);
  const beta = lambdas.map((c, k) =>
    choleskySolve(penalisedFactor(full, isId, c.lambdaId, c.lambdaBase), full.xty[k]!),
  );
  // OOF residual of stat k = the CV residual at stat k's chosen λ (same folds, same weights).
  const oof = rows.map((_, i) =>
    lambdas.map((c, k) => oofByLambda.get(`${c.lambdaId}/${c.lambdaBase}`)![i]![k]!),
  );
  return { lambdas, beta, oof };
}
