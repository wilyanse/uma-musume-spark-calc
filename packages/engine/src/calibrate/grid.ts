/**
 * T15 grid and selection helpers (pure, deterministic). Grid points are exact decimal ticks, and
 * the argmin tie rule is fixed: within a relative tolerance of the minimum, prefer the multiplier
 * closest to 1 (the current rules), then the smaller multiplier.
 */
import { ModelInputError } from '../model/errors.ts';

export interface GridSpec {
  /** Smallest multiplier (inclusive, ≥ 0). */
  min: number;
  /** Largest multiplier (inclusive, ≥ min). */
  max: number;
  /** Step (> 0). Points are min + i·step rounded to 9 decimals, up to max (inclusive). */
  step: number;
}

/** 50 §8: a 0.01 grid over [0.5, 2.0] (151 points). Fixed, not adaptive, not refined. */
export const DEFAULT_CALIBRATION_GRID: Readonly<GridSpec> = Object.freeze({
  min: 0.5,
  max: 2,
  step: 0.01,
});
/** Upper bound on grid points (input guard; each point costs O(train · λ-grid · stats)). */
export const MAX_GRID_POINTS = 5001;
/** Relative tolerance under which two criterion values are a tie. */
export const TIE_REL_TOL = 1e-12;

export function validateGrid(g: GridSpec): void {
  const ok =
    Number.isFinite(g.min) &&
    Number.isFinite(g.max) &&
    Number.isFinite(g.step) &&
    g.min >= 0 &&
    g.max >= g.min &&
    g.step > 0;
  if (!ok) throw new ModelInputError('bad-grid', JSON.stringify(g));
  const n = Math.floor((g.max - g.min) / g.step + 1e-9) + 1;
  if (n > MAX_GRID_POINTS) {
    throw new ModelInputError('bad-grid', `${n} points > ${MAX_GRID_POINTS}`);
  }
}

export function buildGrid(g: GridSpec): number[] {
  validateGrid(g);
  const n = Math.floor((g.max - g.min) / g.step + 1e-9) + 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Number((g.min + i * g.step).toFixed(9)));
  return out;
}

/**
 * Index of the minimum of `values` over `multipliers` with the documented tie rule. Throws on a
 * non-finite value (a criterion must never silently become NaN).
 */
export function selectArgmin(multipliers: readonly number[], values: readonly number[]): number {
  if (multipliers.length === 0 || multipliers.length !== values.length) {
    throw new ModelInputError('bad-grid', 'empty or mismatched criterion');
  }
  let min = Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) throw new ModelInputError('non-finite', `criterion ${v}`);
    if (v < min) min = v;
  }
  const tol = TIE_REL_TOL * Math.max(1, Math.abs(min));
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > min + tol) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const d = Math.abs(multipliers[i]! - 1);
    const db = Math.abs(multipliers[best]! - 1);
    if (d < db - 1e-12 || (Math.abs(d - db) <= 1e-12 && multipliers[i]! < multipliers[best]!)) {
      best = i;
    }
  }
  return best;
}

/** Nearest-rank percentile of a sorted array. */
export function percentile(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

/** FNV-1a (two 32-bit lanes) of a string: a cheap deterministic fingerprint, not a security hash. */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
