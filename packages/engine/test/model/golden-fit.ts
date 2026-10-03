/**
 * Shared golden fixtures for the T06 tests: the committed T08 roster/targets/truth, the golden
 * engine context (`loadGoldenContext`, the documented synthetic rules/turns), and a fit on the
 * STORED split passed through the explicit `FitOptions.split` (no fixture ids in production code).
 * Planted values from truth.json are only read by the acceptance assertions themselves (Q-122
 * card effects, best/trap pair ids) and never feed an estimator.
 */
import { loadGoldenContext } from '../../scripts/golden-context.ts';
import { fitTrainingModelDetailed } from '../../src/index.ts';
import type { FitOptions, PlanInput, TrainingFit } from '../../src/index.ts';
import { master, roster, targets, truth } from '../golden/load.ts';

export { master, roster, targets, truth };
export const ctx = loadGoldenContext(master, truth);
export const target = targets.find((t) => t.name === truth.golden.targetName)!;
export const storedSplit = {
  trainIds: truth.holdout.trainIds,
  holdoutIds: truth.holdout.holdoutIds,
};
/** Injected identity and clock, so snapshots are deterministic. */
export const FIXED_ID = '01KGQZ0000G01DENCM0000T06A';
export const FIXED_NOW = new Date('2026-10-01T00:00:00.000Z');
export const fitOpts = (extra: Partial<FitOptions> = {}): FitOptions => ({
  split: storedSplit,
  id: () => FIXED_ID,
  now: () => FIXED_NOW,
  ...extra,
});

let cached: TrainingFit | undefined;
/** The stored-split fit (computed once per test file). */
export function goldenFit(): TrainingFit {
  cached ??= fitTrainingModelDetailed(ctx, roster, fitOpts());
  return cached;
}

export const planInput: PlanInput = {
  traineeOutfitId: truth.golden.traineeOutfitId,
  deck: truth.golden.planDeck,
  trainMode: truth.golden.trainMode,
  scenarioId: truth.golden.scenarioId,
};

export const byId = new Map(roster.map((v) => [v.id, v]));
