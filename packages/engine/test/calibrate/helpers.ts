/**
 * Shared T15 test inputs. The golden files, the stored split and `loadGoldenContext` (the T08
 * synthetic `blueStatGain` 10/20/30 and synthetic inheritance turns) are TEST INPUTS only: the
 * production calibration never imports `scripts/` or reads `truth.json`. No planted value
 * (`truth.latent`, `truth.calibration.*`, planted cards or rates) is passed to `calibrateRules`.
 */
import { loadGoldenContext } from '../../scripts/golden-context.ts';
import { calibrateRules, loadContext } from '../../src/index.ts';
import type { CalibrationOptions, CalibrationReport, EngineContext } from '../../src/index.ts';
import type { RosterVeteran } from '@uma/schema';
import { calibrationRoster, master, roster, truth } from '../golden/load.ts';

export { calibrationRoster, master, roster, truth };

/** Only the documented synthetic inheritance inputs (no latent, no calibration multiplier). */
export const goldenInput = { syntheticInheritance: structuredClone(truth.syntheticInheritance) };
export const goldenCtx = (scale = 1): EngineContext =>
  loadGoldenContext(master, goldenInput, scale);
/** The published Global rules, unchanged (blueStatGain 0/0/0 placeholder, no inheritance turns). */
export const publishedCtx = (): EngineContext => loadContext(master, master.rules);

export const storedSplit = {
  trainIds: truth.holdout.trainIds,
  holdoutIds: truth.holdout.holdoutIds,
};
/**
 * Explicit per-test timeout for tests that run one or more full `calibrateRules` calls (review 2,
 * S-C). Such a test takes ≈ 1.1–1.3 s alone (≈ 2.8 s for the 401-point grid) on the dev Mac and
 * has timed out at the Vitest default 5 s under host load ≈ 42. 30 s is a bounded ceiling for
 * contention only: no assertion, acceptance or runtime target depends on it.
 */
export const FULL_CALIBRATION_TIMEOUT_MS = 30_000;

export const FIXED_NOW = new Date('2026-10-08T00:00:00.000Z');
export const FIXED_ID = '01KGQZ0000G01DENCM0000T15A';

/** Deterministic options: explicit split, injected clock / id / timer. */
export const opts = (extra: Partial<CalibrationOptions> = {}): CalibrationOptions => ({
  split: storedSplit,
  now: () => FIXED_NOW,
  id: () => FIXED_ID,
  timer: () => 0,
  ...extra,
});

const cache = new Map<string, CalibrationReport>();
/** Memoised golden calibration (keyed by a caller-chosen name). */
export function cached(
  key: string,
  ctx: () => EngineContext,
  rows: readonly RosterVeteran[],
  o: CalibrationOptions = opts(),
): CalibrationReport {
  let r = cache.get(key);
  if (!r) {
    r = calibrateRules(ctx(), rows, o);
    cache.set(key, r);
  }
  return r;
}

/** Recursively freezes an object graph (Maps/Sets are frozen as objects; their entries too). */
export function deepFreeze<T>(x: T, seen = new Set<unknown>()): T {
  if (x === null || typeof x !== 'object' || seen.has(x)) return x;
  seen.add(x);
  if (x instanceof Map) {
    for (const [k, v] of x) {
      deepFreeze(k, seen);
      deepFreeze(v, seen);
    }
  } else if (x instanceof Set) {
    for (const v of x) deepFreeze(v, seen);
  } else if (!ArrayBuffer.isView(x)) {
    for (const v of Object.values(x as object)) deepFreeze(v, seen);
  }
  return Object.freeze(x);
}
