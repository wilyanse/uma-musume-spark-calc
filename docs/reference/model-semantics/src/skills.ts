/**
 * T05b EVIDENCE (ADR-0002 §Q-124): exposure-aware skill-acquisition posterior.
 *
 * Model, per train mode m and skill s. For a training row i where s could have been available:
 *   q_i = 1                     if s is a deck hint/event skill or innate (existing approximation:
 *                               these sources count as certain availability),
 *   q_i = skillHintProb_i[s]    otherwise (T05 closed form on the row's RECORDED lineage),
 *   y_i ~ Bernoulli(q_i · θ)    acquired (1) or not (0); θ = θ_{m,s} is the CONDITIONAL rate
 *                               P(acquired | actually hinted), the quantity 50 §5 multiplies by
 *                               P(hinted) exactly once at prediction.
 * Prior θ ~ Beta(a0, b0). For q_i < 1 the posterior is NOT Beta. It is computed by deterministic
 * 1-D quadrature and stored as the moment-matched Beta(a, b) (exact first two moments) because the
 * snapshot shape is `{a, b}`; downstream (50 §5) uses only the mean, which is preserved exactly.
 *
 * Pure functions, no dependencies. Not production engine code (T06 owns that).
 */

export interface Exposure {
  /** Availability probability in [0, 1]. */
  q: number;
  /** Acquired? */
  y: 0 | 1;
}

export interface BetaParams {
  a: number;
  b: number;
}

export class SkillPosteriorError extends Error {
  readonly code: 'bad-input' | 'quadrature-nonconvergence' | 'degenerate';
  constructor(code: SkillPosteriorError['code'], message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'SkillPosteriorError';
  }
}

export interface SkillPosterior {
  /** Moment-matched Beta stored in `params.skillAcquire[mode][skill]`. */
  beta: BetaParams;
  mean: number;
  variance: number;
  /** 'prior' (no usable evidence), 'conjugate' (all q = 1, exact), 'quadrature' (some q < 1). */
  method: 'prior' | 'conjugate' | 'quadrature';
  /** Rows used: q > 0 (q = 0 non-acquired rows carry no information and are dropped). */
  used: number;
  /** Rows with q = 1. */
  guaranteed: number;
  /** Σ q over used rows (effective exposure). */
  exposure: number;
  successes: number;
  /** y = 1 with q = 0: acquired with no observable source. EXCLUDED from the likelihood. */
  contradictions: number;
  /** |I_h − I_{h/2}| relative, for the normaliser (quadrature only, else 0). */
  quadratureRelErr: number;
  quadratureLevels: number;
}

/** q values at or above this are treated as exactly 1 (guaranteed availability). */
export const Q_ONE = 1 - 1e-12;
/** Quadrature acceptance: successive tanh-sinh levels agree to this relative error. */
export const QUAD_REL_TOL = 1e-10;
export const QUAD_MAX_LEVELS = 12;
export const QUAD_MAX_T = 12;

const log1pExp = (x: number) => (x > 0 ? x + Math.log1p(Math.exp(-x)) : Math.log1p(Math.exp(x)));

/**
 * Posterior moments of θ under prior Beta(a0, b0) and the exposure likelihood.
 *
 * Reduction: q = 1 rows are conjugate (a += y, b += 1 − y). For q < 1 rows, y = 1 contributes
 * q·θ ∝ θ (a += 1; the constant q cancels), and y = 0 contributes g_i(θ) = 1 − q_i θ, a positive
 * bounded polynomial on [0, 1]. So the posterior is Beta(A, B) reweighted by
 * G(θ) = Π_{q<1, y=0} (1 − q_i θ), and E[θ^k] = E_Beta(A,B)[θ^k G] / E_Beta(A,B)[G].
 *
 * Those three integrals are evaluated by tanh-sinh (double-exponential) quadrature in θ, which is
 * exact-to-rounding for Beta kernels with integrable endpoint singularities (A or B < 1). θ and
 * 1 − θ are both computed from the abscissa without cancellation, everything is accumulated in
 * log space with a max shift, and the step is halved until two levels agree within QUAD_REL_TOL
 * (else `quadrature-nonconvergence`). Deterministic: fixed level sequence, fixed summation order.
 */
export function skillPosterior(prior: BetaParams, rows: readonly Exposure[]): SkillPosterior {
  if (!(prior.a > 0 && prior.b > 0 && Number.isFinite(prior.a) && Number.isFinite(prior.b)))
    throw new SkillPosteriorError('bad-input', `prior must have finite a, b > 0`);
  let A = prior.a;
  let B = prior.b;
  const failQ: number[] = [];
  let used = 0;
  let guaranteed = 0;
  let exposure = 0;
  let successes = 0;
  let contradictions = 0;
  for (const r of rows) {
    if (!(r.q >= 0 && r.q <= 1) || (r.y !== 0 && r.y !== 1))
      throw new SkillPosteriorError(
        'bad-input',
        `q must be in [0,1], y in {0,1}: ${JSON.stringify(r)}`,
      );
    if (r.q === 0) {
      if (r.y === 1) contradictions++;
      continue; // q = 0, y = 0: no opportunity, no information.
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
  const base = {
    used,
    guaranteed,
    exposure,
    successes,
    contradictions,
  };
  if (failQ.length === 0) {
    const mean = A / (A + B);
    const variance = (A * B) / ((A + B) ** 2 * (A + B + 1));
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
  failQ.sort((x, y) => x - y); // fixed summation order
  const m = tanhSinhMoments(A, B, failQ);
  const mean = m.m1;
  const variance = m.m2 - m.m1 * m.m1;
  if (!(variance > 0) || !(mean > 0 && mean < 1))
    throw new SkillPosteriorError('degenerate', `mean ${mean}, variance ${variance}`);
  const nu = (mean * (1 - mean)) / variance - 1;
  if (!(nu > 0) || !Number.isFinite(nu))
    throw new SkillPosteriorError('degenerate', `moment-matched concentration ${nu}`);
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

/** Normalised E[θ], E[θ²] under Beta(A,B)·Π(1 − q θ), tanh-sinh with step halving. */
export function tanhSinhMoments(A: number, B: number, failQ: readonly number[]) {
  const level = (h: number, T: number) => {
    // Abscissae t = k·h, |t| ≤ T. The caller grows T until the end terms are negligible.
    const terms: { lw: number; th: number }[] = [];
    const n = Math.ceil(T / h);
    let edge = -Infinity;
    for (let k = -n; k <= n; k++) {
      const t = k * h;
      const u = (Math.PI / 2) * Math.sinh(t);
      // θ = (1 + tanh u)/2 = 1/(1 + e^{−2u}); 1 − θ = 1/(1 + e^{2u}); exact in log space.
      const logTh = -log1pExp(-2 * u);
      const log1mTh = -log1pExp(2 * u);
      // dθ/dt = (π/2) cosh t · sech²u / 2 = (π/2) cosh t · θ (1 − θ)
      const logJac = Math.log((Math.PI / 2) * Math.cosh(t)) + logTh + log1mTh;
      const th = Math.exp(logTh);
      const one = Math.exp(log1mTh);
      let logG = 0;
      for (const q of failQ) logG += Math.log(1 - q + q * one); // 1 − qθ without cancellation
      const lw = Math.log(h) + logJac + (A - 1) * logTh + (B - 1) * log1mTh + logG;
      if (!Number.isFinite(lw)) continue;
      if (Math.abs(k) === n) edge = Math.max(edge, lw);
      terms.push({ lw, th });
    }
    let max = -Infinity;
    for (const x of terms) if (x.lw > max) max = x.lw;
    let z = 0;
    let s1 = 0;
    let s2 = 0;
    for (const { lw, th } of terms) {
      const w = Math.exp(lw - max);
      z += w;
      s1 += w * th;
      s2 += w * th * th;
    }
    const logZ = Math.log(z) + max;
    return { logZ, m1: s1 / z, m2: s2 / z, edgeRel: Math.exp(edge - logZ) };
  };
  // Truncation: grow T until the end abscissae carry < 1e-20 of the mass (slow decay only for
  // very small A or B, e.g. a prior with a0 ≪ 1). T = 12 covers A, B ≥ ~1e-4.
  let T = 4;
  while (level(0.5, T).edgeRel > 1e-20) {
    T += 1;
    if (T > QUAD_MAX_T)
      throw new SkillPosteriorError(
        'quadrature-nonconvergence',
        `tail truncation not negligible at T=${QUAD_MAX_T} (A=${A}, B=${B})`,
      );
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
    if (relErr < QUAD_REL_TOL && lv >= 2) return { m1: cur.m1, m2: cur.m2, relErr, levels: lv, T };
    prev = cur;
  }
  throw new SkillPosteriorError('quadrature-nonconvergence', `after ${QUAD_MAX_LEVELS} levels`);
}

// --------------------------------------------------------------------------------------------
// Global prior (method of moments across skills, exposure-aware), train rows only.
// --------------------------------------------------------------------------------------------

export interface PriorFit {
  prior: BetaParams;
  mean: number;
  /** Between-skill variance estimate τ² (before clamping). */
  tau2: number;
  skillsUsed: number;
  /** 'mom' | 'clamped-low' (τ² ≤ var floor) | 'clamped-high' | 'no-data'. */
  status: 'mom' | 'clamped-low-concentration' | 'clamped-high-concentration' | 'no-data';
}

/** Concentration bounds ν = a0 + b0 for the global prior (a numerical guard, not a tuned value). */
export const PRIOR_NU_MIN = 2;
export const PRIOR_NU_MAX = 1000;
/** A skill enters the moment fit only with effective exposure Σq ≥ this. */
export const PRIOR_MIN_EXPOSURE = 1;
/**
 * The prior mean is clamped to [PRIOR_MEAN_MIN, 1 − PRIOR_MEAN_MIN] so a0, b0 ≥ 0.01 (with ν ≥ 2):
 * a numerical guard keeping the tanh-sinh tails inside QUAD_MAX_T; it never binds on the golden data.
 */
export const PRIOR_MEAN_MIN = 0.005;

/**
 * Method of moments over skills with exposure E_s = Σ q_i ≥ 1 and Y_s = Σ y_i (contradictions
 * excluded). Per-skill rate r_s = Y_s / E_s, unbiased for θ_s since E[Y_s] = θ_s E_s.
 *   m  = Σ E_s r_s / Σ E_s, clamped to [0.005, 0.995] (exposure-weighted mean)
 *   S  = Σ E_s (r_s − m)² / Σ E_s                  (observed between-skill spread)
 *   V  = Σ E_s v_s / Σ E_s, v_s = Σ_i q_i m(1 − q_i m) / E_s²   (plug-in sampling variance)
 *   τ² = S − V;  ν = m(1 − m)/τ² − 1 clamped to [PRIOR_NU_MIN, PRIOR_NU_MAX]; a0 = m ν, b0 = (1−m) ν.
 * τ² ≤ 0 → ν = PRIOR_NU_MAX (no detectable between-skill variation); no data → Beta(1, 1).
 */
export function fitGlobalPrior(perSkill: ReadonlyMap<string, readonly Exposure[]>): PriorFit {
  const stats: { E: number; r: number; qs: number[] }[] = [];
  for (const rows of perSkill.values()) {
    const qs = rows.filter((x) => x.q > 0).map((x) => x.q);
    const E = qs.reduce((s, x) => s + x, 0);
    if (E < PRIOR_MIN_EXPOSURE) continue;
    const Y = rows.filter((x) => x.q > 0 && x.y === 1).length;
    stats.push({ E, r: Y / E, qs });
  }
  if (stats.length < 2)
    return {
      prior: { a: 1, b: 1 },
      mean: 0.5,
      tau2: NaN,
      skillsUsed: stats.length,
      status: 'no-data',
    };
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

export const betaMean = (p: BetaParams): number => p.a / (p.a + p.b);

/**
 * Independent brute-force check (evidence only): composite Simpson on a uniform θ grid of the
 * UNREDUCED posterior Beta(a0,b0)·Π_i (q_i θ)^y_i (1 − q_i θ)^(1−y_i). Requires a0, b0 ≥ 1 so the
 * integrand is bounded; used by tests to validate the reduced tanh-sinh path.
 */
export function bruteForceMoments(prior: BetaParams, rows: readonly Exposure[], n = 200_000) {
  if (prior.a < 1 || prior.b < 1)
    throw new SkillPosteriorError('bad-input', 'brute force needs a,b ≥ 1');
  const f = (th: number) => {
    let l = (prior.a - 1) * Math.log(th) + (prior.b - 1) * Math.log1p(-th);
    for (const r of rows) {
      if (r.q === 0) continue;
      l += r.y === 1 ? Math.log(r.q * th) : Math.log1p(-r.q * th);
    }
    return l;
  };
  const xs: number[] = [];
  const ls: number[] = [];
  for (let i = 1; i < n; i++) {
    xs.push(i / n);
    ls.push(f(i / n));
  }
  let max = -Infinity;
  for (const l of ls) if (l > max) max = l;
  let z = 0;
  let s1 = 0;
  let s2 = 0;
  // Grid point j = i + 1 (j = 1..n−1); Simpson weight 4 for odd j, 2 for even j. The endpoint
  // terms are dropped (zero density when a, b > 1; O(1/n) when a or b = 1, fine at n = 2e5).
  ls.forEach((l, i) => {
    const w = ((i + 1) % 2 === 1 ? 4 : 2) * Math.exp(l - max);
    z += w;
    s1 += w * xs[i]!;
    s2 += w * xs[i]! ** 2;
  });
  return { m1: s1 / z, m2: s2 / z };
}
