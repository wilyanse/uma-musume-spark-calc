/**
 * Small dense deterministic linear algebra for the training model (50 §4, ADR-0002 §2.7).
 * Pure TypeScript, no dependencies, browser-safe.
 *
 * - `choleskyFactor` / `choleskySolve`: the ridge normal equations (symmetric positive definite).
 * - `jacobiEigen`: cyclic Jacobi eigen-decomposition with the exact ADR-0002 conventions.
 * - `floorPsd`: deterministic PSD projection λ' = max(λ, ε) with diagnostics and the eigen factor
 *   L = V diag(√λ') used for Monte Carlo draws (never Cholesky, ADR-0002 §2.10).
 */

export type Matrix = number[][];

export type NumericErrorCode =
  'non-finite' | 'not-square' | 'eigen-nonconvergence' | 'not-positive-definite' | 'bad-weight';

/** Typed numerical failure. Never swallowed: callers see the exact code. */
export class NumericError extends Error {
  override name = 'NumericError';
  readonly code: NumericErrorCode;
  constructor(code: NumericErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export const zeros = (n: number, m = n): Matrix =>
  Array.from({ length: n }, () => new Array<number>(m).fill(0));

export const identity = (n: number): Matrix =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

export function trace(a: Matrix): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]![i]!;
  return s;
}

function assertSquareFinite(a: Matrix, what: string): number {
  const n = a.length;
  for (const r of a) {
    if (r.length !== n) throw new NumericError('not-square', `${what} is not square`);
    for (const x of r) if (!Number.isFinite(x)) throw new NumericError('non-finite', what);
  }
  return n;
}

/** sym(A) = (A + Aᵀ)/2, exactly symmetric (out[i][j] and out[j][i] are the same float). */
export function symmetrize(a: Matrix): Matrix {
  const n = assertSquareFinite(a, 'symmetrize input');
  const out = zeros(n);
  for (let i = 0; i < n; i++) {
    out[i]![i] = a[i]![i]!;
    for (let j = i + 1; j < n; j++) {
      const v = (a[i]![j]! + a[j]![i]!) / 2;
      out[i]![j] = v;
      out[j]![i] = v;
    }
  }
  return out;
}

export interface Eigen {
  /** Ascending; ties keep the original diagonal index order. */
  values: number[];
  /** Column k (`vectors[i][k]`) is the unit eigenvector of `values[k]`. */
  vectors: Matrix;
  sweeps: number;
}

export const JACOBI_MAX_SWEEPS = 100;
export const JACOBI_REL_TOL = 1e-12;

/**
 * Cyclic Jacobi (ADR-0002 §2.7): fixed row-major (p<q) sweep order, Golub–Van Loan §8.5.2
 * rotation, stop when off(A) ≤ 1e-12·max(1, ‖A‖_F), at most `maxSweeps` sweeps (else a typed
 * `eigen-nonconvergence`), eigenvalues ascending (ties by original index), and each eigenvector's
 * largest-|component| entry (first on a tie) made positive.
 */
export function jacobiEigen(input: Matrix, maxSweeps = JACOBI_MAX_SWEEPS): Eigen {
  const n = assertSquareFinite(input, 'jacobiEigen input');
  const a = symmetrize(input);
  const v = identity(n);
  let fro = 0;
  for (const r of a) for (const x of r) fro += x * x;
  const tol = JACOBI_REL_TOL * Math.max(1, Math.sqrt(fro));
  const off = (): number => {
    let s = 0;
    for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) if (p !== q) s += a[p]![q]! ** 2;
    return Math.sqrt(s);
  };
  let sweeps = 0;
  while (off() > tol) {
    if (sweeps >= maxSweeps) {
      throw new NumericError('eigen-nonconvergence', `off=${off()} after ${sweeps} sweeps`);
    }
    sweeps++;
    for (let p = 0; p < n - 1; p++) {
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
  /** sym(V diag(λ') Vᵀ). */
  sigma: Matrix;
  /** L = V diag(√λ'), so sigma = L Lᵀ (up to rounding). */
  factor: Matrix;
  /** Eigenvalues of sym(input), ascending, before flooring. */
  rawEigenvalues: number[];
  /** Eigenvalues after flooring. */
  eigenvalues: number[];
  epsilon: number;
  flooredCount: number;
  /** Σ (λ' − λ) over the floored eigenvalues. */
  flooredMass: number;
  sweeps: number;
}

/** Deterministic PSD projection by eigenvalue flooring (ADR-0002 §2.7). */
export function floorPsd(r: Matrix, epsilon: number, maxSweeps = JACOBI_MAX_SWEEPS): PsdFloor {
  if (!(epsilon > 0) || !Number.isFinite(epsilon)) {
    throw new NumericError('non-finite', 'epsilon must be finite and > 0');
  }
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
    eigenvalues: lam,
    epsilon,
    flooredCount,
    flooredMass,
    sweeps,
  };
}

/**
 * Eigen factor L = V diag(√max(λ, 0)) of an already-PSD matrix (a stored `residualCov`). Used
 * at prediction so MC draws use the same factorisation family as the fit (ADR-0002 §2.10).
 */
export function eigenFactor(a: Matrix): Matrix {
  const { values, vectors } = jacobiEigen(a);
  const n = values.length;
  const f = zeros(n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < n; k++) f[i]![k] = vectors[i]![k]! * Math.sqrt(Math.max(0, values[k]!));
  return f;
}

/** Lower Cholesky factor of a dense SPD matrix stored as rows of Float64Array. */
export function choleskyFactor(a: readonly Float64Array[]): Float64Array[] {
  const n = a.length;
  const l = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const li = l[i]!;
    const ai = a[i]!;
    for (let j = 0; j <= i; j++) {
      const lj = l[j]!;
      let s = ai[j]!;
      for (let k = 0; k < j; k++) s -= li[k]! * lj[k]!;
      if (i === j) {
        if (!(s > 0) || !Number.isFinite(s)) {
          throw new NumericError('not-positive-definite', `pivot ${i} = ${s}`);
        }
        li[i] = Math.sqrt(s);
      } else li[j] = s / lj[j]!;
    }
  }
  return l;
}

/** Solves L Lᵀ x = b. */
export function choleskySolve(l: readonly Float64Array[], b: ArrayLike<number>): Float64Array {
  const n = l.length;
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const li = l[i]!;
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= li[k]! * z[k]!;
    z[i] = s / li[i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k]![i]! * x[k]!;
    x[i] = s / l[i]![i]!;
  }
  return x;
}

/** Solves A x = b for a small SPD `Matrix` (diagnostics, e.g. Hotelling T²). */
export function solveSpd(a: Matrix, b: readonly number[]): number[] {
  assertSquareFinite(a, 'solveSpd');
  return [...choleskySolve(choleskyFactor(a.map((r) => Float64Array.from(r))), b)];
}
