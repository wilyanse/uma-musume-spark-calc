/**
 * T05b EVIDENCE helper (not production engine code): deterministic dense symmetric linear algebra
 * used by the ADR-0002 covariance estimator. T06 re-implements the same rules in
 * `packages/engine/src/linalg.ts`; this file is the executable reference for the spec text.
 *
 * Plain erasable TypeScript, no dependencies.
 */

export type Matrix = number[][];

export class NumericError extends Error {
  readonly code: 'non-finite' | 'not-square' | 'eigen-nonconvergence' | 'not-psd';
  constructor(code: NumericError['code'], message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'NumericError';
  }
}

export const zeros = (n: number, m = n): Matrix =>
  Array.from({ length: n }, () => new Array<number>(m).fill(0));
export const identity = (n: number): Matrix =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
export const trace = (a: Matrix): number => a.reduce((s, r, i) => s + r[i]!, 0);

function assertSquareFinite(a: Matrix, what: string): number {
  const n = a.length;
  for (const r of a) {
    if (r.length !== n) throw new NumericError('not-square', `${what} is not square`);
    for (const x of r) if (!Number.isFinite(x)) throw new NumericError('non-finite', `${what}`);
  }
  return n;
}

/** (A + Aᵀ) / 2, exactly symmetric. */
export function symmetrize(a: Matrix): Matrix {
  const n = assertSquareFinite(a, 'symmetrize input');
  const out = zeros(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) out[i]![j] = i === j ? a[i]![i]! : (a[i]![j]! + a[j]![i]!) / 2;
  return out;
}

export interface Eigen {
  /** Ascending. */
  values: number[];
  /** Column k of `vectors` (vectors[i][k]) is the unit eigenvector of values[k]. */
  vectors: Matrix;
  sweeps: number;
}

export const JACOBI_MAX_SWEEPS = 100;
export const JACOBI_REL_TOL = 1e-12;

/**
 * Cyclic Jacobi eigen-decomposition of a symmetric matrix.
 *
 * Deterministic: fixed row-major sweep order (p < q), rotation formula of Golub & Van Loan
 * §8.5.2, stop when off(A) = sqrt(Σ_{p≠q} a_pq²) ≤ 1e-12 · max(1, ‖A₀‖_F), at most 100 sweeps
 * (throws `eigen-nonconvergence` otherwise; a 5×5 needs < 10). Output: ascending eigenvalues;
 * each eigenvector's largest-|component| entry (first on a tie) is made positive, so the factor
 * V·diag(√λ) is reproducible bit-for-bit on the same IEEE-754 platform.
 */
export function jacobiEigen(input: Matrix, maxSweeps = JACOBI_MAX_SWEEPS): Eigen {
  const n = assertSquareFinite(input, 'jacobiEigen input');
  const a = symmetrize(input);
  const v = identity(n);
  let fro = 0;
  for (const r of a) for (const x of r) fro += x * x;
  const tol = JACOBI_REL_TOL * Math.max(1, Math.sqrt(fro));
  const off = () => {
    let s = 0;
    for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) if (p !== q) s += a[p]![q]! ** 2;
    return Math.sqrt(s);
  };
  let sweeps = 0;
  while (off() > tol) {
    if (sweeps >= maxSweeps)
      throw new NumericError('eigen-nonconvergence', `off=${off()} after ${sweeps} sweeps`);
    sweeps++;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (apq === 0) continue;
        const tau = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => a[i]![i]! - a[j]![j]! || i - j,
  );
  const values = order.map((i) => a[i]![i]!);
  const vectors = zeros(n);
  order.forEach((src, k) => {
    let big = 0;
    for (let i = 1; i < n; i++) if (Math.abs(v[i]![src]!) > Math.abs(v[big]![src]!)) big = i;
    const sign = v[big]![src]! < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) vectors[i]![k] = sign * v[i]![src]!;
  });
  return { values, vectors, sweeps };
}

export interface PsdFloor {
  /** V diag(λ') Vᵀ, symmetrised. */
  sigma: Matrix;
  /** V diag(√λ'): sigma = factor · factorᵀ. Use it (not Cholesky) to sample. */
  factor: Matrix;
  /** Eigenvalues of the symmetrised input, ascending, before flooring. */
  rawEigenvalues: number[];
  epsilon: number;
  flooredCount: number;
  /** Σ (λ' − λ) over floored eigenvalues. */
  flooredMass: number;
  sweeps: number;
}

/**
 * Deterministic PSD projection by eigenvalue flooring: λ' = max(λ, ε). `epsilon` is passed in
 * (ADR-0002: ε = 1e-6 · max(1, tr(S)/n) with S the TOTAL residual second moment, so an all-zero
 * input gives ε = 1e-6 and Σ = εI rather than a singular matrix).
 */
export function floorPsd(r: Matrix, epsilon: number, maxSweeps = JACOBI_MAX_SWEEPS): PsdFloor {
  if (!(epsilon > 0) || !Number.isFinite(epsilon))
    throw new NumericError('non-finite', 'epsilon must be finite and > 0');
  const sym = symmetrize(r);
  const n = sym.length;
  const { values, vectors, sweeps } = jacobiEigen(sym, maxSweeps);
  let flooredCount = 0;
  let flooredMass = 0;
  const lam = values.map((x) => {
    if (x < epsilon) {
      flooredCount++;
      flooredMass += epsilon - x;
      return epsilon;
    }
    return x;
  });
  const factor = zeros(n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) factor[i]![k] = vectors[i]![k]! * Math.sqrt(lam[k]!);
  const raw = zeros(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += factor[i]![k]! * factor[j]![k]!;
      raw[i]![j] = s;
    }
  return {
    sigma: symmetrize(raw),
    factor,
    rawEigenvalues: values,
    epsilon,
    flooredCount,
    flooredMass,
    sweeps,
  };
}

/** Smallest eigenvalue (for PSD assertions). */
export const minEigenvalue = (a: Matrix): number => jacobiEigen(a).values[0]!;

/** Solves A x = b for symmetric positive-definite A (Cholesky); used for T² diagnostics only. */
export function solveSpd(a: Matrix, b: number[]): number[] {
  const n = assertSquareFinite(a, 'solveSpd');
  const l = zeros(n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (!(s > 0)) throw new NumericError('not-psd', 'solveSpd: not positive definite');
        l[i]![i] = Math.sqrt(s);
      } else l[i]![j] = s / l[j]![j]!;
    }
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[i]![k]! * z[k]!;
    z[i] = s / l[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k]![i]! * x[k]!;
    x[i] = s / l[i]![i]!;
  }
  return x;
}
