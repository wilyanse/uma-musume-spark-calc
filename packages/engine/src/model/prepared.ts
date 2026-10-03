/**
 * A `training-v2` snapshot prepared for prediction (ADR-0002 §4 version guard). `training-v1`
 * is legacy with unknown semantics and is rejected with `RefitRequiredError`, never reinterpreted.
 */
import { ModelSnapshot, STAT_KEYS } from '@uma/schema';
import type { TrainMode } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import { factorFromEigen, jacobiEigen } from '../linalg.ts';
import type { Matrix } from '../linalg.ts';
import { RefitRequiredError } from './errors.ts';
import { MODEL_KIND } from './fit.ts';
import { betaMoments } from './skills.ts';

export interface PreparedModel {
  snapshot: ModelSnapshot;
  names: string[];
  index: Map<string, number>;
  /** Per stat: [intercept, ...coef]. */
  beta: Float64Array[];
  residualCov: Matrix;
  /** L = V diag(√λ) of residualCov (eigen factor, never Cholesky). */
  factor: Matrix;
  /** E[θ_{mode,skill}] (posterior mean); '*' = global prior mean. */
  theta(mode: TrainMode, skillId: string): { mean: number; fromPrior: boolean };
}

/**
 * Floating-point tolerances of the v2 residualCov contract check (T06 review S1). A snapshot from
 * `fitTrainingModel` is exactly symmetric (`symmetrize` writes both halves from one float), its
 * σ is exactly `Math.sqrt(diag)`, and its eigenvalues are floored to ε > 0, all of which survive a
 * JSON round-trip bit-for-bit. The tolerances only absorb roundoff, never a contract violation:
 *
 * - symmetry: exact (`c[i][j] === c[j][i]`), no tolerance;
 * - diagonal: strictly > 0 (a fitted diagonal is ≥ the floored λ_min > 0);
 * - σ: |σ − √diag| ≤ SIGMA_REL_TOL·√diag, i.e. a few ulps, for a re-serialised snapshot;
 * - eigenvalues: λ_min ≥ −EIGEN_REL_TOL·max(1, ‖Σ‖_F). Jacobi stops at off(A) ≤ 1e-12·max(1,
 *   ‖A‖_F), and by Weyl's bound a computed eigenvalue is off by at most that much, so 1e-9 leaves
 *   1000× headroom for roundoff while a materially indefinite matrix is rejected. The fit's
 *   S-based ε cannot be recomputed from the snapshot and is not used here; λ in [−tol, 0) is
 *   roundoff of a PSD matrix and is factored as 0, exactly as before.
 *
 * The check reuses the single eigendecomposition `prepareModel` already needs for the MC factor,
 * so it costs nothing per pair.
 */
export const SIGMA_REL_TOL = 4 * Number.EPSILON;
export const EIGEN_REL_TOL = 1e-9;

function checkedFactor(kind: string, cov: Matrix, sigma: readonly number[]): Matrix {
  const bad = (detail: string): never => {
    throw new RefitRequiredError(kind, 'malformed', `residualCov violates training-v2: ${detail}`);
  };
  const n = cov.length;
  let fro = 0;
  for (let i = 0; i < n; i++) {
    const d = cov[i]![i]!;
    if (!(d > 0)) bad(`diagonal ${i} is ${d} (must be > 0)`);
    const sd = Math.sqrt(d);
    if (!(Math.abs(sigma[i]! - sd) <= SIGMA_REL_TOL * sd)) {
      bad(`perStat.${STAT_KEYS[i]}.sigma ${sigma[i]} is not √diag ${sd}`);
    }
    for (let j = 0; j < n; j++) {
      if (cov[i]![j] !== cov[j]![i]) bad(`not symmetric at [${i}][${j}]`);
      fro += cov[i]![j]! ** 2;
    }
  }
  let eig;
  try {
    eig = jacobiEigen(cov);
  } catch (e) {
    return bad((e as Error).message);
  }
  const tol = EIGEN_REL_TOL * Math.max(1, Math.sqrt(fro));
  if (!(eig.values[0]! >= -tol)) bad(`eigenvalue ${eig.values[0]} < −${tol} (not PSD)`);
  return factorFromEigen(eig);
}

/** Validates and prepares a snapshot. Throws `RefitRequiredError` for anything but valid v2. */
export function prepareModel(ctx: EngineContext, snapshot: unknown): PreparedModel {
  const kind =
    typeof snapshot === 'object' && snapshot !== null && 'kind' in snapshot
      ? String((snapshot as { kind: unknown }).kind)
      : 'missing';
  if (kind === 'training-v1') {
    throw new RefitRequiredError(
      kind,
      'legacy-kind',
      'training-v1 has pre-ADR-0002 semantics that cannot be reinterpreted; refit to training-v2',
    );
  }
  if (kind !== MODEL_KIND) {
    throw new RefitRequiredError(kind, 'unknown-kind', `expected ${MODEL_KIND}`);
  }
  const parsed = ModelSnapshot.safeParse(snapshot);
  if (!parsed.success) {
    throw new RefitRequiredError(kind, 'malformed', parsed.error.message);
  }
  const snap = parsed.data;
  if (snap.masterVersion !== ctx.masterVersion) {
    throw new RefitRequiredError(
      kind,
      'master-version-mismatch',
      `snapshot ${snap.masterVersion} vs context ${ctx.masterVersion} (ADR-0002 §2.11)`,
    );
  }
  const names = [...snap.params.features];
  for (const k of STAT_KEYS) {
    const ps = snap.params.perStat[k];
    if (ps.coef.length !== names.length || ![ps.intercept, ...ps.coef].every(Number.isFinite)) {
      throw new RefitRequiredError(kind, 'malformed', `perStat.${k}.coef does not match features`);
    }
  }
  const beta = STAT_KEYS.map((k) => {
    const ps = snap.params.perStat[k];
    return Float64Array.from([ps.intercept, ...ps.coef]);
  });
  const residualCov = snap.params.residualCov.map((r) => [...r]);
  if (!residualCov.every((r) => r.every(Number.isFinite))) {
    throw new RefitRequiredError(kind, 'malformed', 'residualCov is not finite');
  }
  const factor = checkedFactor(
    kind,
    residualCov,
    STAT_KEYS.map((k) => snap.params.perStat[k].sigma),
  );
  const means = new Map<string, number>();
  for (const mode of ['independent', 'manual'] as const) {
    if (!snap.params.skillAcquire[mode]['*']) {
      throw new RefitRequiredError(kind, 'malformed', `skillAcquire.${mode} has no '*' prior`);
    }
    for (const [s, p] of Object.entries(snap.params.skillAcquire[mode])) {
      if (!(p.a > 0 && p.b > 0)) {
        throw new RefitRequiredError(kind, 'malformed', `skillAcquire.${mode}.${s}`);
      }
      means.set(`${mode}|${s}`, betaMoments(p).mean);
    }
  }
  return {
    snapshot: snap,
    names,
    index: new Map(names.map((n, i) => [n, i])),
    beta,
    residualCov,
    factor,
    theta(mode, skillId) {
      const own = means.get(`${mode}|${skillId}`);
      if (own !== undefined) return { mean: own, fromPrior: false };
      return { mean: means.get(`${mode}|*`)!, fromPrior: true };
    },
  };
}
