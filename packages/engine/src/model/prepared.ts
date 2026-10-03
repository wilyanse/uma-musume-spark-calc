/**
 * A `training-v2` snapshot prepared for prediction (ADR-0002 §4 version guard). `training-v1`
 * is legacy with unknown semantics and is rejected with `RefitRequiredError`, never reinterpreted.
 */
import { ModelSnapshot, STAT_KEYS } from '@uma/schema';
import type { TrainMode } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import { eigenFactor } from '../linalg.ts';
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
  const factor = eigenFactor(residualCov);
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
