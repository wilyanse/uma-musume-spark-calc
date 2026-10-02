/**
 * Executable TEST-ONLY diagnostics (T08 review round 2): reproduces every final feasibility number
 * in the changelog from the committed data. Run from the worktree root:
 *
 *   node packages/engine/test/golden/diagnostics.ts            # calibration, recovery, coverage
 *   node packages/engine/test/golden/diagnostics.ts --splits   # + 40 alternative 80/20 splits
 *
 * No `truth.latent` is read here (see root-cause.ts for the latent-based attribution).
 */
import { readFileSync } from 'node:fs';
import { loadPublishedBundle } from '../../scripts/published-bundle.ts';
import { loadGoldenContext } from '../../scripts/golden-context.ts';
import type { GoldenTruth } from '../../scripts/golden-context.ts';
import type { RosterVeteran } from '@uma/schema';
import { STAT_KEYS } from '@uma/schema';
import { mulberry32, seedFromString } from '../../src/index.ts';
import {
  buildDesign,
  chooseLambda,
  coverageVariants,
  effectiveCardEffect,
  effectiveSampleSize,
  holdoutCoverage,
  recencyWeights,
  ridge,
} from '../../scripts/golden-diagnostic.ts';
import { calibrationPopulations, calibrationScan } from './calibration-diagnostic.ts';

const master = loadPublishedBundle();
const read = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const truth = read('truth.json') as GoldenTruth;
const base = read('roster.json') as RosterVeteran[];
const calibration = read('roster.calibration-x1.3.json') as RosterVeteran[];
const h = truth.holdout;
const f2 = (x: number) => x.toFixed(2);
const f4 = (x: number) => x.toFixed(4);

console.log(
  '== CALIBRATION holdout-MAE scan: 0.01 grid on [0.50, 2.00], λ 0.1/0.1, recency-weighted',
);
for (const [name, roster] of [
  ['base', base],
  ['x1.3', calibration],
] as const) {
  for (const p of calibrationPopulations(roster, h.trainIds, h.holdoutIds)) {
    const s = calibrationScan(master, truth, roster, p.train, p.holdout, { lo: 0.5, hi: 2 });
    const at = (m: number) => f2(s.at(m).mae);
    console.log(
      `${name.padEnd(4)} | ${p.name} | n ${s.train}/${s.holdout} | argmin ${f2(s.best.multiplier)} MAE ${f2(s.best.mae)} | ` +
        `MAE@1.0 ${at(1)} @1.2 ${at(1.2)} @1.3 ${at(1.3)} @1.4 ${at(1.4)} @2.0 ${at(2)} | per-stat argmin ${s.perStatArgmin.map(f2).join(',')}`,
    );
  }
}

console.log('== CALIBRATION argmin vs fixed λ (stored split / 50§8 both sides)');
for (const [li, lb] of [
  [0.1, 0.1],
  [0.1, 1],
  [0.1, 10],
  [1, 0.1],
  [1, 1],
  [1, 10],
  [10, 1],
] as const) {
  const cells = [];
  for (const [name, roster] of [
    ['base', base],
    ['x1.3', calibration],
  ] as const) {
    const pops = calibrationPopulations(roster, h.trainIds, h.holdoutIds);
    for (const p of [pops[0]!, pops[2]!]) {
      const s = calibrationScan(master, truth, roster, p.train, p.holdout, {
        lambdaId: li,
        lambdaBase: lb,
      });
      cells.push(`${name}${p === pops[0] ? '' : '§8'} ${f2(s.best.multiplier)}`);
    }
  }
  console.log(`λ ${li}/${lb}: ${cells.join(' | ')}`);
}

const d = buildDesign(loadGoldenContext(master, truth), master, base, h.trainIds, h.holdoutIds);
const train = d.rows.slice(0, h.trainIds.length);
const hold = d.rows.slice(h.trainIds.length);
const w = recencyWeights(train);
const types = new Map(master.cards.map((c) => [c.id, c.type]));
const cv = STAT_KEYS.map((_, k) => chooseLambda(d, train, k));
console.log(
  `== RECOVERY (β_id + β_type vs planted perUnit; train ${train.length}, ESS ${effectiveSampleSize(w).toFixed(1)})`,
);
console.log(
  `CV λ per stat: ${STAT_KEYS.map((k, s) => `${k} ${cv[s]!.lambdaId}/${cv[s]!.lambdaBase}`).join(', ')}`,
);
for (const [li, lb] of [
  [0.1, 0.1],
  [0.1, 1],
  [0.1, 10],
  [1, 0.1],
  [1, 1],
  [1, 10],
  [10, 0.1],
  [10, 1],
  [10, 10],
  [100, 0.1],
  [100, 1],
  [100, 10],
  [-1, -1],
] as const) {
  let worst = 0;
  let zero = 0;
  let example = '';
  let fails = 0;
  STAT_KEYS.forEach((k, s) => {
    const c = li < 0 ? cv[s]! : { lambdaId: li, lambdaBase: lb };
    const fit = ridge(d, train, w, s, c.lambdaId, c.lambdaBase);
    for (const card of truth.trainingModel.plantedCards) {
      const want = card.perUnit[k];
      if (!want) continue;
      const got = effectiveCardEffect(d, fit.beta, card.cardId, card.type);
      const err = Math.abs(got - want) / want;
      if (err >= 0.15) fails++;
      if (err > worst) {
        worst = err;
        example = `${card.cardId.replace('card:', '')}.${k} ${want}->${got.toFixed(2)}`;
      }
    }
    for (const id of truth.trainingModel.zeroEffectCards)
      zero = Math.max(zero, Math.abs(effectiveCardEffect(d, fit.beta, id, types.get(id)!)));
  });
  console.log(
    `λ ${li < 0 ? 'CV' : `${li}/${lb}`}: worst ${(100 * worst).toFixed(2)}% (${example}); fails(≥15%) ${fails}; max |zero-card| ${zero.toFixed(2)}`,
  );
}

console.log('== COVERAGE (holdout 48 × 5 = 240 cells, CV λ; band [0.72, 0.88])');
const sandwich = holdoutCoverage(d, train, hold, cv);
const v = coverageVariants(d, train, hold, cv);
const line = (name: string, c: { pooled: number; perStat: number[] }) =>
  console.log(
    `${name.padEnd(18)} pooled ${f4(c.pooled)} (margins ${f4(c.pooled - 0.72)} / ${f4(0.88 - c.pooled)}) per-stat ${c.perStat.map(f4).join(',')}`,
  );
line('sandwich (stored)', sandwich);
line('literal 50§4', v.literal);
line('+Var[inh]', v.plusInheritance);
line('+Var[inh] net', v.plusInheritanceNet);
line('train plug-in', v.trainPlugin);
console.log(
  `residualCov diag ${v.residualCov.map((r, k) => f2(r[k]!)).join(',')}; train plug-in var ${v.trainVariance.map(f2).join(',')}; mean holdout Var[inh] ${v.meanHoldoutInheritanceVariance.map(f2).join(',')}; sandwich sd ${sandwich.sd.map(f2).join(',')}`,
);

if (process.argv.includes('--splits')) {
  console.log(
    '== ROBUSTNESS: 40 alternative seeded 80/20 splits of the 240 eligible rows (not the stored split)',
  );
  const all = [...h.trainIds, ...h.holdoutIds].sort();
  const res: Record<string, number[]> = { base: [], x13: [], base8: [], x138: [] };
  for (let rep = 0; rep < 40; rep++) {
    const rng = mulberry32(seedFromString(`t08-r2-alt-split:${rep}`));
    const ids = [...all];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const ho = ids.slice(0, 48).sort();
    const tr = ids.slice(48).sort();
    for (const [key, roster] of [
      ['base', base],
      ['x13', calibration],
    ] as const) {
      const pops = calibrationPopulations(roster, tr, ho);
      res[key]!.push(calibrationScan(master, truth, roster, tr, ho).best.multiplier);
      res[`${key}8`]!.push(
        calibrationScan(master, truth, roster, pops[2]!.train, pops[2]!.holdout).best.multiplier,
      );
    }
  }
  for (const [k, xs] of Object.entries(res)) {
    const s = [...xs].sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(
      `${k.padEnd(6)} argmin min ${f2(s[0]!)} median ${f2(s[20]!)} max ${f2(s.at(-1)!)} mean ${f4(mean)} in[1.2,1.4] ${xs.filter((x) => x >= 1.2 && x <= 1.4).length}/40`,
    );
  }
}
