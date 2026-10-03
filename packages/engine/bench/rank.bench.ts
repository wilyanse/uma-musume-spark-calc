/**
 * 50 §7.5 performance budget: the full ranking pipeline on 260 veterans in < 5 s (Node, dev Mac).
 *
 * Measured work per iteration (nothing is cached across iterations): snapshot validation and the
 * eigen factor (`prepareModel`), plan features, the inheritance plan + closed form + Gaussian fast
 * pass for EVERY legal pair, the full seeded Monte Carlo (2000 draws) for the top 100 and the top
 * 50 results. A second task adds the `fitTrainingModel` fit (5-fold CV, Σ_N, skill posteriors) on
 * the same roster before ranking. Policy: 1 warmup iteration, then at least 5 measured iterations
 * (time budget 0, so exactly the iteration minimum). The assertions use the slowest measured run.
 */
import { expect, test } from 'vitest';
import { fitTrainingModel, rankPairsDetailed } from '../src/index.ts';
import { ctx, fitOpts, goldenFit, planInput, roster, target } from '../test/model/golden-fit.ts';

const BUDGET_MS = 5000;
const RUN = { iterations: 5, time: 0, warmupIterations: 1, warmupTime: 0 };

test('rankPairs: 260 veterans, all legal pairs, top-100 MC × 2000, top-50', async ({ bench }) => {
  expect(roster).toHaveLength(260);
  const snapshot = goldenFit().snapshot;
  let pairs = 0;
  let best = '';
  const r = await bench('rankPairs (260 veterans)', () => {
    const res = rankPairsDetailed(ctx, snapshot, planInput, roster, target);
    pairs = res.evaluatedPairs;
    best = res.results[0]!.parents.join('|');
  }).run(RUN);
  console.info(
    `[T06 bench] rankPairs legal pairs ${pairs}, #1 ${best}; samples ${r.latency.samplesCount}, mean ${r.latency.mean.toFixed(1)} ms, min ${r.latency.min.toFixed(1)} ms, max ${r.latency.max.toFixed(1)} ms; node ${process.version} ${process.platform}/${process.arch}`,
  );
  expect(pairs).toBe(32667);
  expect(r.latency.samplesCount).toBeGreaterThanOrEqual(5);
  expect(r.latency.max).toBeLessThan(BUDGET_MS);
});

test('fit + rank: fitTrainingModel then rankPairs on 260 veterans', async ({ bench }) => {
  let pairs = 0;
  const r = await bench('fitTrainingModel + rankPairs (260 veterans)', () => {
    const snapshot = fitTrainingModel(ctx, roster, fitOpts());
    pairs = rankPairsDetailed(ctx, snapshot, planInput, roster, target).evaluatedPairs;
  }).run(RUN);
  console.info(
    `[T06 bench] fit+rank legal pairs ${pairs}; samples ${r.latency.samplesCount}, mean ${r.latency.mean.toFixed(1)} ms, min ${r.latency.min.toFixed(1)} ms, max ${r.latency.max.toFixed(1)} ms`,
  );
  expect(r.latency.samplesCount).toBeGreaterThanOrEqual(5);
  expect(r.latency.max).toBeLessThan(BUDGET_MS);
});
