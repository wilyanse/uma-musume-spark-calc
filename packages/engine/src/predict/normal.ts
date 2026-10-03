/**
 * Standard normal helpers (browser-safe, no dependencies). `erfc` uses the Maclaurin series of erf
 * for |x| < 2.5 and a Lentz continued fraction above, giving ~1e-14 relative accuracy in the
 * ranges ranking needs (far better than the 1.5e-7 Abramowitz–Stegun 7.1.26 approximation).
 */

const TWO_OVER_SQRT_PI = 1.1283791670955126;
const INV_SQRT_2PI = 0.3989422804014327;

function erfSeries(x: number): number {
  // erf(x) = 2/√π Σ (−1)^n x^(2n+1) / (n! (2n+1))
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
  }
  return TWO_OVER_SQRT_PI * sum;
}

function erfcContinuedFraction(x: number): number {
  // erfc(x) = exp(−x²)/√π · 1/(x + 1/2/(x + 1/(x + 3/2/(x + 2/(x + …))))), x > 0 (Lentz).
  const tiny = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let n = 1; n < 500; n++) {
    const an = n / 2;
    d = x + an * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = x + an / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 2;
  if (Math.abs(x) < 2.5) return 1 - erfSeries(x);
  return x > 0 ? erfcContinuedFraction(x) : 2 - erfcContinuedFraction(-x);
}

/** P(Z > z) for a standard normal Z. */
export const upperTail = (z: number): number => 0.5 * erfc(z / Math.SQRT2);
/** Standard normal density. */
export const phi = (z: number): number => INV_SQRT_2PI * Math.exp(-0.5 * z * z);

/** E[max(0, X − m)] for X ~ N(mu, sd²) (sd > 0), or max(0, mu − m) when sd = 0. */
export function expectedExcess(mu: number, sd: number, m: number): number {
  if (!(sd > 0)) return Math.max(0, mu - m);
  const d = (mu - m) / sd;
  return sd * phi(d) + (mu - m) * upperTail(-d);
}

/** One standard normal from two uniforms (Box–Muller, cosine branch; 1−u1 keeps ln finite). */
export function boxMuller(rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
}

/** Type-7 (linear interpolation) quantile of an ascending array. */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}
