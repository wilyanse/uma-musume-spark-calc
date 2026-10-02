/**
 * T05b Q-123 probe: independently reproduces the ADR-0002 covariance estimator on the committed
 * T08 golden data and writes compact machine-readable results.
 *
 *   node docs/reference/model-semantics/probes/q123-covariance.ts                       # stored split
 *   node docs/reference/model-semantics/probes/q123-covariance.ts --splits 40 --write   # + robustness, JSON
 *
 * Output: stdout summary; with --write also results/q123-covariance.json. Every random stream is
 * seeded from a printed label. Estimators read only observable inputs (roster rows, recorded
 * lineage, engine closed form); planted values appear only in labelled ORACLE blocks.
 */
import {
  mulberry32,
  sampleInheritance,
  seedFromString,
} from '../../../../packages/engine/src/index.ts';
import { coverageVariants } from '../../../../packages/engine/scripts/golden-diagnostic.ts';
import {
  gaussianCoverage,
  holdoutBias,
  mvnDraw,
  N_STATS,
  quantileSorted,
} from '../src/covariance.ts';
import { floorPsd, minEigenvalue, solveSpd, symmetrize, trace, zeros } from '../src/linalg.ts';
import { writeResult } from '../src/output.ts';
import { fitSplit, loadGolden, mcCoverage, recovery, shuffled } from '../src/golden.ts';

const args = process.argv.slice(2);
const nSplits = args.includes('--splits') ? Number(args[args.indexOf('--splits') + 1] ?? 40) : 0;
const write = args.includes('--write');
const f4 = (x: number) => Number(x.toFixed(4));
const f2 = (x: number) => Number(x.toFixed(2));
const diag = (m: number[][]) => m.map((r, k) => r[k]!);

const g = loadGolden();
const h = g.truth.holdout;
const fit = fitSplit(g, h.trainIds, h.holdoutIds);
const d = fit.cov.diagnostics;

// --- Baseline anchors: the committed T08 variants, recomputed through the T08 helper. ------------
const base = coverageVariants(fit.design, fit.train, fit.hold, fit.lambdas);

// --- Option A (rejected): deconvolve the centred HOLDOUT covariance with holdout-weighted C̄. ----
const Wh = fit.holdout.reduce((s, r) => s + r.w, 0);
const cHold = zeros(N_STATS);
for (const r of fit.holdout)
  for (let k = 0; k < N_STATS; k++)
    for (let j = 0; j < N_STATS; j++) cHold[k]![j]! += (r.w * r.inhCov[k]![j]!) / Wh;
const rawA = base.residualCov.map((row, k) => row.map((x, j) => x - cHold[k]![j]!));
const optA = floorPsd(symmetrize(rawA), 1e-6 * Math.max(1, trace(base.residualCov) / N_STATS));

// --- Stored-split coverage of the chosen estimator (B). -------------------------------------------
const gauss = gaussianCoverage(fit.cov.residualCov, fit.holdout);
const gaussNoInh = gaussianCoverage(fit.cov.residualCov, fit.holdout, false);
const mcSeeds = Array.from({ length: 5 }, (_, i) => `t05b-q123-mc:${i}`);
const mc = mcSeeds.map((s) => mcCoverage(g, fit.cov, fit.holdout, s));
const mcA = mcCoverage(g, { ...fit.cov, factor: optA.factor }, fit.holdout, 't05b-q123-mc:0');
const bias = holdoutBias(fit.holdout);
let t2 = NaN;
try {
  const sol = solveSpd(bias.varMean, bias.mean);
  t2 = bias.mean.reduce((s, x, k) => s + x * sol[k]!, 0);
} catch {
  /* singular holdout covariance: leave NaN */
}

// --- No-leakage: perturb every holdout y; β, λ and Σ_N must be bit-identical. -------------------
const perturbed = new Map(
  fit.hold.map((r, i) => [r.id, r.y.map((y, k) => y + 1000 * Math.sin(i + k) + 37)]),
);
const fitP = fitSplit(g, h.trainIds, h.holdoutIds, { yOverride: perturbed });
const bitEq = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]));
const noLeakage = {
  note: 'holdout y perturbed by 1000·sin(i+k)+37; train untouched',
  lambdasIdentical:
    JSON.stringify(fitP.lambdas.map((l) => [l.lambdaId, l.lambdaBase])) ===
    JSON.stringify(fit.lambdas.map((l) => [l.lambdaId, l.lambdaBase])),
  betaBitIdentical: fit.beta.every((b, k) => bitEq(b, fitP.beta[k]!)),
  residualCovBitIdentical: fit.cov.residualCov.every((r, k) => bitEq(r, fitP.cov.residualCov[k]!)),
  coverageChanged:
    f4(gaussianCoverage(fitP.cov.residualCov, fitP.holdout).pooled) !== f4(gauss.pooled),
};

// --- MC vs fast-pass variance: empirical Var(train + inh) vs Σ_N,kk + C_i,kk on holdout rows. ----
const ratios: number[] = [];
for (const r of fit.holdout.slice(0, 12)) {
  const { plan } = g.lineage.get(r.id)!;
  const inhRng = mulberry32(seedFromString(`t05b-q123-var:${r.id}:inh`));
  const trRng = mulberry32(seedFromString(`t05b-q123-var:${r.id}:train`));
  const n = 20000;
  const s1 = new Array<number>(N_STATS).fill(0);
  const s2 = new Array<number>(N_STATS).fill(0);
  for (let s = 0; s < n; s++) {
    const inh = sampleInheritance(plan, inhRng).statGain;
    const t = mvnDraw(fit.cov.factor, trRng);
    for (let k = 0; k < N_STATS; k++) {
      const v = t[k]! + inh[k]!;
      s1[k]! += v;
      s2[k]! += v * v;
    }
  }
  for (let k = 0; k < N_STATS; k++) {
    const emp = s2[k]! / n - (s1[k]! / n) ** 2;
    ratios.push(emp / (fit.cov.residualCov[k]![k]! + r.inhCov[k]![k]!));
  }
}
const varianceConsistency = {
  note: '12 holdout rows × 5 stats, 20000 seeded draws each (labels t05b-q123-var:<id>:inh|train); ratio = empirical MC variance / (Σ_N,kk + Var[inh_k])',
  minRatio: f4(Math.min(...ratios)),
  maxRatio: f4(Math.max(...ratios)),
  meanRatio: f4(ratios.reduce((s, x) => s + x, 0) / ratios.length),
};

// --- Small-sample stability: seeded train subsamples, λ by CV on the subsample. -----------------
const smallSample = [20, 30, 40, 60, 100].map((n) => {
  let floored = 0;
  let warned = 0;
  let minEig = Infinity;
  let finite = true;
  const reps = 10;
  for (let rep = 0; rep < reps; rep++) {
    const ids = shuffled(h.trainIds, mulberry32(seedFromString(`t05b-q123-small:${n}:${rep}`)))
      .slice(0, n)
      .sort();
    const f = fitSplit(g, ids, h.holdoutIds);
    floored += f.cov.diagnostics.flooredCount > 0 ? 1 : 0;
    warned += f.cov.diagnostics.warnings.length > 0 ? 1 : 0;
    minEig = Math.min(minEig, minEigenvalue(f.cov.residualCov));
    finite &&= f.cov.residualCov.flat().every(Number.isFinite);
  }
  return {
    n,
    reps,
    fitsWithFlooring: floored,
    fitsWithWarnings: warned,
    minEigenvalue: f4(minEig),
    finite,
  };
});

// --- OOF fold-partition sensitivity (diagnostic; the ADR fixes the CV folds). ------------------
const foldSens = Array.from({ length: 10 }, (_, i) => {
  const f = fitSplit(g, h.trainIds, h.holdoutIds, {
    lambdas: fit.lambdas,
    oofFoldSeed: `t05b-q123-fold:${i}`,
  });
  return {
    gauss: gaussianCoverage(f.cov.residualCov, f.holdout).pooled,
    sdiag: diag(f.cov.diagnostics.totalSecondMoment),
  };
});
const foldSensitivity = {
  note: 'DIAGNOSTIC: 10 alternative seeded OOF fold partitions (labels t05b-q123-fold:<i>), λ fixed at the CV choice; explains why per-stat S differs from the adviser self-report (its fold partition differed)',
  gaussianMin: f4(Math.min(...foldSens.map((x) => x.gauss))),
  gaussianMax: f4(Math.max(...foldSens.map((x) => x.gauss))),
  totalSecondMomentDiagMin: [0, 1, 2, 3, 4].map((k) =>
    f2(Math.min(...foldSens.map((x) => x.sdiag[k]!))),
  ),
  totalSecondMomentDiagMax: [0, 1, 2, 3, 4].map((k) =>
    f2(Math.max(...foldSens.map((x) => x.sdiag[k]!))),
  ),
};

const stored = {
  split: 'truth.holdout (stored, seed 20260930): 192 train / 48 holdout',
  lambdas: fit.lambdas.map((l) => `${l.lambdaId}/${l.lambdaBase}`),
  recovery: recovery(g, fit),
  baselineT08Anchors: {
    note: 'recomputed with packages/engine/scripts/golden-diagnostic.ts coverageVariants (cf. truth.holdout.coverageDiagnostic)',
    literalHoldoutCov: f4(base.literal.pooled),
    literalPlusVarInh_doubleCount: f4(base.plusInheritance.pooled),
    literalNet: f4(base.plusInheritanceNet.pooled),
    trainPlugin: f4(base.trainPlugin.pooled),
  },
  optionA_rejected: {
    note: 'PSD(centred holdout cov − holdout-weighted C̄) + C_i: sets its width from the holdout it is scored on',
    rawEigenvalues: optA.rawEigenvalues.map(f2),
    flooredCount: optA.flooredCount,
    gaussian: f4(gaussianCoverage(optA.sigma, fit.holdout).pooled),
    monteCarloSeed0: f4(mcA.pooled),
  },
  chosenB: {
    trainEss: f2(d.ess),
    oofMean: d.oofMean.map(f2),
    totalSecondMomentDiag: diag(d.totalSecondMoment).map(f2),
    meanInheritanceCovDiag: diag(d.meanInheritanceCov).map(f2),
    rawEigenvalues: d.rawEigenvalues.map(f2),
    epsilon: d.epsilon,
    flooredCount: d.flooredCount,
    jacobiSweeps: d.jacobiSweeps,
    warnings: d.warnings,
    residualCov: fit.cov.residualCov.map((r) => r.map(f2)),
    sigma: fit.cov.sigma.map((x) => Number(x.toFixed(3))),
    sigmaEqualsSqrtDiag: fit.cov.sigma.every(
      (s, k) => s === Math.sqrt(fit.cov.residualCov[k]![k]!),
    ),
    symmetric: fit.cov.residualCov.every((r, i) =>
      r.every((x, j) => x === fit.cov.residualCov[j]![i]),
    ),
    minEigenvalue: f4(minEigenvalue(fit.cov.residualCov)),
    coverageGaussian: { pooled: f4(gauss.pooled), perStat: gauss.perStat.map(f4) },
    coverageGaussianWithoutInheritance: f4(gaussNoInh.pooled),
    coverageMonteCarlo: {
      samples: 2000,
      seeds: mcSeeds,
      pooled: mc.map((c) => f4(c.pooled)),
      min: f4(Math.min(...mc.map((c) => c.pooled))),
      max: f4(Math.max(...mc.map((c) => c.pooled))),
    },
  },
  holdoutBias: {
    weightedMean: bias.mean.map(f2),
    se: bias.se.map(f2),
    hotellingT2: f2(t2),
    chi2_5_95: 11.07,
    note: 'diagnostic only; never subtracted or fed back',
  },
  noLeakage,
  foldSensitivity,
  varianceConsistency,
  smallSample,
  oracle: {
    note: 'ORACLE diagnostic only (planted noise covariance from truth.json; never an estimator input)',
    plantedNoiseSd: g.truth.trainingModel.residualNoise.covariance.map((r, k) =>
      f2(Math.sqrt(r[k]!)),
    ),
  },
};
console.log('== Q-123 stored split');
console.log(JSON.stringify(stored));

let robustness: unknown = null;
if (nSplits > 0) {
  const all = [...h.trainIds, ...h.holdoutIds].sort();
  const gs: number[] = [];
  const ms: number[] = [];
  const floored: number[] = [];
  let recoveryFails = 0;
  for (let rep = 0; rep < nSplits; rep++) {
    const ids = shuffled(all, mulberry32(seedFromString(`t05b-q123-split:${rep}`)));
    const ho = ids.slice(0, 48).sort();
    const tr = ids.slice(48).sort();
    const f = fitSplit(g, tr, ho);
    gs.push(gaussianCoverage(f.cov.residualCov, f.holdout).pooled);
    ms.push(mcCoverage(g, f.cov, f.holdout, `t05b-q123-split-mc:${rep}`, 1000).pooled);
    floored.push(f.cov.diagnostics.flooredCount);
    if (recovery(g, f).failsAt15pct > 0) recoveryFails++;
  }
  const summary = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    return {
      mean: f4(mean),
      sd: f4(sd),
      p5: f4(quantileSorted(s, 0.05)),
      min: f4(s[0]!),
      max: f4(s.at(-1)!),
      inBand: `${xs.filter((x) => x >= 0.72 && x <= 0.88).length}/${xs.length}`,
    };
  };
  robustness = {
    note: 'ROBUSTNESS DIAGNOSTIC, not a gate: seeded alternative 192/48 splits (labels t05b-q123-split:<rep>), λ re-chosen by CV per split; MC uses 1000 samples',
    splits: nSplits,
    gaussian: summary(gs),
    monteCarlo: summary(ms),
    splitsWithFlooring: floored.filter((x) => x > 0).length,
    splitsWithRecoveryFailure: recoveryFails,
  };
  console.log('== Q-123 robustness');
  console.log(JSON.stringify(robustness));
}

if (write) {
  const out = new URL('../results/q123-covariance.json', import.meta.url);
  await writeResult(out, {
    command:
      `node docs/reference/model-semantics/probes/q123-covariance.ts ${args.join(' ')}`.trim(),
    stored,
    robustness,
  });
}
