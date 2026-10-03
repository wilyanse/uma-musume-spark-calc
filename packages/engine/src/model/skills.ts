/**
 * ADR-0002 §3 (Q-124): exposure-aware skill acquisition.
 *
 * Estimand θ_{m,s} = P(acquired | the skill was ACTUALLY hinted or innate). For a train row and a
 * candidate skill, the availability q is 1 for deck hint/event or innate skills (an unverified
 * approximation, Q-130) and the recorded-lineage `skillHintProb` otherwise; y ~ Bernoulli(q·θ).
 * Lineage sparks are only POTENTIAL hints: activation is never observed and never assumed.
 *
 * Posterior under Beta(a0, b0): q = 1 rows are conjugate; q < 1 successes add 1 to a (q cancels);
 * q < 1 failures multiply by (1 − qθ) (non-conjugate, integrated by deterministic tanh-sinh
 * quadrature); q = 0 non-acquisitions carry no information; q = 0 acquisitions are contradictions
 * (Q-131), excluded and counted. Stored as the moment-matched Beta.
 */
import { SkillPosteriorError } from './errors.ts';

export interface Exposure {
  /** Availability probability in [0, 1]. */
  q: number;
  y: 0 | 1;
}

export interface BetaParams {
  a: number;
  b: number;
}

export interface SkillPosterior {
  beta: BetaParams;
  mean: number;
  variance: number;
  method: 'prior' | 'conjugate' | 'quadrature';
  /** Rows with q > 0. */
  used: number;
  /** Rows with q = 1. */
  guaranteed: number;
  /** Σ q over used rows. */
  exposure: number;
  successes: number;
  /** y = 1 with q = 0 (excluded). */
  contradictions: number;
  quadratureRelErr: number;
  quadratureLevels: number;
}

/** q at or above this is exactly-1 availability. */
export const Q_ONE = 1 - 1e-12;
export const QUAD_REL_TOL = 1e-10;
export const QUAD_MIN_LEVELS = 2;
export const QUAD_MAX_LEVELS = 12;
export const QUAD_MAX_T = 12;
export const QUAD_TAIL_REL = 1e-20;

const log1pExp = (x: number) => (x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x)));

export function betaMoments(p: BetaParams): { mean: number; variance: number } {
  const s = p.a + p.b;
  return { mean: p.a / s, variance: (p.a * p.b) / (s * s * (s + 1)) };
}

/** Posterior of θ for one (mode, skill) under `prior` and the exposure likelihood. */
export function skillPosterior(prior: BetaParams, rows: readonly Exposure[]): SkillPosterior {
  if (!(prior.a > 0 && prior.b > 0 && Number.isFinite(prior.a) && Number.isFinite(prior.b))) {
    throw new SkillPosteriorError('bad-input', `prior must have finite a, b > 0`);
  }
  let A = prior.a;
  let B = prior.b;
  const failQ: number[] = [];
  let used = 0;
  let guaranteed = 0;
  let exposure = 0;
  let successes = 0;
  let contradictions = 0;
  for (const r of rows) {
    if (!(r.q >= 0 && r.q <= 1) || (r.y !== 0 && r.y !== 1)) {
      throw new SkillPosteriorError(
        'bad-input',
        `q must be in [0,1], y in {0,1}: q=${r.q} y=${r.y}`,
      );
    }
    if (r.q === 0) {
      if (r.y === 1) contradictions++;
      continue;
    }
    used++;
    exposure += r.q;
    successes += r.y;
    if (r.q >= Q_ONE) {
      guaranteed++;
      if (r.y === 1) A += 1;
      else B += 1;
    } else if (r.y === 1) A += 1;
    else failQ.push(r.q);
  }
  const base = { used, guaranteed, exposure, successes, contradictions };
  if (failQ.length === 0) {
    const { mean, variance } = betaMoments({ a: A, b: B });
    return {
      beta: { a: A, b: B },
      mean,
      variance,
      method: used === 0 ? 'prior' : 'conjugate',
      ...base,
      quadratureRelErr: 0,
      quadratureLevels: 0,
    };
  }
  failQ.sort((x, y) => x - y);
  const m = tanhSinhMoments(A, B, failQ);
  const mean = m.m1;
  const variance = m.m2 - m.m1 * m.m1;
  if (!(variance > 0) || !(mean > 0 && mean < 1)) {
    throw new SkillPosteriorError('degenerate', `mean ${mean}, variance ${variance}`);
  }
  const nu = (mean * (1 - mean)) / variance - 1;
  if (!(nu > 0) || !Number.isFinite(nu)) {
    throw new SkillPosteriorError('degenerate', `moment-matched concentration ${nu}`);
  }
  return {
    beta: { a: mean * nu, b: (1 - mean) * nu },
    mean,
    variance,
    method: 'quadrature',
    ...base,
    quadratureRelErr: m.relErr,
    quadratureLevels: m.levels,
  };
}

/**
 * Normalised E[θ], E[θ²] under Beta(A, B)·Π(1 − q_i θ) by tanh-sinh quadrature with
 * θ = logistic(π sinh t), dθ/dt = π cosh(t)·θ(1 − θ). θ and 1 − θ come from the abscissa in log
 * space (no cancellation), 1 − qθ = (1 − q) + q(1 − θ), sums use a max shift, θ = 0 and θ = 1
 * are never evaluated. Truncation T grows from 4 until the end terms carry < 1e-20 of the mass
 * (max 12); the step halves from 0.5 until two levels agree to < 1e-10 in Z, E[θ], E[θ²] (at least
 * 2, at most 12 halvings). Otherwise a typed `quadrature-nonconvergence`.
 */
export function tanhSinhMoments(A: number, B: number, failQ: readonly number[]) {
  const level = (h: number, T: number) => {
    const n = Math.ceil(T / h);
    const lws: number[] = [];
    const ths: number[] = [];
    let edge = -Infinity;
    for (let k = -n; k <= n; k++) {
      const t = k * h;
      const x = Math.PI * Math.sinh(t); // θ = logistic(x)
      const logTh = -log1pExp(-x);
      const log1mTh = -log1pExp(x);
      const logJac = Math.log(Math.PI * Math.cosh(t)) + logTh + log1mTh;
      const one = Math.exp(log1mTh);
      let logG = 0;
      for (const q of failQ) logG += Math.log(1 - q + q * one);
      const lw = Math.log(h) + logJac + (A - 1) * logTh + (B - 1) * log1mTh + logG;
      if (!Number.isFinite(lw)) continue; // underflow in the far tails only
      if (Math.abs(k) === n) edge = Math.max(edge, lw);
      lws.push(lw);
      ths.push(Math.exp(logTh));
    }
    let max = -Infinity;
    for (const lw of lws) if (lw > max) max = lw;
    let z = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < lws.length; i++) {
      const w = Math.exp(lws[i]! - max);
      const th = ths[i]!;
      z += w;
      s1 += w * th;
      s2 += w * th * th;
    }
    const logZ = Math.log(z) + max;
    return { logZ, m1: s1 / z, m2: s2 / z, edgeRel: Math.exp(edge - logZ) };
  };
  let T = 4;
  while (!(level(0.5, T).edgeRel < QUAD_TAIL_REL)) {
    T += 1;
    if (T > QUAD_MAX_T) {
      throw new SkillPosteriorError(
        'quadrature-nonconvergence',
        `tail truncation not negligible at T=${QUAD_MAX_T} (A=${A}, B=${B})`,
      );
    }
  }
  let h = 0.5;
  let prev = level(h, T);
  for (let lv = 1; lv <= QUAD_MAX_LEVELS; lv++) {
    h /= 2;
    const cur = level(h, T);
    const relErr = Math.max(
      Math.abs(Math.expm1(cur.logZ - prev.logZ)),
      Math.abs(cur.m1 - prev.m1) / Math.max(cur.m1, 1e-300),
      Math.abs(cur.m2 - prev.m2) / Math.max(cur.m2, 1e-300),
    );
    if (relErr < QUAD_REL_TOL && lv >= QUAD_MIN_LEVELS) {
      return { m1: cur.m1, m2: cur.m2, relErr, levels: lv, T };
    }
    prev = cur;
  }
  throw new SkillPosteriorError('quadrature-nonconvergence', `after ${QUAD_MAX_LEVELS} levels`);
}

export interface PriorFit {
  prior: BetaParams;
  mean: number;
  /** τ² before clamping (NaN with < 2 usable skills). */
  tau2: number;
  skillsUsed: number;
  status: 'mom' | 'clamped-low-concentration' | 'clamped-high-concentration' | 'no-data';
}

export const PRIOR_NU_MIN = 2;
export const PRIOR_NU_MAX = 1000;
export const PRIOR_MIN_EXPOSURE = 1;
export const PRIOR_MEAN_MIN = 0.005;

/**
 * Global per-mode prior `'*'` (ADR-0002 §3), method of moments on TRAIN cells only. Skills are
 * visited in sorted id order so the sums are deterministic.
 */
export function fitGlobalPrior(perSkill: ReadonlyMap<string, readonly Exposure[]>): PriorFit {
  const stats: { E: number; r: number; qs: number[] }[] = [];
  for (const id of [...perSkill.keys()].sort()) {
    const rows = perSkill.get(id)!;
    const qs = rows.filter((x) => x.q > 0).map((x) => x.q);
    const E = qs.reduce((s, x) => s + x, 0);
    if (E < PRIOR_MIN_EXPOSURE) continue;
    const Y = rows.filter((x) => x.q > 0 && x.y === 1).length;
    stats.push({ E, r: Y / E, qs });
  }
  if (stats.length < 2) {
    return {
      prior: { a: 1, b: 1 },
      mean: 0.5,
      tau2: NaN,
      skillsUsed: stats.length,
      status: 'no-data',
    };
  }
  const W = stats.reduce((s, x) => s + x.E, 0);
  const m = Math.min(
    1 - PRIOR_MEAN_MIN,
    Math.max(PRIOR_MEAN_MIN, stats.reduce((s, x) => s + x.E * x.r, 0) / W),
  );
  const S = stats.reduce((s, x) => s + x.E * (x.r - m) ** 2, 0) / W;
  const V =
    stats.reduce(
      (s, x) => s + x.E * (x.qs.reduce((t, q) => t + q * m * (1 - q * m), 0) / x.E ** 2),
      0,
    ) / W;
  const tau2 = S - V;
  let nu: number;
  let status: PriorFit['status'] = 'mom';
  if (!(tau2 > 0)) {
    nu = PRIOR_NU_MAX;
    status = 'clamped-high-concentration';
  } else {
    nu = (m * (1 - m)) / tau2 - 1;
    if (nu < PRIOR_NU_MIN) {
      nu = PRIOR_NU_MIN;
      status = 'clamped-low-concentration';
    } else if (nu > PRIOR_NU_MAX) {
      nu = PRIOR_NU_MAX;
      status = 'clamped-high-concentration';
    }
  }
  return { prior: { a: m * nu, b: (1 - m) * nu }, mean: m, tau2, skillsUsed: stats.length, status };
}
