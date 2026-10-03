/** 50 §4 / ADR-0002 §2.7: deterministic linear algebra (`src/linalg.ts`). */
import { describe, expect, it } from 'vitest';
import {
  choleskyFactor,
  choleskySolve,
  eigenFactor,
  floorPsd,
  jacobiEigen,
  NumericError,
  symmetrize,
} from '../../src/index.ts';
import type { Matrix } from '../../src/index.ts';

const A: Matrix = [
  [36, 6, 3, 0, 0],
  [6, 29, 0, 2, 0],
  [3, 0, 36, 0, 4],
  [0, 2, 0, 29, 0],
  [0, 0, 4, 0, 29],
]; // SYNTHETIC

const reconstruct = (v: Matrix, d: number[]) =>
  v.map((_, i) => v.map((__, j) => d.reduce((s, x, k) => s + v[i]![k]! * x * v[j]![k]!, 0)));

describe('symmetrize', () => {
  it('is exactly symmetric and keeps the diagonal', () => {
    const s = symmetrize([
      [1, 2.1],
      [1.9, 3],
    ]);
    expect(s[0]![1]).toBe(s[1]![0]);
    expect(s[0]![1]).toBe(2);
    expect(s[1]![1]).toBe(3);
  });
  it('rejects non-finite and non-square input with a typed error', () => {
    expect(() => symmetrize([[NaN]])).toThrow(NumericError);
    expect(() => symmetrize([[1, 2]])).toThrow(expect.objectContaining({ code: 'not-square' }));
  });
});

describe('jacobiEigen', () => {
  it('reconstructs A = V Λ Vᵀ, ascending, unit vectors, deterministic', () => {
    const e = jacobiEigen(A);
    expect(jacobiEigen(A)).toEqual(e);
    const r = reconstruct(e.vectors, e.values);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) expect(r[i]![j]).toBeCloseTo(A[i]![j]!, 9);
    for (let k = 1; k < 5; k++) expect(e.values[k]!).toBeGreaterThanOrEqual(e.values[k - 1]!);
    for (let k = 0; k < 5; k++) {
      const col = e.vectors.map((row) => row[k]!);
      expect(col.reduce((s, x) => s + x * x, 0)).toBeCloseTo(1, 12);
      // Sign convention: the largest-|component| entry is positive.
      const big = col.reduce((b, x, i) => (Math.abs(x) > Math.abs(col[b]!) ? i : b), 0);
      expect(col[big]!).toBeGreaterThan(0);
    }
  });
  it('ties keep the original index order (identity)', () => {
    const e = jacobiEigen([
      [2, 0, 0],
      [0, 1, 0],
      [0, 0, 2],
    ]);
    expect(e.values).toEqual([1, 2, 2]);
    expect(e.vectors.map((r) => r[1])).toEqual([1, 0, 0]);
    expect(e.vectors.map((r) => r[2])).toEqual([0, 0, 1]);
    expect(e.sweeps).toBe(0);
  });
  it('non-convergence is a typed error, never a silent result', () => {
    expect(() => jacobiEigen(A, 0)).toThrow(
      expect.objectContaining({ name: 'NumericError', code: 'eigen-nonconvergence' }),
    );
  });
});

describe('floorPsd', () => {
  it('floors negative eigenvalues to ε deterministically and reports count and mass', () => {
    const r: Matrix = [
      [1, 2],
      [2, 1],
    ]; // eigenvalues −1, 3
    const f = floorPsd(r, 1e-3);
    expect(f.rawEigenvalues[0]).toBeCloseTo(-1, 12);
    expect(f.flooredCount).toBe(1);
    expect(f.flooredMass).toBeCloseTo(1 + 1e-3, 12);
    expect(f.eigenvalues[0]).toBe(1e-3);
    expect(f.sigma[0]![1]).toBe(f.sigma[1]![0]);
    expect(jacobiEigen(f.sigma).values[0]!).toBeGreaterThanOrEqual(1e-3 * (1 - 1e-9));
    expect(floorPsd(r, 1e-3)).toEqual(f);
  });
  it('an all-zero input gives εI, never a singular matrix', () => {
    const f = floorPsd(
      Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
      1e-6,
    );
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) expect(f.sigma[i]![j]).toBe(i === j ? 1e-6 : 0);
    expect(f.flooredCount).toBe(5);
  });
  it('the factor reproduces sigma (L Lᵀ = Σ) and eigenFactor agrees on PSD input', () => {
    const f = floorPsd(A, 1e-9);
    const l = eigenFactor(f.sigma);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const s = l[i]!.reduce((t, x, k) => t + x * l[j]![k]!, 0);
        expect(s).toBeCloseTo(A[i]![j]!, 9);
      }
  });
  it('rejects a non-positive epsilon', () => {
    expect(() => floorPsd(A, 0)).toThrow(NumericError);
  });
});

describe('cholesky', () => {
  it('solves an SPD system and rejects a non-PD one', () => {
    const a = A.map((r) => Float64Array.from(r));
    const x = choleskySolve(choleskyFactor(a), [1, 2, 3, 4, 5]);
    A.forEach((row, i) => expect(row.reduce((s, v, j) => s + v * x[j]!, 0)).toBeCloseTo(i + 1, 10));
    expect(() => choleskyFactor([Float64Array.from([1, 2]), Float64Array.from([2, 1])])).toThrow(
      expect.objectContaining({ code: 'not-positive-definite' }),
    );
  });
});
