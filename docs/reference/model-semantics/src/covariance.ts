/**
 * T05b EVIDENCE (ADR-0002 §Q-123): the out-of-fold (OOF) training-deconvolution estimator of the
 * NON-inheritance residual covariance Σ_N, the holdout evaluation, and the single-count predictive
 * forms (Gaussian fast pass and seeded Monte Carlo). Pure functions over plain rows; the golden
 * adapter lives in `golden.ts`. This is the executable reference for the spec errata, not T06.
 */
import { floorPsd, NumericError, symmetrize, trace, zeros } from './linalg.ts';
import type { Matrix, PsdFloor } from './linalg.ts';

export const N_STATS = 5;
/** Two-sided 80% normal quantile z_0.9 (same constant as the T08 diagnostics). */
export const Z80 = 1.2815515655446004;
/** ADR-0002 flooring scale: ε = EPS_REL · max(1, tr(S)/5). Not tuned: a numerical guard only. */
export const EPS_REL = 1e-6;

export interface WeightedResidual {
  id: string;
  /** Recency weight w_i = 0.5^(age_i/60), clock = newest TRAIN row. */
  w: number;
  /** OOF residual e_i = y_i − x_i β^(−fold(i)), stat order. */
  e: number[];
  /** Engine statGainCov on the row's recorded lineage (5×5). */
  inhCov: Matrix;
}

export interface CovarianceFit {
  /** Σ_N: PSD non-inheritance covariance stored as `params.residualCov` (training-v2). */
  residualCov: Matrix;
  /** √diag(Σ_N), stored as `perStat[k].sigma`. */
  sigma: number[];
  /** Factor L with L Lᵀ = Σ_N (eigen factor, for sampling). */
  factor: Matrix;
  /** Diagnostics (not in the snapshot shape; T06 exposes them in its fit report). */
  diagnostics: {
    /** Uncentred weighted OOF second moment S. */
    totalSecondMoment: Matrix;
    /** C̄ = Σ w C_i / Σ w (same weights as S). */
    meanInheritanceCov: Matrix;
    /** OOF weighted mean residual m (reported, NOT subtracted). */
    oofMean: number[];
    weightSum: number;
    ess: number;
    rows: number;
    rawEigenvalues: number[];
    epsilon: number;
    flooredCount: number;
    flooredMass: number;
    jacobiSweeps: number;
    warnings: string[];
  };
}

/**
 * ADR-0002 steps 4–7. Inputs are the OOF residuals of the TRAIN split only, their recency
 * weights, and each row's engine inheritance covariance on its recorded lineage.
 */
export function estimateNonInheritanceCov(rows: readonly WeightedResidual[]): CovarianceFit {
  if (rows.length === 0) throw new NumericError('non-finite', 'no training rows');
  let W = 0;
  let W2 = 0;
  const S = zeros(N_STATS);
  const C = zeros(N_STATS);
  const m = new Array<number>(N_STATS).fill(0);
  for (const r of rows) {
    if (!(r.w > 0) || !Number.isFinite(r.w))
      throw new NumericError('non-finite', `weight of ${r.id} must be finite and > 0`);
    if (r.e.length !== N_STATS || !r.e.every(Number.isFinite))
      throw new NumericError('non-finite', `residual of ${r.id}`);
    W += r.w;
    W2 += r.w * r.w;
    for (let k = 0; k < N_STATS; k++) {
      m[k]! += r.w * r.e[k]!;
      for (let j = 0; j < N_STATS; j++) {
        S[k]![j]! += r.w * r.e[k]! * r.e[j]!;
        const c = r.inhCov[k]![j]!;
        if (!Number.isFinite(c)) throw new NumericError('non-finite', `inhCov of ${r.id}`);
        C[k]![j]! += r.w * c;
      }
    }
  }
  for (let k = 0; k < N_STATS; k++) {
    m[k]! /= W;
    for (let j = 0; j < N_STATS; j++) {
      S[k]![j]! /= W;
      C[k]![j]! /= W;
    }
  }
  const raw = zeros(N_STATS);
  for (let k = 0; k < N_STATS; k++)
    for (let j = 0; j < N_STATS; j++) raw[k]![j] = S[k]![j]! - C[k]![j]!;
  const R = symmetrize(raw);
  const warnings: string[] = [];
  for (let k = 0; k < N_STATS; k++)
    if (R[k]![k]! <= 0)
      warnings.push(
        `stat ${k}: mean inheritance variance ${C[k]![k]!.toFixed(3)} ≥ total OOF second moment ${S[k]![k]!.toFixed(3)} (rules or lineage likely mis-specified)`,
      );
  const epsilon = EPS_REL * Math.max(1, trace(S) / N_STATS);
  const f: PsdFloor = floorPsd(R, epsilon);
  if (f.flooredCount > 0)
    warnings.push(`${f.flooredCount} eigenvalue(s) floored to ε=${epsilon.toExponential(3)}`);
  return {
    residualCov: f.sigma,
    sigma: f.sigma.map((r, k) => Math.sqrt(r[k]!)),
    factor: f.factor,
    diagnostics: {
      totalSecondMoment: S,
      meanInheritanceCov: C,
      oofMean: m,
      weightSum: W,
      ess: (W * W) / W2,
      rows: rows.length,
      rawEigenvalues: f.rawEigenvalues,
      epsilon,
      flooredCount: f.flooredCount,
      flooredMass: f.flooredMass,
      jacobiSweeps: f.sweeps,
      warnings,
    },
  };
}

export interface HoldoutCell {
  id: string;
  /** Holdout residual y − xβ (β from the 80% fit). */
  e: number[];
  inhCov: Matrix;
  /** Holdout recency weight (clock = newest holdout row), for the bias diagnostic only. */
  w: number;
}

export interface Coverage {
  pooled: number;
  perStat: number[];
  cells: number;
}

/** 50 §7 Gaussian form: |e_k| ≤ z0.9 · √(Σ_kk + C_i,kk). */
export function gaussianCoverage(
  sigma: Matrix,
  holdout: readonly HoldoutCell[],
  addInheritance = true,
): Coverage {
  const perStat = new Array<number>(N_STATS).fill(0);
  for (const r of holdout)
    for (let k = 0; k < N_STATS; k++) {
      const v = sigma[k]![k]! + (addInheritance ? r.inhCov[k]![k]! : 0);
      if (Math.abs(r.e[k]!) <= Z80 * Math.sqrt(v)) perStat[k]!++;
    }
  const n = holdout.length;
  return {
    pooled: perStat.reduce((s, x) => s + x, 0) / (n * N_STATS),
    perStat: perStat.map((x) => x / n),
    cells: n * N_STATS,
  };
}

/** Weighted holdout bias diagnostic: mean, its standard error and Hotelling-type T². */
export function holdoutBias(holdout: readonly HoldoutCell[]) {
  const W = holdout.reduce((s, r) => s + r.w, 0);
  const W2 = holdout.reduce((s, r) => s + r.w * r.w, 0);
  const mean = Array.from(
    { length: N_STATS },
    (_, k) => holdout.reduce((s, r) => s + r.w * r.e[k]!, 0) / W,
  );
  const cov = zeros(N_STATS);
  for (const r of holdout)
    for (let k = 0; k < N_STATS; k++)
      for (let j = 0; j < N_STATS; j++)
        cov[k]![j]! += (r.w * (r.e[k]! - mean[k]!) * (r.e[j]! - mean[j]!)) / W;
  // Var(weighted mean) ≈ cov · Σw²/W² (independent rows).
  const scale = W2 / (W * W);
  const vm = cov.map((row) => row.map((x) => x * scale));
  return { mean, se: vm.map((r, k) => Math.sqrt(r[k]!)), varMean: vm, ess: (W * W) / W2 };
}

/** Standard normal from two uniforms (Box–Muller, cosine branch; uses 1−u1 so ln never sees 0). */
export function boxMuller(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
}

/** One MVN(0, LLᵀ) draw: five standard normals in stat order, then L z. */
export function mvnDraw(factor: Matrix, rng: () => number): number[] {
  const z = Array.from({ length: N_STATS }, () => boxMuller(rng));
  return factor.map((row) => row.reduce((s, x, k) => s + x * z[k]!, 0));
}

/** Type-7 (linear interpolation) sample quantile of a sorted array. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export { zeros };
