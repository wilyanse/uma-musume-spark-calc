/**
 * 50 §9 T06 item 5 and ADR-0002 §3: the exposure-aware skill posterior and the global prior.
 * Every fixture is SYNTHETIC (labelled), never a game fact.
 */
import { describe, expect, it } from 'vitest';
import {
  fitGlobalPrior,
  mulberry32,
  seedFromString,
  skillPosterior,
  SkillPosteriorError,
  tanhSinhMoments,
} from '../../src/index.ts';
import type { BetaParams, Exposure } from '../../src/index.ts';

const PRIOR: BetaParams = { a: 2, b: 2 }; // SYNTHETIC

/** SYNTHETIC: n rows, q ~ U(qLo, qHi), y ~ Bernoulli(q θ). */
function synth(seed: string, n: number, theta: number, qLo: number, qHi: number): Exposure[] {
  const rng = mulberry32(seedFromString(seed));
  return Array.from({ length: n }, () => {
    const q = qLo === qHi ? qLo : qLo + (qHi - qLo) * rng();
    return { q, y: rng() < q * theta ? 1 : 0 };
  });
}

/** Independent check: composite Simpson of the UNREDUCED posterior on a uniform θ grid. */
function bruteForce(prior: BetaParams, rows: readonly Exposure[], n = 200_000) {
  let max = -Infinity;
  const ls: number[] = [];
  for (let i = 1; i < n; i++) {
    const th = i / n;
    let l = (prior.a - 1) * Math.log(th) + (prior.b - 1) * Math.log1p(-th);
    for (const r of rows) if (r.q > 0) l += r.y ? Math.log(r.q * th) : Math.log1p(-r.q * th);
    ls.push(l);
    if (l > max) max = l;
  }
  let z = 0;
  let s1 = 0;
  let s2 = 0;
  ls.forEach((l, i) => {
    const th = (i + 1) / n;
    const w = ((i + 1) % 2 ? 4 : 2) * Math.exp(l - max);
    z += w;
    s1 += w * th;
    s2 += w * th * th;
  });
  return { m1: s1 / z, m2: s2 / z };
}

describe('skill posterior (exposure-aware likelihood)', () => {
  it('q = 1 data equals the conjugate Beta update exactly', () => {
    const rows = synth('t06:sk:sure', 300, 0.4, 1, 1);
    const y = rows.reduce((s, r) => s + r.y, 0);
    const p = skillPosterior(PRIOR, rows);
    expect(p.method).toBe('conjugate');
    expect(p.beta).toEqual({ a: 2 + y, b: 2 + 300 - y });
    expect(p.guaranteed).toBe(300);
  });

  it('known θ, lineage-only data: recovered without bias; the naive rate is biased (SYNTHETIC)', () => {
    let bias = 0;
    let naiveBias = 0;
    let within = 0;
    const reps = 100;
    for (let r = 0; r < reps; r++) {
      const rows = synth(`t06:sk:known:${r}`, 400, 0.6, 0.1, 0.9);
      const p = skillPosterior(PRIOR, rows);
      bias += p.mean - 0.6;
      const y = rows.reduce((s, x) => s + x.y, 0);
      naiveBias += (2 + y) / (4 + rows.length) - 0.6;
      if (Math.abs(p.mean - 0.6) <= 1.2815515655446004 * Math.sqrt(p.variance)) within++;
    }
    expect(Math.abs(bias / reps)).toBeLessThan(0.01);
    expect(naiveBias / reps).toBeLessThan(-0.25);
    expect(within / reps).toBeGreaterThan(0.7);
    expect(within / reps).toBeLessThan(0.92);
  });

  it('agrees with an unreduced brute-force integral (q < 1 successes and failures)', () => {
    const rows = synth('t06:sk:brute', 60, 0.5, 0.05, 0.95);
    const p = skillPosterior(PRIOR, rows);
    const b = bruteForce(PRIOR, rows);
    expect(p.method).toBe('quadrature');
    expect(Math.abs(p.mean - b.m1)).toBeLessThan(1e-8);
    expect(Math.abs(p.variance - (b.m2 - b.m1 ** 2))).toBeLessThan(1e-8);
    expect(p.quadratureRelErr).toBeLessThan(1e-10);
    // Moment matching preserves the first two moments exactly.
    const s = p.beta.a + p.beta.b;
    expect(p.beta.a / s).toBeCloseTo(p.mean, 14);
    expect((p.beta.a * p.beta.b) / (s * s * (s + 1))).toBeCloseTo(p.variance, 14);
  });

  it('a q < 1 success is exactly a += 1 (q cancels)', () => {
    expect(skillPosterior(PRIOR, [{ q: 0.2, y: 1 }]).beta).toEqual({ a: 3, b: 2 });
    expect(skillPosterior(PRIOR, [{ q: 0.9, y: 1 }]).beta).toEqual({ a: 3, b: 2 });
  });

  it('rare skill: one q = 0.2 failure moves the mean far less than a q = 1 failure', () => {
    const lineage = skillPosterior(PRIOR, [{ q: 0.2, y: 0 }]);
    // E[θ] = ∫θ·Beta(2,2)(1 − 0.2θ) / ∫Beta(2,2)(1 − 0.2θ) = (0.5 − 0.2·0.3)/(1 − 0.2·0.5).
    expect(lineage.mean).toBeCloseTo((0.5 - 0.2 * 0.3) / (1 - 0.2 * 0.5), 10);
    expect(lineage.mean).toBeCloseTo(0.48889, 4);
    expect(skillPosterior(PRIOR, [{ q: 1, y: 0 }]).mean).toBeCloseTo(0.4, 14);
  });

  it('no opportunity (q = 0, y = 0) returns the prior unchanged', () => {
    const p = skillPosterior(PRIOR, [
      { q: 0, y: 0 },
      { q: 0, y: 0 },
    ]);
    expect(p.method).toBe('prior');
    expect(p.beta).toEqual(PRIOR);
    expect(p.used).toBe(0);
  });

  it('q = 0 acquisitions are contradictions: excluded and counted (Q-131)', () => {
    const p = skillPosterior(PRIOR, [
      { q: 0, y: 1 },
      { q: 0, y: 1 },
      { q: 1, y: 1 },
    ]);
    expect(p.contradictions).toBe(2);
    expect(p.beta).toEqual({ a: 3, b: 2 });
  });

  it('numerical edges stay finite (tiny/huge priors, q near 0/1, many rows)', () => {
    for (const prior of [
      { a: 0.01, b: 0.01 },
      { a: 0.01, b: 50 },
      { a: 500, b: 500 },
    ]) {
      const p = skillPosterior(prior, synth('t06:sk:edge', 50, 0.3, 0.01, 0.99));
      expect(Number.isFinite(p.beta.a) && p.beta.a > 0 && p.beta.b > 0).toBe(true);
      expect(p.mean).toBeGreaterThan(0);
      expect(p.mean).toBeLessThan(1);
    }
    const big = skillPosterior(PRIOR, synth('t06:sk:big', 5000, 0.3, 0.001, 0.999));
    expect(big.quadratureRelErr).toBeLessThan(1e-10);
  });

  it('typed errors: invalid q/y/prior and non-negligible tails', () => {
    expect(() => skillPosterior(PRIOR, [{ q: 1.2, y: 0 }])).toThrow(SkillPosteriorError);
    expect(() => skillPosterior(PRIOR, [{ q: NaN, y: 0 }])).toThrow(SkillPosteriorError);
    expect(() => skillPosterior(PRIOR, [{ q: 0.5, y: 2 as 0 }])).toThrow(SkillPosteriorError);
    expect(() => skillPosterior({ a: 0, b: 1 }, [])).toThrow(
      expect.objectContaining({ code: 'bad-input' }),
    );
    expect(() => tanhSinhMoments(2e-6, 2, [0.5])).toThrow(
      expect.objectContaining({ code: 'quadrature-nonconvergence' }),
    );
  });

  it('the absolute integral uses the exact Jacobian π cosh(t)·θ(1 − θ) (T05b N1)', () => {
    // With no failures, Z = B(A, B) exactly: B(2, 3) = 1/12.
    const m = tanhSinhMoments(2, 3, []);
    expect(Math.exp(m.logZ)).toBeCloseTo(1 / 12, 12);
    // With one q = 1 failure: ∫θ(1−θ)²·(1−θ) = B(2, 4) = 1/20.
    expect(Math.exp(tanhSinhMoments(2, 3, [1]).logZ)).toBeCloseTo(1 / 20, 12);
  });

  it('is deterministic (bit-identical) and independent of row order', () => {
    const rows = synth('t06:sk:det', 80, 0.5, 0.05, 0.95);
    const a = skillPosterior(PRIOR, rows);
    expect(skillPosterior(PRIOR, rows)).toEqual(a);
    expect(skillPosterior(PRIOR, [...rows].reverse()).beta).toEqual(a.beta);
  });
});

describe('global prior (method of moments on train cells)', () => {
  it('recovers the moments of a SYNTHETIC deterministic θ spread from lineage-only data', () => {
    // θ_s: a golden-ratio modular sequence ≈ uniform on [0.05, 0.55) — NOT a Beta draw.
    const m = new Map<string, Exposure[]>();
    const thetas = Array.from({ length: 300 }, (_, s) => 0.05 + 0.5 * ((s * 0.61803) % 1));
    thetas.forEach((th, s) => m.set(`s${s}`, synth(`t06:prior:${s}`, 60, th, 0.2, 1)));
    const pf = fitGlobalPrior(m);
    const mean = thetas.reduce((a, b) => a + b, 0) / thetas.length;
    const v = thetas.reduce((a, b) => a + (b - mean) ** 2, 0) / thetas.length;
    expect(Math.abs(pf.mean - mean)).toBeLessThan(0.02);
    expect(Math.abs(pf.tau2 - v)).toBeLessThan(0.3 * v);
    expect(pf.status).toBe('mom');
  });

  it('no detectable spread → ν = 1000; < 2 usable skills → Beta(1, 1)', () => {
    const m = new Map<string, Exposure[]>();
    // Every skill has exactly 60/200 acquisitions: zero spread, so τ² = −V < 0 (SYNTHETIC).
    for (let s = 0; s < 50; s++)
      m.set(
        `s${s}`,
        Array.from({ length: 200 }, (_, i) => ({ q: 1, y: (i < 60 ? 1 : 0) as 0 | 1 })),
      );
    const flat = fitGlobalPrior(m);
    expect(flat.status).toBe('clamped-high-concentration');
    expect(flat.prior.a + flat.prior.b).toBeCloseTo(1000, 9);
    expect(fitGlobalPrior(new Map()).prior).toEqual({ a: 1, b: 1 });
    expect(fitGlobalPrior(new Map([['only', synth('x', 10, 0.5, 1, 1)]])).status).toBe('no-data');
    // Exposure < 1 does not count as a usable skill.
    expect(
      fitGlobalPrior(
        new Map([
          ['a', [{ q: 0.3, y: 1 }]],
          ['b', [{ q: 0.4, y: 0 }]],
        ]),
      ).status,
    ).toBe('no-data');
  });

  it('the mean is clamped to [0.005, 0.995]', () => {
    const m = new Map<string, Exposure[]>();
    for (let s = 0; s < 5; s++)
      m.set(
        `s${s}`,
        Array.from({ length: 20 }, () => ({ q: 1, y: 0 as const })),
      );
    const pf = fitGlobalPrior(m);
    expect(pf.mean).toBe(0.005);
    expect(pf.prior.a).toBeGreaterThan(0);
  });
});
