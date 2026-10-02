/**
 * T05b EVIDENCE: SYNTHETIC Q-124 fixtures. Every parameter here is an arbitrary, clearly labelled
 * synthetic value chosen to exercise the estimator; none is a game fact or a golden-data value.
 */
import { mulberry32, seedFromString } from '../../../../packages/engine/src/index.ts';
import { skillPosterior } from './skills.ts';
import type { BetaParams, Exposure } from './skills.ts';

export interface SyntheticCase {
  label: string;
  theta: number;
  prior: BetaParams;
  rows: Exposure[];
}

/** n rows, q_i ~ U(qLo, qHi) (q = 1 when qLo = qHi = 1), y_i ~ Bernoulli(q_i θ); seeded. */
export function syntheticRows(
  seed: string,
  n: number,
  theta: number,
  qLo: number,
  qHi: number,
): Exposure[] {
  const rng = mulberry32(seedFromString(seed));
  return Array.from({ length: n }, () => {
    const q = qLo === qHi ? qLo : qLo + (qHi - qLo) * rng();
    const y: 0 | 1 = rng() < q * theta ? 1 : 0;
    return { q, y };
  });
}

/** The literal 50 §4 reading: every candidate row counts as hinted (q ignored), conjugate Beta. */
export function naiveBeta(prior: BetaParams, rows: readonly Exposure[]): BetaParams {
  let a = prior.a;
  let b = prior.b;
  for (const r of rows) {
    if (r.q === 0) continue;
    if (r.y === 1) a++;
    else b++;
  }
  return { a, b };
}

/**
 * Repeated-sampling check (SYNTHETIC): for `reps` seeded datasets with known θ, the share of
 * datasets whose |θ̂ − θ| ≤ z0.9·sd (posterior sd), plus mean bias, for the exposure posterior and
 * the naive Beta. A coherent estimator gives ≈ 0.80 (the prior is weak relative to n).
 */
export function repeatedSampling(opts: {
  seed: string;
  reps: number;
  n: number;
  theta: number;
  qLo: number;
  qHi: number;
  prior: BetaParams;
}) {
  const z = 1.2815515655446004;
  let biasE = 0;
  let biasN = 0;
  let inE = 0;
  let inN = 0;
  for (let r = 0; r < opts.reps; r++) {
    const rows = syntheticRows(`${opts.seed}:${r}`, opts.n, opts.theta, opts.qLo, opts.qHi);
    const e = skillPosterior(opts.prior, rows);
    const nb = naiveBeta(opts.prior, rows);
    const nm = nb.a / (nb.a + nb.b);
    const nsd = Math.sqrt((nb.a * nb.b) / ((nb.a + nb.b) ** 2 * (nb.a + nb.b + 1)));
    biasE += e.mean - opts.theta;
    biasN += nm - opts.theta;
    if (Math.abs(e.mean - opts.theta) <= z * Math.sqrt(e.variance)) inE++;
    if (Math.abs(nm - opts.theta) <= z * nsd) inN++;
  }
  return {
    exposure: { meanBias: biasE / opts.reps, within80: inE / opts.reps },
    naive: { meanBias: biasN / opts.reps, within80: inN / opts.reps },
  };
}
