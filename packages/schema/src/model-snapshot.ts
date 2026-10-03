import { z } from 'zod';
import { STAT_KEYS, StatKey, TrainMode } from './enums.ts';
import { IsoUtc, NonEmpty, Ulid } from './primitives.ts';

const perStat = <T extends z.ZodType>(value: T) =>
  z.strictObject(Object.fromEntries(STAT_KEYS.map((k) => [k, value])) as Record<StatKey, T>);

const residualRow = z.array(z.number()).length(5);

/**
 * 01 §13 snapshot kinds (ADR-0002). The JSON shape is identical; the kind fixes the statistical
 * meaning of the numbers:
 * - `training-v1`: LEGACY. Accepted, stored and returned unchanged; its residualCov / sigma /
 *   skillAcquire meaning is unknown (pre-ADR-0002) and must never be reinterpreted. Prediction
 *   rejects it with a refit-required error (T06).
 * - `training-v2`: ADR-0002 semantics. residualCov = NON-inheritance training covariance (out-of-fold,
 *   inheritance subtracted once, PSD); sigma = √diag(residualCov); skillAcquire = Beta posterior of
 *   the CONDITIONAL rate P(acquired | actually hinted) under the exposure-aware likelihood.
 */
export const MODEL_SNAPSHOT_KINDS = ['training-v1', 'training-v2'] as const;
export const ModelSnapshotKind = z.enum(MODEL_SNAPSHOT_KINDS);
export type ModelSnapshotKind = z.infer<typeof ModelSnapshotKind>;

/** 01 §13. */
export const ModelSnapshot = z.strictObject({
  id: Ulid,
  kind: ModelSnapshotKind,
  masterVersion: NonEmpty,
  trainedAt: IsoUtc,
  nSamples: z.number().int().min(0),
  params: z.strictObject({
    features: z.array(z.string()),
    perStat: perStat(
      z.strictObject({ coef: z.array(z.number()), intercept: z.number(), sigma: z.number() }),
    ),
    /** 5x5 residual covariance; v2: non-inheritance training covariance, symmetric PSD (ADR-0002). */
    residualCov: z.array(residualRow).length(5),
    /**
     * Beta per train mode, keyed by skill ID or `'*'` (the global prior). v2: moment-matched Beta of
     * the posterior of P(acquired | actually hinted) under the exposure-aware likelihood (ADR-0002).
     */
    skillAcquire: z.strictObject({
      independent: z.record(z.string(), z.strictObject({ a: z.number(), b: z.number() })),
      manual: z.record(z.string(), z.strictObject({ a: z.number(), b: z.number() })),
    }) satisfies z.ZodType<Record<TrainMode, unknown>>,
    holdout: z.strictObject({ mae: perStat(z.number()), coverage80: z.number().min(0).max(1) }),
  }),
});
export type ModelSnapshot = z.infer<typeof ModelSnapshot>;
