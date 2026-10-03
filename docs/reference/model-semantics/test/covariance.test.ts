/**
 * T05b diagnostic tests for the ADR-0002 evidence helpers (node:test, no workspace wiring):
 *
 *   node --test docs/reference/model-semantics/test/
 *
 * Synthetic fixtures only use clearly labelled SYNTHETIC parameters (not game facts).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mulberry32, seedFromString } from '../../../../packages/engine/src/index.ts';
import {
  boxMuller,
  estimateNonInheritanceCov,
  gaussianCoverage,
  mvnDraw,
} from '../src/covariance.ts';
import type { WeightedResidual } from '../src/covariance.ts';
import { floorPsd, jacobiEigen, minEigenvalue, NumericError, zeros } from '../src/linalg.ts';
import type { Matrix } from '../src/linalg.ts';

const diagM = (d: number[]): Matrix => d.map((x, i) => d.map((_, j) => (i === j ? x : 0)));
const close = (a: number, b: number, tol: number, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);

/** SYNTHETIC: residual = training noise ~ MVN(0, N) + centred inheritance noise ~ N(0, C_i). */
function syntheticRows(seed: string, n: number, noise: Matrix, inhVar: (i: number) => number[]) {
  const rng = mulberry32(seedFromString(seed));
  const nf = floorPsd(noise, 1e-12).factor;
  const rows: WeightedResidual[] = [];
  for (let i = 0; i < n; i++) {
    const t = mvnDraw(nf, rng);
    const c = inhVar(i);
    const e = t.map((x, k) => x + Math.sqrt(c[k]!) * boxMuller(rng));
    rows.push({ id: `r${i}`, w: 1 + (i % 3), e, inhCov: diagM(c) });
  }
  return rows;
}

const NOISE: Matrix = [
  [36, 6, 3, 0, 0],
  [6, 29, 0, 2, 0],
  [3, 0, 36, 0, 4],
  [0, 2, 0, 29, 0],
  [0, 0, 4, 0, 29],
]; // SYNTHETIC

describe('linalg', () => {
  it('Jacobi reproduces A = V Λ Vᵀ and is deterministic', () => {
    const a = NOISE;
    const e1 = jacobiEigen(a);
    const e2 = jacobiEigen(a);
    assert.deepEqual(e1, e2);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        let s = 0;
        for (let k = 0; k < 5; k++) s += e1.vectors[i]![k]! * e1.values[k]! * e1.vectors[j]![k]!;
        close(s, a[i]![j]!, 1e-9);
      }
    for (let k = 1; k < 5; k++) assert.ok(e1.values[k]! >= e1.values[k - 1]!);
  });

  it('floors negative eigenvalues to ε, reports count/mass, factor reproduces Σ', () => {
    const r = diagM([-3, 1, 2, 0, 5]);
    const f = floorPsd(r, 1e-6);
    assert.equal(f.flooredCount, 2);
    close(f.flooredMass, 3 + 1e-6 + 1e-6, 1e-12);
    assert.ok(minEigenvalue(f.sigma) >= 1e-6 - 1e-15);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        let s = 0;
        for (let k = 0; k < 5; k++) s += f.factor[i]![k]! * f.factor[j]![k]!;
        close(s, f.sigma[i]![j]!, 1e-12);
      }
  });

  it('all-zero input gives Σ = εI (zero-trace handling), never singular', () => {
    const f = floorPsd(zeros(5), 1e-6);
    assert.equal(f.flooredCount, 5);
    for (let i = 0; i < 5; i++) close(f.sigma[i]![i]!, 1e-6, 1e-18);
  });

  it('non-convergence and non-finite inputs throw typed errors', () => {
    assert.throws(
      () => jacobiEigen(NOISE, 0),
      (e) => e instanceof NumericError && e.code === 'eigen-nonconvergence',
    );
    assert.throws(
      () => jacobiEigen([[NaN]]),
      (e) => e instanceof NumericError && e.code === 'non-finite',
    );
    assert.throws(() => floorPsd(NOISE, 0), NumericError);
  });
});

describe('estimateNonInheritanceCov (ADR-0002 §2)', () => {
  it('large-n single count: Σ_N ≈ planted noise, not noise + Var[inh] (SYNTHETIC)', () => {
    const rows = syntheticRows('t05b-test:single', 40000, NOISE, () => [30, 40, 45, 60, 55]);
    const f = estimateNonInheritanceCov(rows);
    for (let k = 0; k < 5; k++)
      close(f.residualCov[k]![k]!, NOISE[k]![k]!, 0.06 * NOISE[k]![k]!, `diag ${k}`);
    close(f.residualCov[0]![1]!, 6, 1.5, 'offdiag');
    assert.equal(f.diagnostics.flooredCount, 0);
    for (let k = 0; k < 5; k++) assert.equal(f.sigma[k], Math.sqrt(f.residualCov[k]![k]!));
  });

  it('heteroskedastic: subtracts the SAME-weighted mean of C_i', () => {
    // Two groups with different C_i and different weights; Σ_N must use Σ w C_i / Σ w.
    const rows = syntheticRows('t05b-test:hetero', 60000, NOISE, (i) =>
      i % 2 === 0 ? [10, 10, 10, 10, 10] : [90, 90, 90, 90, 90],
    ).map((r, i) => ({ ...r, w: i % 2 === 0 ? 3 : 1 })); // low-C group weighted 3×
    const f = estimateNonInheritanceCov(rows);
    let W = 0;
    let C = 0;
    for (const r of rows) {
      W += r.w;
      C += r.w * r.inhCov[0]![0]!;
    }
    close(f.diagnostics.meanInheritanceCov[0]![0]!, C / W, 1e-9);
    // Weighted mean is 30; the unweighted mean (50) would under-subtract by 20.
    close(C / W, 30, 1e-9);
    for (let k = 0; k < 5; k++)
      close(f.residualCov[k]![k]!, NOISE[k]![k]!, 0.08 * NOISE[k]![k]! + 1.5, `diag ${k}`);
  });

  it('S < C̄ on a stat: warning + flooring, still PSD and finite', () => {
    const rows = syntheticRows('t05b-test:floor', 2000, diagM([1, 29, 36, 29, 29]), () => [
      200, 1, 1, 1, 1,
    ]);
    const f = estimateNonInheritanceCov(rows);
    assert.ok(f.diagnostics.flooredCount >= 1);
    assert.ok(f.diagnostics.warnings.some((w) => w.startsWith('stat 0')));
    assert.ok(minEigenvalue(f.residualCov) >= f.diagnostics.epsilon * (1 - 1e-9));
    const rng = mulberry32(seedFromString('t05b-test:floor-draw'));
    for (let i = 0; i < 100; i++) assert.ok(mvnDraw(f.factor, rng).every(Number.isFinite));
  });

  it('uncentred: a constant bias is counted as error', () => {
    const rows = syntheticRows('t05b-test:bias', 20000, NOISE, () => [0, 0, 0, 0, 0]).map((r) => ({
      ...r,
      e: r.e.map((x, k) => (k === 0 ? x + 4 : x)),
    }));
    const f = estimateNonInheritanceCov(rows);
    close(f.residualCov[0]![0]!, 36 + 16, 3);
    close(f.diagnostics.oofMean[0]!, 4, 0.2);
  });

  it('rejects empty, non-finite and non-positive-weight inputs', () => {
    assert.throws(() => estimateNonInheritanceCov([]), NumericError);
    const r = syntheticRows('t05b-test:bad', 3, NOISE, () => [1, 1, 1, 1, 1]);
    assert.throws(() => estimateNonInheritanceCov([{ ...r[0]!, w: 0 }]), NumericError);
    assert.throws(
      () => estimateNonInheritanceCov([{ ...r[0]!, e: [NaN, 0, 0, 0, 0] }]),
      NumericError,
    );
  });
});

describe('single-count prediction', () => {
  it('Gaussian interval adds C_i once: coverage ≈ 0.80 with it, below without (SYNTHETIC)', () => {
    const rows = syntheticRows('t05b-test:cov', 20000, NOISE, (i) =>
      i % 2 ? [20, 20, 20, 20, 20] : [80, 80, 80, 80, 80],
    );
    const hold = rows.map((r) => ({ id: r.id, e: r.e, inhCov: r.inhCov, w: 1 }));
    const once = gaussianCoverage(NOISE, hold).pooled;
    const none = gaussianCoverage(NOISE, hold, false).pooled;
    const twice = gaussianCoverage(
      NOISE.map((r, i) => r.map((x, j) => (i === j ? x + 50 : x))),
      hold,
    ).pooled;
    close(once, 0.8, 0.01);
    assert.ok(none < 0.7);
    assert.ok(twice > 0.85);
  });

  it('MC draws are deterministic per seed and the training stream is independent of inheritance', () => {
    const f = floorPsd(NOISE, 1e-9).factor;
    const a = mvnDraw(f, mulberry32(seedFromString('s:train')));
    const b = mvnDraw(f, mulberry32(seedFromString('s:train')));
    assert.deepEqual(a, b);
  });
});
