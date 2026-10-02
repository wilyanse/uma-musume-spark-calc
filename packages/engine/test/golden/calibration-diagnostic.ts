/**
 * TEST-ONLY holdout-MAE calibration feasibility scan (T08 review round 2 B1). This is NOT the
 * production T15 `CalibrationReport`; it only checks that the golden data lets a 50 §8-style stat
 * check land in the 50 §9 band.
 *
 * Inputs: roster rows, the stored split ids and the engine expectation E[inh | recorded lineage]
 * rebuilt from `truth.syntheticInheritance` by `loadGoldenContext(master, truth, m)`. No
 * `truth.latent`, no `truth.calibration.blueStatGainMultiplier` and no planted parameter enters
 * the fit or the criterion.
 *
 * For each multiplier m on a 0.01 grid: y_m = finalStat − E[inh | lineage, blueStatGain × m];
 * per-stat weighted ridge (50 §4 design, recency weights relative to the newest TRAIN row) on the
 * train ids; criterion = Σ_k mean |y_m − ŷ_m| over the holdout ids (50 §8 "holdout MAE").
 *
 * Exactness of the fast path: blueStatGain only scales event gains, so E[inh](m) is affine in m
 * (the career-start `blueInitialBonus` is unchanged), and for a fixed design, weights and penalty
 * ridge predictions are linear in y. Every holdout residual is therefore affine in m and two
 * endpoint solves (m = 0, 1) reproduce a full refit at every grid point; `calibration.test.ts`
 * asserts that against direct refits.
 */
import type { RosterVeteran } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import { STAT_KEYS } from '@uma/schema';
import { loadGoldenContext } from '../../scripts/golden-context.ts';
import type { GoldenContextInput } from '../../scripts/golden-context.ts';
import { buildDesign, predict, recencyWeights, ridge } from '../../scripts/golden-diagnostic.ts';

/**
 * 50 §8 calibration population: rows whose two parents are both guests or matched roster
 * veterans (an unmatched non-guest parent excludes the row). Order is preserved.
 */
export function matchedGuestIds(
  roster: readonly RosterVeteran[],
  ids: readonly string[],
): string[] {
  const byId = new Map(roster.map((v) => [v.id, v]));
  return ids.filter((id) =>
    byId
      .get(id)!
      .parents.every(
        (p) => p.isGuest || (p.matchedVeteranId !== null && byId.has(p.matchedVeteranId)),
      ),
  );
}

export interface ScanOptions {
  /** Grid bounds (inclusive), in multiplier units; step is 0.01. */
  lo?: number;
  hi?: number;
  weighted?: boolean;
  lambdaId?: number;
  lambdaBase?: number;
}

export interface ScanPoint {
  multiplier: number;
  mae: number;
  perStat: number[];
}

export function calibrationScan(
  master: MasterBundle,
  context: GoldenContextInput,
  roster: readonly RosterVeteran[],
  trainIds: readonly string[],
  holdIds: readonly string[],
  opts: ScanOptions = {},
) {
  const { lo = 0.5, hi = 2, weighted = true, lambdaId = 0.1, lambdaBase = 0.1 } = opts;
  const residuals = [0, 1].map((m) => {
    const d = buildDesign(loadGoldenContext(master, context, m), master, roster, trainIds, holdIds);
    const train = d.rows.slice(0, trainIds.length);
    const hold = d.rows.slice(trainIds.length);
    const w = weighted ? recencyWeights(train) : train.map(() => 1);
    return STAT_KEYS.map((_, k) => {
      const f = ridge(d, train, w, k, lambdaId, lambdaBase);
      return hold.map((r) => r.y[k]! - predict(f.beta, r.x));
    });
  });
  const grid: ScanPoint[] = [];
  for (let tick = Math.round(lo * 100); tick <= Math.round(hi * 100); tick++) {
    const multiplier = tick / 100;
    const perStat = STAT_KEYS.map(
      (_, k) =>
        residuals[0]![k]!.reduce(
          (s, a, i) => s + Math.abs(a + multiplier * (residuals[1]![k]![i]! - a)),
          0,
        ) / holdIds.length,
    );
    grid.push({ multiplier, mae: perStat.reduce((s, x) => s + x, 0), perStat });
  }
  const best = grid.reduce((a, b) => (b.mae < a.mae ? b : a));
  /** Per-stat argmins (informational: a single stat at n ≤ 48 is noisy). */
  const perStatArgmin = STAT_KEYS.map(
    (_, k) => grid.reduce((a, b) => (b.perStat[k]! < a.perStat[k]! ? b : a)).multiplier,
  );
  const at = (m: number) => grid.find((g) => Math.abs(g.multiplier - m) < 1e-9)!;
  return {
    train: trainIds.length,
    holdout: holdIds.length,
    step: 0.01,
    range: [lo, hi] as const,
    lambdaId,
    lambdaBase,
    weighted,
    best,
    perStatArgmin,
    at,
    grid,
  };
}

/** Direct refit at one multiplier (the test uses it to prove the fast path is exact). */
export function holdoutMaeRefit(
  master: MasterBundle,
  context: GoldenContextInput,
  roster: readonly RosterVeteran[],
  trainIds: readonly string[],
  holdIds: readonly string[],
  multiplier: number,
  lambdaId = 0.1,
  lambdaBase = 0.1,
): number {
  const d = buildDesign(
    loadGoldenContext(master, context, multiplier),
    master,
    roster,
    trainIds,
    holdIds,
  );
  const train = d.rows.slice(0, trainIds.length);
  const hold = d.rows.slice(trainIds.length);
  const w = recencyWeights(train);
  let mae = 0;
  STAT_KEYS.forEach((_, k) => {
    const f = ridge(d, train, w, k, lambdaId, lambdaBase);
    mae += hold.reduce((s, r) => s + Math.abs(r.y[k]! - predict(f.beta, r.x)), 0) / hold.length;
  });
  return mae;
}

/** The three documented train/holdout populations of the feasibility check. */
export function calibrationPopulations(
  roster: readonly RosterVeteran[],
  trainIds: readonly string[],
  holdoutIds: readonly string[],
) {
  return [
    {
      name: '50§4 split (train 192 / holdout 48 eligible rows)',
      train: [...trainIds],
      holdout: [...holdoutIds],
    },
    {
      name: '50§4 train / 50§8 holdout (matched-or-guest holdout rows only)',
      train: [...trainIds],
      holdout: matchedGuestIds(roster, holdoutIds),
    },
    {
      name: '50§8 train / 50§8 holdout (matched-or-guest rows on both sides)',
      train: matchedGuestIds(roster, trainIds),
      holdout: matchedGuestIds(roster, holdoutIds),
    },
  ];
}
