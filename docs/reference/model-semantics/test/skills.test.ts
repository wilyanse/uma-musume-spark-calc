/**
 * T05b diagnostic tests for the Q-124 exposure-aware skill posterior (node:test):
 *
 *   node --test docs/reference/model-semantics/test/
 *
 * Every parameter below is SYNTHETIC (labelled); none is a game fact.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  betaMean,
  bruteForceMoments,
  fitGlobalPrior,
  skillPosterior,
  SkillPosteriorError,
  tanhSinhMoments,
} from '../src/skills.ts';
import type { Exposure } from '../src/skills.ts';
import { naiveBeta, repeatedSampling, syntheticRows } from '../src/synthetic.ts';

const close = (a: number, b: number, tol: number, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);
const PRIOR = { a: 2, b: 3 }; // SYNTHETIC

describe('exposure-aware posterior', () => {
  it('q = 1 everywhere is exactly the conjugate Beta update', () => {
    const rows = syntheticRows('t05b-test:q1', 300, 0.4, 1, 1);
    const p = skillPosterior(PRIOR, rows);
    assert.equal(p.method, 'conjugate');
    assert.deepEqual(p.beta, naiveBeta(PRIOR, rows));
  });

  it('no opportunities (q = 0, y = 0 only, or no rows) returns the prior unchanged', () => {
    assert.deepEqual(skillPosterior(PRIOR, []).beta, PRIOR);
    const p = skillPosterior(PRIOR, [{ q: 0, y: 0 }]);
    assert.equal(p.method, 'prior');
    assert.deepEqual(p.beta, PRIOR);
  });

  it('q = 0 with y = 1 is a reported contradiction, excluded from the likelihood', () => {
    const p = skillPosterior(PRIOR, [{ q: 0, y: 1 }]);
    assert.equal(p.contradictions, 1);
    assert.deepEqual(p.beta, PRIOR);
  });

  it('matches an independent brute-force integral of the unreduced likelihood', () => {
    const rows: Exposure[] = [
      { q: 0.3, y: 0 },
      { q: 0.5, y: 1 },
      { q: 0.05, y: 0 },
      { q: 1, y: 0 },
      { q: 0.95, y: 0 },
      { q: 1, y: 1 },
      { q: 0.7, y: 1 },
    ];
    const p = skillPosterior(PRIOR, rows);
    const bf = bruteForceMoments(PRIOR, rows);
    close(p.mean, bf.m1, 1e-8);
    close(p.variance + p.mean ** 2, bf.m2, 1e-8);
    // Moment-matched Beta preserves both moments.
    const { a, b } = p.beta;
    close(a / (a + b), p.mean, 1e-12);
    close((a * b) / ((a + b) ** 2 * (a + b + 1)), p.variance, 1e-12);
    assert.ok(p.quadratureRelErr < 1e-10);
  });

  it('a q < 1 failure moves the mean down by less than a q = 1 failure (partial evidence)', () => {
    const prior = betaMean(PRIOR);
    const partial = skillPosterior(PRIOR, [{ q: 0.2, y: 0 }]).mean;
    const full = skillPosterior(PRIOR, [{ q: 1, y: 0 }]).mean;
    assert.ok(full < partial && partial < prior);
  });

  it('known θ, lineage-only q ~ U(0.1, 0.9): unbiased and calibrated; naive is biased by ≈ E[q]', () => {
    const r = repeatedSampling({
      seed: 't05b-test:rep',
      reps: 100,
      n: 300,
      theta: 0.6,
      qLo: 0.1,
      qHi: 0.9,
      prior: { a: 2, b: 2 },
    });
    close(r.exposure.meanBias, 0, 0.02);
    assert.ok(r.exposure.within80 >= 0.7 && r.exposure.within80 <= 0.9, `${r.exposure.within80}`);
    assert.ok(r.naive.meanBias < -0.25);
  });

  it('acquisition is counted once at prediction: q_child · E[θ] ≈ q_child · θ (SYNTHETIC)', () => {
    const rows = syntheticRows('t05b-test:once', 2000, 0.6, 0.1, 0.9);
    const p = skillPosterior({ a: 2, b: 2 }, rows);
    const qChild = 0.5;
    close(qChild * p.mean, qChild * 0.6, 0.03);
    // The literal 50 §4/§5 reading multiplies the (already q-diluted) naive mean by q again.
    const naive = betaMean(naiveBeta({ a: 2, b: 2 }, rows));
    assert.ok(qChild * naive < 0.2);
  });

  it('extreme priors and many rows stay finite and converge', () => {
    for (const prior of [
      { a: 0.01, b: 0.01 },
      { a: 0.01, b: 50 },
      { a: 500, b: 500 },
    ]) {
      const p = skillPosterior(prior, syntheticRows('t05b-test:ext', 50, 0.3, 0.01, 0.99));
      assert.ok(
        Number.isFinite(p.beta.a) && Number.isFinite(p.beta.b) && p.beta.a > 0 && p.beta.b > 0,
      );
    }
    const big = skillPosterior(PRIOR, syntheticRows('t05b-test:big', 5000, 0.3, 0.001, 0.999));
    assert.ok(big.quadratureRelErr < 1e-10);
  });

  it('typed errors: invalid q/y/prior and non-negligible tails', () => {
    assert.throws(() => skillPosterior(PRIOR, [{ q: 1.2, y: 0 }]), SkillPosteriorError);
    assert.throws(() => skillPosterior({ a: 0, b: 1 }, []), SkillPosteriorError);
    assert.throws(
      () => tanhSinhMoments(2e-6, 2, [0.5]),
      (e) => e instanceof SkillPosteriorError && e.code === 'quadrature-nonconvergence',
    );
  });
});

describe('global prior (method of moments, exposure-aware)', () => {
  it('recovers the moments of a SYNTHETIC deterministic θ_s spread from lineage-only data', () => {
    // θ_s is NOT a Beta draw (T05b review S2): a golden-ratio modular sequence, approximately
    // uniform on [0.05, 0.55). The test checks recovery of that sequence's empirical mean and
    // variance by the exposure-aware method of moments (SYNTHETIC).
    const m = new Map<string, Exposure[]>();
    const thetas = Array.from({ length: 300 }, (_, s) => 0.05 + 0.5 * ((s * 0.61803) % 1));
    thetas.forEach((th, s) =>
      m.set(`s${s}`, syntheticRows(`t05b-test:prior:${s}`, 60, th, 0.2, 1)),
    );
    const pf = fitGlobalPrior(m);
    const meanTrue = thetas.reduce((a, b) => a + b, 0) / thetas.length;
    const varTrue = thetas.reduce((a, b) => a + (b - meanTrue) ** 2, 0) / thetas.length;
    close(pf.mean, meanTrue, 0.02);
    close(pf.tau2, varTrue, 0.3 * varTrue);
    assert.equal(pf.status, 'mom');
  });

  it('no detectable spread → clamped high concentration; no data → Beta(1,1)', () => {
    const m = new Map<string, Exposure[]>();
    for (let s = 0; s < 50; s++)
      m.set(`s${s}`, syntheticRows(`t05b-test:flat:${s}`, 200, 0.3, 1, 1));
    assert.equal(fitGlobalPrior(m).status, 'clamped-high-concentration');
    assert.deepEqual(fitGlobalPrior(new Map()).prior, { a: 1, b: 1 });
  });
});
