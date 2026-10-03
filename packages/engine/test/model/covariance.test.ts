/**
 * 50 §9 T06 item 4 (single count) and ADR-0002 §2: the Σ_N estimator on SYNTHETIC fixtures with
 * known noise. Every parameter here is a labelled synthetic value, not a game fact.
 */
import { describe, expect, it } from 'vitest';
import {
  estimateNonInheritanceCov,
  floorPsd,
  gaussianCoverage,
  jacobiEigen,
  mulberry32,
  NumericError,
  seedFromString,
} from '../../src/index.ts';
import type { Matrix, WeightedResidual } from '../../src/index.ts';
import { boxMuller } from '../../src/predict/normal.ts';

const NOISE: Matrix = [
  [36, 6, 3, 0, 0],
  [6, 29, 0, 2, 0],
  [3, 0, 36, 0, 4],
  [0, 2, 0, 29, 0],
  [0, 0, 4, 0, 29],
]; // SYNTHETIC
const diag = (d: number[]): Matrix => d.map((x, i) => d.map((_, j) => (i === j ? x : 0)));

/** SYNTHETIC rows: e = training noise ~ MVN(0, NOISE) + inheritance noise ~ N(0, C_i). */
function rows(
  seed: string,
  n: number,
  inhVar: (i: number) => number[],
  w: (i: number) => number,
  noise: Matrix = NOISE,
): WeightedResidual[] {
  const rng = mulberry32(seedFromString(seed));
  const L = floorPsd(noise, 1e-12).factor;
  return Array.from({ length: n }, (_, i) => {
    const z = Array.from({ length: 5 }, () => boxMuller(rng));
    const c = inhVar(i);
    const e = L.map(
      (row, k) => row.reduce((s, x, j) => s + x * z[j]!, 0) + Math.sqrt(c[k]!) * boxMuller(rng),
    );
    return { id: `r${i}`, w: w(i), e, inhCov: diag(c) };
  });
}

describe('Σ_N estimator (ADR-0002 §2)', () => {
  it('recovers a known noise covariance WITHOUT the inheritance variance (SYNTHETIC)', () => {
    const r = rows(
      't06:cov:known',
      40000,
      (i) => (i % 2 ? [20, 20, 20, 20, 20] : [80, 60, 40, 30, 10]),
      () => 1,
    );
    const f = estimateNonInheritanceCov(r);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        expect(Math.abs(f.residualCov[i]![j]! - NOISE[i]![j]!)).toBeLessThan(2.5);
    // The total second moment contains the inheritance variance; Σ_N does not.
    expect(f.diagnostics.totalSecondMoment[0]![0]!).toBeGreaterThan(80);
    expect(f.diagnostics.meanInheritanceCov[0]![0]).toBeCloseTo(50, 12);
    expect(f.diagnostics.warnings).toEqual([]);
  });

  it('subtracts the SAME-weighted C̄ (two-group weighted fixture)', () => {
    // Group A (weight 3) has inheritance variance 80, group B (weight 1) has 20 (SYNTHETIC).
    const r = rows(
      't06:cov:weighted',
      40000,
      (i) => (i % 2 ? [20, 20, 20, 20, 20] : [80, 80, 80, 80, 80]),
      (i) => (i % 2 ? 1 : 3),
    );
    const f = estimateNonInheritanceCov(r);
    const weighted = (3 * 80 + 1 * 20) / 4; // 65
    const unweighted = (80 + 20) / 2; // 50
    for (let k = 0; k < 5; k++) {
      expect(f.diagnostics.meanInheritanceCov[k]![k]).toBeCloseTo(weighted, 10);
      // Σ_N,kk = S_kk − 65 recovers the noise; S_kk − 50 would overstate it by 15.
      expect(Math.abs(f.residualCov[k]![k]! - NOISE[k]![k]!)).toBeLessThan(2.5);
      expect(f.diagnostics.totalSecondMoment[k]![k]! - unweighted - NOISE[k]![k]!).toBeGreaterThan(
        10,
      );
    }
  });

  it('is uncentred: a constant OOF bias counts as error and is only reported', () => {
    const r = rows(
      't06:cov:bias',
      20000,
      () => [0, 0, 0, 0, 0],
      () => 1,
    ).map((x) => ({
      ...x,
      e: x.e.map((v) => v + 10),
    }));
    const f = estimateNonInheritanceCov(r);
    expect(f.diagnostics.oofMean[0]).toBeCloseTo(10, 0);
    expect(f.residualCov[0]![0]!).toBeGreaterThan(NOISE[0]![0]! + 90);
  });

  it('exact symmetry, eigenvalues ≥ ε, sigma = √diag exactly', () => {
    const f = estimateNonInheritanceCov(
      rows(
        't06:cov:props',
        2000,
        () => [5, 5, 5, 5, 5],
        (i) => 1 + (i % 3),
      ),
    );
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) expect(f.residualCov[i]![j]).toBe(f.residualCov[j]![i]);
      expect(f.sigma[i]).toBe(Math.sqrt(f.residualCov[i]![i]!));
    }
    expect(jacobiEigen(f.residualCov).values[0]!).toBeGreaterThanOrEqual(
      f.diagnostics.epsilon * (1 - 1e-9),
    );
    expect(f.diagnostics.ess).toBeGreaterThan(0);
  });

  it('S < C̄ floors deterministically to ε and warns', () => {
    // Inheritance variance (400) far above the total (≈ NOISE + 1): mis-specified rules.
    const r = rows(
      't06:cov:floor',
      500,
      () => [1, 1, 1, 1, 1],
      () => 1,
    ).map((x) => ({
      ...x,
      inhCov: diag([400, 400, 400, 400, 400]),
    }));
    const a = estimateNonInheritanceCov(r);
    const b = estimateNonInheritanceCov(r);
    expect(a).toEqual(b);
    expect(a.diagnostics.flooredCount).toBe(5);
    expect(a.diagnostics.flooredMass).toBeGreaterThan(0);
    expect(a.diagnostics.warnings.some((w) => w.includes('stat 0'))).toBe(true);
    expect(a.diagnostics.warnings.some((w) => w.includes('floored'))).toBe(true);
    const eps = a.diagnostics.epsilon;
    for (let i = 0; i < 5; i++) expect(a.residualCov[i]![i]).toBeCloseTo(eps, 15);
  });

  it('all-zero residuals give ε = 1e-6 and Σ_N = εI', () => {
    const z = Array.from({ length: 10 }, (_, i) => ({
      id: `z${i}`,
      w: 1,
      e: [0, 0, 0, 0, 0],
      inhCov: diag([0, 0, 0, 0, 0]),
    }));
    const f = estimateNonInheritanceCov(z);
    expect(f.diagnostics.epsilon).toBe(1e-6);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) expect(f.residualCov[i]![j]).toBe(i === j ? 1e-6 : 0);
  });

  it('typed errors: no rows, bad weight, non-finite residual or inheritance, non-convergence', () => {
    const r = rows(
      't06:cov:err',
      10,
      () => [1, 1, 1, 1, 1],
      () => 1,
    );
    expect(() => estimateNonInheritanceCov([])).toThrow(NumericError);
    expect(() => estimateNonInheritanceCov([{ ...r[0]!, w: 0 }])).toThrow(
      expect.objectContaining({ code: 'bad-weight' }),
    );
    expect(() => estimateNonInheritanceCov([{ ...r[0]!, w: NaN }])).toThrow(NumericError);
    expect(() => estimateNonInheritanceCov([{ ...r[0]!, e: [NaN, 0, 0, 0, 0] }])).toThrow(
      NumericError,
    );
    expect(() =>
      estimateNonInheritanceCov([{ ...r[0]!, inhCov: diag([Infinity, 0, 0, 0, 0]) }]),
    ).toThrow(NumericError);
    expect(() => estimateNonInheritanceCov(r, 0)).toThrow(
      expect.objectContaining({ code: 'eigen-nonconvergence' }),
    );
  });

  it('Gaussian predictive form adds the row inheritance variance once (SYNTHETIC)', () => {
    const r = rows(
      't06:cov:once',
      20000,
      (i) => (i % 2 ? [20, 20, 20, 20, 20] : [80, 80, 80, 80, 80]),
      () => 1,
    );
    const hold = r.map((x) => ({ id: x.id, e: x.e, inhCov: x.inhCov, w: 1 }));
    expect(gaussianCoverage(NOISE, hold).pooled).toBeCloseTo(0.8, 1);
    expect(Math.abs(gaussianCoverage(NOISE, hold).pooled - 0.8)).toBeLessThan(0.01);
    expect(gaussianCoverage(NOISE, hold, false).pooled).toBeLessThan(0.7);
  });
});
