import { expect, it } from 'vitest';
import { blueIdentifiability, calibrateRules } from '../../src/calibrate/index.ts';
import { calibrationRoster, goldenCtx, opts, FULL_CALIBRATION_TIMEOUT_MS } from './helpers.ts';

it('saturated card design cannot identify a multiplier on a reduced basis', () => {
  const r = blueIdentifiability(
    [
      [1, 0, 0, 0, 0],
      [2, 0, 0, 0, 0],
    ],
    [],
    {
      design: [
        [1, 1, 0],
        [1, 0, 1],
      ],
      structural: [true, false, false],
    },
  );
  expect(r.identification.saturated).toBe(true);
  expect(r.identifiable).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/saturated.*ridge/);
});

it('confounded stats cannot drive a shared all-stat MAE selection', () => {
  const r = blueIdentifiability(
    [
      [1, 1, 0, 0, 0],
      [1, 4, 0, 0, 0],
      [1, 2, 0, 0, 0],
      [1, 7, 0, 0, 0],
    ],
    [],
    { design: [[1], [1], [1], [1]] },
  );
  expect(r.identification.confoundedStats).toEqual(['spd']);
  expect(r.identifiable).toBe(false);
});

it('a confounded CV fold suppresses an otherwise identified full train design', () => {
  const r = blueIdentifiability(
    [
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [2, 0, 0, 0, 0],
    ],
    [],
    {
      design: [[1], [1], [1]],
      folds: [0, 1, 2],
    },
  );
  expect(r.identification.status).toBe('identified');
  expect(r.identification.folds.some((f) => f.status !== 'identified')).toBe(true);
  expect(r.identifiable).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/fold/);
});

it(
  'saturated guest roster yields no suggestion or complete report',
  () => {
    const guest = calibrationRoster.filter((v) => v.parents.every((p) => p.isGuest));
    const r = calibrateRules(goldenCtx(), guest, opts({ split: undefined, bootstrap: 0 }));
    expect(r.stats.status).toBe('nonidentifiable');
    expect(r.stats.selected).toBeNull();
    expect(r.suggestions).toEqual([]);
    expect(r.status).not.toBe('complete');
  },
  FULL_CALIBRATION_TIMEOUT_MS,
);
