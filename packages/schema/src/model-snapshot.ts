import { z } from 'zod';
import { STAT_KEYS, StatKey, TrainMode } from './enums.ts';
import { IsoUtc, NonEmpty, Ulid } from './primitives.ts';

const perStat = <T extends z.ZodType>(value: T) =>
  z.strictObject(Object.fromEntries(STAT_KEYS.map((k) => [k, value])) as Record<StatKey, T>);

const residualRow = z.array(z.number()).length(5);

/** 01 §13. */
export const ModelSnapshot = z.strictObject({
  id: Ulid,
  kind: z.literal('training-v1'),
  masterVersion: NonEmpty,
  trainedAt: IsoUtc,
  nSamples: z.number().int().min(0),
  params: z.strictObject({
    features: z.array(z.string()),
    perStat: perStat(
      z.strictObject({ coef: z.array(z.number()), intercept: z.number(), sigma: z.number() }),
    ),
    /** 5x5 residual covariance. */
    residualCov: z.array(residualRow).length(5),
    /** Beta prior per train mode, keyed by skill ID or `'*'`. */
    skillAcquire: z.strictObject({
      independent: z.record(z.string(), z.strictObject({ a: z.number(), b: z.number() })),
      manual: z.record(z.string(), z.strictObject({ a: z.number(), b: z.number() })),
    }) satisfies z.ZodType<Record<TrainMode, unknown>>,
    holdout: z.strictObject({ mae: perStat(z.number()), coverage80: z.number().min(0).max(1) }),
  }),
});
export type ModelSnapshot = z.infer<typeof ModelSnapshot>;
