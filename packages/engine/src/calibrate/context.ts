/**
 * Candidate rules contexts. `withBlueStatGainMultiplier` builds a NEW `EngineContext` whose
 * `blueStatGain` table is the input's × m. The input context, its rules and tables are never
 * mutated; the shared read-only master maps are reused by reference.
 */
import type { EngineContext, PerStar } from '../context.ts';
import { ModelInputError } from '../model/errors.ts';

export function withBlueStatGainMultiplier(ctx: EngineContext, m: number): EngineContext {
  if (!Number.isFinite(m) || m < 0) {
    throw new ModelInputError('bad-multiplier', `blueStatGain multiplier ${m}`);
  }
  const t = ctx.tables.blueStatGain;
  const scaled: PerStar = [t[0] * m, t[1] * m, t[2] * m];
  if (!scaled.every(Number.isFinite)) {
    throw new ModelInputError('non-finite', `blueStatGain × ${m}`);
  }
  const src = ctx.rules.blueStatGain;
  return {
    ...ctx,
    rules: {
      ...ctx.rules,
      version: m === 1 ? ctx.rules.version : `${ctx.rules.version}+t15-blueStatGain×${m}`,
      blueStatGain: {
        ...src,
        '1': scaled[0],
        '2': scaled[1],
        '3': scaled[2],
        verified: false,
        source:
          m === 1
            ? src.source
            : `${src.source} | T15 calibration CANDIDATE ×${m} (not applied, unverified)`,
      },
    },
    tables: { ...ctx.tables, blueStatGain: scaled },
    unverifiedRules: ctx.unverifiedRules.includes('blueStatGain')
      ? [...ctx.unverifiedRules]
      : [...ctx.unverifiedRules, 'blueStatGain'],
    placeholderRules: [...ctx.placeholderRules],
    warnings: [...ctx.warnings],
  };
}
