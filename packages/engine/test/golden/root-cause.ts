/**
 * ROOT-CAUSE ONLY (T08 review round 2 B1):
 *   node packages/engine/test/golden/root-cause.ts [--baseline] [--calibration]
 *
 * Latents are read here to attribute the holdout-MAE argmin bias to its nuisance sources. They are
 * NEVER an input of an acceptance fit: `calibration.test.ts` and `calibrationScan` read roster rows,
 * the stored split and the engine expectation only.
 *
 * --baseline     read the immutable pre-fix dae3cc5 git objects (no worktree mutation).
 * --calibration  analyse the ×1.3 roster (planted multiplier 1.3) instead of the base roster (1.0).
 *
 * Ablations rebuild every eligible row's stats from its latent parts instead of the observed stat:
 *   clean       training + E[inh | recorded lineage]          (no nuisance: must give the planted m)
 *   noise       clean + MVN noise
 *   activation  clean + (sampled inheritance − E[inh])
 *   combined    clean + both (= the real roster up to rounding)
 * The scan is the same TEST-ONLY holdout-MAE scan as the feasibility test (λ 0.1/0.1, stored split).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { STAT_KEYS } from '@uma/schema';
import type { RosterVeteran } from '@uma/schema';
import type { GoldenLatent, GoldenTruth } from '../../scripts/golden-context.ts';
import { loadGoldenContext } from '../../scripts/golden-context.ts';
import { loadPublishedBundle } from '../../scripts/published-bundle.ts';
import { buildDesign } from '../../scripts/golden-diagnostic.ts';
import { calibrationScan, matchedGuestIds } from './calibration-diagnostic.ts';

const baseline = process.argv.includes('--baseline');
const calibration = process.argv.includes('--calibration');
const read = (f: string) =>
  JSON.parse(
    baseline
      ? execFileSync('git', ['show', `dae3cc5:packages/engine/test/golden/${f}`], {
          encoding: 'utf8',
          maxBuffer: 10_000_000,
        })
      : readFileSync(new URL(f, import.meta.url), 'utf8'),
  );
const truth = read('truth.json') as GoldenTruth;
const roster = read(
  calibration ? 'roster.calibration-x1.3.json' : 'roster.json',
) as RosterVeteran[];
const latent: Record<string, GoldenLatent> = calibration ? truth.calibration.latent : truth.latent;
const planted = calibration ? 1.3 : 1;
const master = loadPublishedBundle();
const h = truth.holdout;
const lo = calibration ? 1 : 0.5;
const byId = new Map(roster.map((v) => [v.id, v]));

// E[inh] at the PLANTED multiplier (diagnosis only) and at 0 (the blue-signal direction).
const d = buildDesign(
  loadGoldenContext(master, truth, planted),
  master,
  roster,
  h.trainIds,
  h.holdoutIds,
);
const zero = buildDesign(
  loadGoldenContext(master, truth, 0),
  master,
  roster,
  h.trainIds,
  h.holdoutIds,
);
const index = new Map(d.rows.map((r, i) => [r.id, i]));
const expected = (id: string, s: number) =>
  byId.get(id)!.stats[STAT_KEYS[s]!] - d.rows[index.get(id)!]!.y[s]!;
/** Blue signal per (row, stat): E[inh | planted m] − E[inh | 0]. */
const signal = (id: string, s: number) =>
  zero.rows[index.get(id)!]!.y[s]! - d.rows[index.get(id)!]!.y[s]!;

console.log(
  JSON.stringify({
    data: baseline ? 'dae3cc5' : 'working tree',
    roster: calibration ? 'x1.3' : 'base',
    plantedMultiplier: planted,
    eligible: d.rows.length,
    lineage:
      'guest and unmatched parents carry null grandparents in BOTH the generator plan and the recorded design; matched parents use legacyFromVeteran(roster record). golden.ts asserts generator E[inh] == recorded-lineage E[inh] on all eligible rows.',
  }),
);
for (const component of ['clean', 'noise', 'activation', 'combined'] as const) {
  const changed = roster.map((v) => {
    if (!index.has(v.id)) return v;
    const l = latent[v.id]!;
    const stats = Object.fromEntries(
      STAT_KEYS.map((k, s) => {
        const e = expected(v.id, s);
        const n = component === 'noise' || component === 'combined' ? l.noise[s]! : 0;
        const a =
          component === 'activation' || component === 'combined' ? l.inheritance[s]! - e : 0;
        return [k, l.training[s]! + e + n + a];
      }),
    );
    return { ...v, stats } as RosterVeteran;
  });
  const scan = calibrationScan(master, truth, changed, h.trainIds, h.holdoutIds, { lo });
  console.log('ABLATION', component, scan.best.multiplier, scan.best.mae.toFixed(4));
}
for (const [weighted, li, lb] of [
  [true, 0.1, 0.1],
  [false, 0.1, 0.1],
  [true, 1e-6, 1e-6],
  [false, 1e-6, 1e-6],
] as const) {
  const scan = calibrationScan(master, truth, roster, h.trainIds, h.holdoutIds, {
    lo,
    weighted,
    lambdaId: li,
    lambdaBase: lb,
  });
  console.log(
    'WEIGHT/PENALTY',
    JSON.stringify({ weighted, lambdaId: li, lambdaBase: lb }),
    scan.best.multiplier,
  );
}
const corr = (a: number[], b: number[]) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  const c = a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb), 0);
  const va = a.reduce((s, x) => s + (x - ma) ** 2, 0);
  const vb = b.reduce((s, x) => s + (x - mb) ** 2, 0);
  return +(c / Math.sqrt(va * vb)).toFixed(3);
};
// Finite-sample correlation of nuisance draws with the blue signal (independent in expectation;
// a non-zero sample correlation tilts the MAE argmin).
for (const [name, ids] of [
  ['train', h.trainIds],
  ['holdout', h.holdoutIds],
  ['holdout50§8', matchedGuestIds(roster, h.holdoutIds)],
] as const) {
  console.log(
    'CORR',
    name,
    ids.length,
    JSON.stringify(
      STAT_KEYS.map((k, s) => ({
        stat: k,
        noise: corr(
          ids.map((id) => latent[id]!.noise[s]!),
          ids.map((id) => signal(id, s)),
        ),
        activation: corr(
          ids.map((id) => latent[id]!.inheritance[s]! - expected(id, s)),
          ids.map((id) => signal(id, s)),
        ),
      })),
    ),
  );
}
