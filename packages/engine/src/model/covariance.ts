/**
 * ADR-0002 §2 (Q-123): the NON-inheritance training covariance Σ_N from recency-weighted,
 * uncentred out-of-fold train residuals minus the same-weighted mean inheritance covariance,
 * symmetrised and floored to PSD by deterministic Jacobi; plus the holdout evaluation forms.
 */
import { floorPsd, NumericError, solveSpd, symmetrize, trace, zeros } from '../linalg.ts';
import type { Matrix } from '../linalg.ts';

export const N_STATS = 5;
/** Two-sided 80% normal quantile z_0.9. */
export const Z80 = 1.2815515655446004;
/** ε = EPS_REL · max(1, tr(S)/5): a numerical guard, not a tuned inflation. */
export const EPS_REL = 1e-6;
/** χ²₅ 0.95 for the holdout-bias Hotelling-type diagnostic. */
export const CHI2_5_95 = 11.070497693516351;

export interface WeightedResidual {
  id: string;
  /** Recency weight (clock = newest TRAIN row). */
  w: number;
  /** OOF residual, stat order. */
  e: readonly number[];
  /** Engine `statGainCov` on the row's recorded lineage. */
  inhCov: Matrix;
}

export interface CovarianceDiagnostics {
  /** Uncentred weighted OOF second moment S. */
  totalSecondMoment: Matrix;
  /** C̄ = Σ w C_i / Σ w (same weights as S). */
  meanInheritanceCov: Matrix;
  /** Weighted OOF mean (reported, never subtracted). */
  oofMean: number[];
  weightSum: number;
  ess: number;
  rows: number;
  rawEigenvalues: number[];
  eigenvalues: number[];
  epsilon: number;
  flooredCount: number;
  flooredMass: number;
  jacobiSweeps: number;
  warnings: string[];
}

export interface CovarianceFit {
  /** Σ_N (`params.residualCov`, training-v2). */
  residualCov: Matrix;
  /** √diag(Σ_N), exactly. */
  sigma: number[];
  /** Eigen factor L = V diag(√λ'). */
  factor: Matrix;
  diagnostics: CovarianceDiagnostics;
}

function checkMatrix(m: Matrix, what: string): void {
  if (m.length !== N_STATS || m.some((r) => r.length !== N_STATS)) {
    throw new NumericError('not-square', `${what} must be ${N_STATS}×${N_STATS}`);
  }
  for (const r of m)
    for (const x of r) if (!Number.isFinite(x)) throw new NumericError('non-finite', what);
}

/** ADR-0002 §2 steps 4–7. `maxSweeps` is exposed only to test the non-convergence error. */
export function estimateNonInheritanceCov(
  rows: readonly WeightedResidual[],
  maxSweeps?: number,
): CovarianceFit {
  if (rows.length === 0) throw new NumericError('non-finite', 'no training rows');
  let W = 0;
  let W2 = 0;
  const S = zeros(N_STATS);
  const C = zeros(N_STATS);
  const m = new Array<number>(N_STATS).fill(0);
  for (const r of rows) {
    if (!(r.w > 0) || !Number.isFinite(r.w)) {
      throw new NumericError('bad-weight', `weight of ${r.id} must be finite and > 0`);
    }
    if (r.e.length !== N_STATS || !r.e.every(Number.isFinite)) {
      throw new NumericError('non-finite', `residual of ${r.id}`);
    }
    checkMatrix(r.inhCov, `inhCov of ${r.id}`);
    W += r.w;
    W2 += r.w * r.w;
    for (let k = 0; k < N_STATS; k++) {
      m[k] = m[k]! + r.w * r.e[k]!;
      const sk = S[k]!;
      const ck = C[k]!;
      const ik = r.inhCov[k]!;
      for (let j = 0; j < N_STATS; j++) {
        sk[j] = sk[j]! + r.w * r.e[k]! * r.e[j]!;
        ck[j] = ck[j]! + r.w * ik[j]!;
      }
    }
  }
  for (let k = 0; k < N_STATS; k++) {
    m[k] = m[k]! / W;
    for (let j = 0; j < N_STATS; j++) {
      S[k]![j] = S[k]![j]! / W;
      C[k]![j] = C[k]![j]! / W;
    }
  }
  const raw = zeros(N_STATS);
  for (let k = 0; k < N_STATS; k++)
    for (let j = 0; j < N_STATS; j++) raw[k]![j] = S[k]![j]! - C[k]![j]!;
  const R = symmetrize(raw);
  const warnings: string[] = [];
  for (let k = 0; k < N_STATS; k++) {
    if (R[k]![k]! <= 0) {
      warnings.push(
        `stat ${k}: mean inheritance variance ${C[k]![k]!.toFixed(3)} ≥ total OOF second moment ${S[k]![k]!.toFixed(3)} (rules or lineage likely mis-specified)`,
      );
    }
  }
  const epsilon = EPS_REL * Math.max(1, trace(S) / N_STATS);
  const f = floorPsd(R, epsilon, maxSweeps);
  if (f.flooredCount > 0) {
    warnings.push(`${f.flooredCount} eigenvalue(s) floored to ε=${epsilon.toExponential(3)}`);
  }
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
      eigenvalues: f.eigenvalues,
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
  /** y − xβ with β from the train fit. */
  e: readonly number[];
  inhCov: Matrix;
  /** Holdout recency weight (clock = newest holdout row), bias diagnostic only. */
  w: number;
}

export interface Coverage {
  pooled: number;
  perStat: number[];
  cells: number;
}

/** 50 §4 erratum: pooled share of cells with |e| ≤ z0.9·√(Σ_N,kk + C_i,kk). */
export function gaussianCoverage(
  residualCov: Matrix,
  holdout: readonly HoldoutCell[],
  addInheritance = true,
): Coverage {
  const perStat = new Array<number>(N_STATS).fill(0);
  for (const r of holdout) {
    for (let k = 0; k < N_STATS; k++) {
      const v = residualCov[k]![k]! + (addInheritance ? r.inhCov[k]![k]! : 0);
      if (Math.abs(r.e[k]!) <= Z80 * Math.sqrt(v)) perStat[k] = perStat[k]! + 1;
    }
  }
  const n = holdout.length;
  return {
    pooled: n ? perStat.reduce((s, x) => s + x, 0) / (n * N_STATS) : NaN,
    perStat: perStat.map((x) => (n ? x / n : NaN)),
    cells: n * N_STATS,
  };
}

export interface HoldoutBias {
  mean: number[];
  se: number[];
  ess: number;
  /** Hotelling-type T² of the mean against 0 (NaN when the covariance is singular). */
  t2: number;
  /** χ²₅ 0.95 reference. */
  t2Critical: number;
}

/** Weighted holdout mean residual with SE and T²: a diagnostic, never subtracted or fed back. */
export function holdoutBias(holdout: readonly HoldoutCell[]): HoldoutBias {
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
        cov[k]![j] = cov[k]![j]! + (r.w * (r.e[k]! - mean[k]!) * (r.e[j]! - mean[j]!)) / W;
  const scale = W2 / (W * W);
  const vm = cov.map((row) => row.map((x) => x * scale));
  let t2: number;
  try {
    const sol = solveSpd(vm, mean);
    t2 = sol.reduce((s, x, k) => s + x * mean[k]!, 0);
  } catch {
    t2 = NaN; // singular (e.g. one holdout row): reported as NaN, never an error for the fit
  }
  return {
    mean,
    se: vm.map((r, k) => Math.sqrt(r[k]!)),
    ess: (W * W) / W2,
    t2,
    t2Critical: CHI2_5_95,
  };
}
