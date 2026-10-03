/**
 * T05b Q-124 probe: the skill-hint / acquisition double count.
 *
 *   node docs/reference/model-semantics/probes/q124-skills.ts           # print
 *   node docs/reference/model-semantics/probes/q124-skills.ts --write   # + results/q124-skills.json
 *
 * Part A uses SYNTHETIC parameters only (labelled). Part B fits on the stored golden TRAIN split
 * (truth.holdout.trainIds) from observable inputs, evaluates on the untouched holdout, and checks
 * golden best-pair / trap feasibility with the Q-123 fit. Planted rates appear only in a labelled
 * ORACLE block and never feed an estimator.
 */
import { readFileSync } from 'node:fs';
import { APT_KEYS, GRADES, STAT_KEYS } from '../../../../packages/schema/src/index.ts';
import type { Grade, StatKey } from '../../../../packages/schema/src/index.ts';
import {
  expectationFromPlan,
  legacyFromVeteran,
  mulberry32,
  planInheritance,
  sampleInheritance,
  seedFromString,
} from '../../../../packages/engine/src/index.ts';
import type { InheritanceResult } from '../../../../packages/engine/src/index.ts';
import { predict } from '../../../../packages/engine/scripts/golden-diagnostic.ts';
import { mvnDraw } from '../src/covariance.ts';
import { writeResult } from '../src/output.ts';
import { fitSplit, loadGolden, planFeatures, skillCells } from '../src/golden.ts';
import type { SkillCell } from '../src/golden.ts';
import { betaMean, fitGlobalPrior, skillPosterior } from '../src/skills.ts';
import type { BetaParams, Exposure } from '../src/skills.ts';
import { naiveBeta, repeatedSampling, syntheticRows } from '../src/synthetic.ts';

const write = process.argv.includes('--write');
const f4 = (x: number) => Number(x.toFixed(4));
type Mode = 'independent' | 'manual';
const MODES: Mode[] = ['independent', 'manual'];

// ------------------------------------------------------------------------------------------------
// Part A: SYNTHETIC examples (θ known by construction; not game facts).
// ------------------------------------------------------------------------------------------------
const P: BetaParams = { a: 2, b: 2 }; // SYNTHETIC prior
const TH = 0.6; // SYNTHETIC conditional rate
const lineageRows = syntheticRows('t05b-q124-syn:lineage', 400, TH, 0.1, 0.9);
const e = skillPosterior(P, lineageRows);
const nv = naiveBeta(P, lineageRows);
const childQ = 0.5; // SYNTHETIC hint probability of a new child plan
const sureRows = syntheticRows('t05b-q124-syn:sure', 400, TH, 1, 1);
const sureE = skillPosterior(P, sureRows);
const sureN = naiveBeta(P, sureRows);
const synthetic = {
  note: 'SYNTHETIC parameters (prior Beta(2,2), θ=0.6, q~U(0.1,0.9), n=400, child q=0.5); not game facts',
  lineageOnly: {
    seed: 't05b-q124-syn:lineage',
    successes: e.successes,
    exposure: f4(e.exposure),
    exposureAware: {
      mean: f4(e.mean),
      sd: f4(Math.sqrt(e.variance)),
      stored: { a: f4(e.beta.a), b: f4(e.beta.b) },
      quadratureRelErr: e.quadratureRelErr,
    },
    naiveConjugate: { mean: f4(betaMean(nv)), a: nv.a, b: nv.b },
    childAcquireProb: {
      truth: f4(childQ * TH),
      exposureAwareOnce: f4(childQ * e.mean),
      naiveTimesHintAgain_doubleCount: f4(childQ * betaMean(nv)),
      naiveWithoutHint_dropActivation: f4(betaMean(nv)),
    },
  },
  guaranteedOnly_qEquals1: {
    seed: 't05b-q124-syn:sure',
    exposureAware: { a: sureE.beta.a, b: sureE.beta.b, method: sureE.method },
    conjugate: sureN,
    identical: sureE.beta.a === sureN.a && sureE.beta.b === sureN.b,
  },
  noOpportunities: (() => {
    const r = skillPosterior(P, [
      { q: 0, y: 0 },
      { q: 0, y: 0 },
    ]);
    return { method: r.method, beta: r.beta, used: r.used };
  })(),
  rareSkill_oneLineageSuccess: (() => {
    const r = skillPosterior(P, [{ q: 0.2, y: 1 }]);
    return {
      method: r.method,
      beta: r.beta,
      mean: f4(r.mean),
      note: 'q<1 success: A += 1 (the q factor cancels)',
    };
  })(),
  rareSkill_oneLineageFailure: (() => {
    const r = skillPosterior(P, [{ q: 0.2, y: 0 }]);
    return {
      method: r.method,
      mean: f4(r.mean),
      priorMean: 0.5,
      stored: { a: f4(r.beta.a), b: f4(r.beta.b) },
    };
  })(),
  contradiction: (() => {
    const r = skillPosterior(P, [
      { q: 0, y: 1 },
      { q: 1, y: 1 },
    ]);
    return {
      contradictions: r.contradictions,
      used: r.used,
      beta: r.beta,
      note: 'q=0,y=1 excluded and reported',
    };
  })(),
  repeatedSampling: {
    note: 'SYNTHETIC: 200 seeded datasets each, θ=0.6, prior Beta(2,2); share with |θ̂−θ| ≤ z0.9·sd',
    lineage_n400: repeatedSampling({
      seed: 't05b-q124-rep:a',
      reps: 200,
      n: 400,
      theta: TH,
      qLo: 0.1,
      qHi: 0.9,
      prior: P,
    }),
    lineage_n40: repeatedSampling({
      seed: 't05b-q124-rep:b',
      reps: 200,
      n: 40,
      theta: TH,
      qLo: 0.1,
      qHi: 0.9,
      prior: P,
    }),
    sure_n40: repeatedSampling({
      seed: 't05b-q124-rep:c',
      reps: 200,
      n: 40,
      theta: TH,
      qLo: 1,
      qHi: 1,
      prior: P,
    }),
  },
};
console.log('== Q-124 Part A (SYNTHETIC)');
console.log(JSON.stringify(synthetic));

// ------------------------------------------------------------------------------------------------
// Part B: golden data, observable inputs only.
// ------------------------------------------------------------------------------------------------
const g = loadGolden();
const h = g.truth.holdout;
const trainCells = skillCells(g, h.trainIds);
const holdCells = skillCells(g, h.holdoutIds);

type Method = 'exposure' | 'naiveDoubleCount' | 'naiveDropActivation' | 'conservativeSureOnly';
const METHODS: Method[] = [
  'exposure',
  'naiveDoubleCount',
  'naiveDropActivation',
  'conservativeSureOnly',
];

const bySkill = (cells: readonly SkillCell[], mode: Mode, filter: (c: SkillCell) => boolean) => {
  const m = new Map<string, Exposure[]>();
  for (const c of cells)
    if (c.mode === mode && filter(c)) {
      const l = m.get(c.skillId) ?? [];
      l.push({ q: c.q, y: c.y });
      m.set(c.skillId, l);
    }
  return m;
};

interface Fitted {
  prior: Record<Mode, BetaParams>;
  priorStatus: Record<Mode, string>;
  table: Record<Mode, Map<string, BetaParams>>;
  /** Multiply by q at prediction? */
  timesQ: boolean;
}

function fitMethod(method: Method): Fitted {
  const prior = {} as Record<Mode, BetaParams>;
  const priorStatus = {} as Record<Mode, string>;
  const table = { independent: new Map(), manual: new Map() } as Record<
    Mode,
    Map<string, BetaParams>
  >;
  for (const mode of MODES) {
    const sel: (c: SkillCell) => boolean =
      method === 'conservativeSureOnly' ? (c) => c.sure : (c) => c.q > 0;
    const rows = bySkill(trainCells, mode, sel);
    // Naive variants treat every candidate as exposed (q := 1) in both prior and posterior.
    const asFit =
      method === 'exposure' || method === 'conservativeSureOnly'
        ? rows
        : new Map([...rows].map(([k, v]) => [k, v.map((x) => ({ q: 1, y: x.y }))]));
    const pf = fitGlobalPrior(asFit);
    prior[mode] = pf.prior;
    priorStatus[mode] =
      `${pf.status} (skills ${pf.skillsUsed}, mean ${f4(pf.mean)}, ν ${f4(pf.prior.a + pf.prior.b)})`;
    for (const [s, r] of asFit) table[mode].set(s, skillPosterior(pf.prior, r).beta);
  }
  return { prior, priorStatus, table, timesQ: method !== 'naiveDropActivation' };
}

const fits = Object.fromEntries(METHODS.map((m) => [m, fitMethod(m)])) as Record<Method, Fitted>;
const theta = (f: Fitted, mode: Mode, s: string) => betaMean(f.table[mode].get(s) ?? f.prior[mode]);
const predCell = (f: Fitted, c: SkillCell) => (f.timesQ ? c.q : 1) * theta(f, c.mode, c.skillId);

function reliability(f: Fitted, cells: readonly SkillCell[]) {
  const use = cells.filter((c) => c.q > 0);
  let sp = 0;
  let sy = 0;
  let brier = 0;
  let ll = 0;
  const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const c of use) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, predCell(f, c)));
    sp += p;
    sy += c.y;
    brier += (p - c.y) ** 2;
    ll += c.y ? -Math.log(p) : -Math.log(1 - p);
    const b = bins[Math.min(4, Math.floor(p * 5))]!;
    b.n++;
    b.p += p;
    b.y += c.y;
  }
  const sd = Math.sqrt(
    use.reduce((s, c) => {
      const p = predCell(f, c);
      return s + p * (1 - p);
    }, 0),
  );
  // ORACLE (labelled): the same cells' expected count under the planted rates × q.
  const oracleExpected = use.reduce(
    (s, c) => s + c.q * g.truth.skills.rates[c.mode][c.skillId]!,
    0,
  );
  return {
    cells: use.length,
    expected: f4(sp),
    observed: sy,
    oracleExpected_plantedRatesTimesQ: f4(oracleExpected),
    zObservedMinusExpected: f4((sy - sp) / sd),
    brier: f4(brier / use.length),
    logLoss: f4(ll / use.length),
    bins: bins
      .filter((b) => b.n)
      .map((b) => ({ n: b.n, meanPred: f4(b.p / b.n), obsRate: f4(b.y / b.n) })),
  };
}

const evalSets = {
  all: holdCells,
  guaranteed: holdCells.filter((c) => c.sure),
  lineageOnly: holdCells.filter((c) => !c.sure && c.q > 0),
};
const holdoutReliability = Object.fromEntries(
  METHODS.map((m) => [
    m,
    Object.fromEntries(Object.entries(evalSets).map(([k, v]) => [k, reliability(fits[m], v)])),
  ]),
);
const cellCounts = {
  train: {
    total: trainCells.length,
    guaranteed: trainCells.filter((c) => c.sure).length,
    lineageOnly: trainCells.filter((c) => !c.sure && c.q > 0).length,
    lineageOnlyMeanQ: f4(
      trainCells.filter((c) => !c.sure && c.q > 0).reduce((s, c) => s + c.q, 0) /
        trainCells.filter((c) => !c.sure && c.q > 0).length,
    ),
    contradictions_q0_acquired: trainCells.filter((c) => c.q === 0 && c.y === 1).length,
    lineageOnlySkills: Object.fromEntries(
      MODES.map((mode) => {
        const sure = new Set(
          trainCells.filter((c) => c.mode === mode && c.sure).map((c) => c.skillId),
        );
        const lin = new Set(
          trainCells.filter((c) => c.mode === mode && !c.sure && c.q > 0).map((c) => c.skillId),
        );
        const only = [...lin].filter((s) => !sure.has(s));
        return [
          mode,
          { skillsWithLineageEvidence: lin.size, skillsWithOnlyLineageEvidence: only.length },
        ];
      }),
    ),
  },
  holdout: {
    total: holdCells.length,
    guaranteed: evalSets.guaranteed.length,
    lineageOnly: evalSets.lineageOnly.length,
    contradictions_q0_acquired: holdCells.filter((c) => c.q === 0 && c.y === 1).length,
  },
};

// ORACLE diagnostic (planted rates; never an estimator input): exposure-weighted |θ̂ − rate|.
function oracle(f: Fitted) {
  const out: Record<string, number> = {};
  for (const mode of MODES) {
    let w = 0;
    let err = 0;
    for (const c of trainCells)
      if (c.mode === mode && c.q > 0) {
        w += c.q;
        err += c.q * Math.abs(theta(f, mode, c.skillId) - g.truth.skills.rates[mode][c.skillId]!);
      }
    out[mode] = f4(err / w);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Golden feasibility: fast-pass ranking of all legal pairs for golden-cm-1 with the Q-123 fit
// (train split, Σ_N) and each skill method; precise seeded MC for the top 12.
// ------------------------------------------------------------------------------------------------
const fit = fitSplit(g, h.trainIds, h.holdoutIds);
const gold = g.truth.golden;
const targets = JSON.parse(
  readFileSync(
    new URL('../../../../packages/engine/test/golden/targets.json', import.meta.url),
    'utf8',
  ),
) as {
  name: string;
  minStats: Partial<Record<StatKey, number>>;
  minAptitudes: Record<string, Grade>;
  requiredSkills: string[];
}[];
const target = targets.find((t) => t.name === gold.targetName)!;
const x = planFeatures(g, fit.design, {
  traineeOutfitId: gold.traineeOutfitId,
  deck: gold.planDeck,
  trainMode: gold.trainMode,
  scenarioId: gold.scenarioId,
});
const mu = fit.beta.map((b) => predict(b, x));
const statCap = g.master.scenarios.find((sc) => sc.id === gold.scenarioId)!.statCap;
const cards = new Map(g.master.cards.map((c) => [c.id, c]));
const traineeOutfit = g.master.outfits.find((o) => o.id === gold.traineeOutfitId)!;
const planSure = new Set(traineeOutfit.innateSkillIds);
for (const d of gold.planDeck)
  for (const s of [...cards.get(d.cardId)!.hintSkillIds, ...cards.get(d.cardId)!.eventSkillIds])
    planSure.add(s);

function erf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return z >= 0 ? y : -y;
}
const upper = (z: number) => 0.5 * (1 - erf(z / Math.SQRT2));
const pHint = (e: InheritanceResult, s: string) =>
  planSure.has(s) ? 1 : (e.skillHintProb[s] ?? 0);

function fastPMeet(e: InheritanceResult, f: Fitted): number {
  let p = 1;
  for (const [apt, min] of Object.entries(target.minAptitudes)) {
    let q = 0;
    for (const [gr, pr] of Object.entries(e.aptitudeDist[apt as (typeof APT_KEYS)[number]]))
      if (GRADES.indexOf(gr as Grade) >= GRADES.indexOf(min)) q += pr;
    p *= q;
  }
  for (const s of target.requiredSkills)
    p *= (f.timesQ ? pHint(e, s) : pHint(e, s) > 0 ? 1 : 0) * theta(f, gold.trainMode, s);
  for (const [k, min] of Object.entries(target.minStats) as [StatKey, number][]) {
    const i = STAT_KEYS.indexOf(k);
    const sd = Math.sqrt(fit.cov.residualCov[i]![i]! + e.statGainCov[i]![i]!);
    // 50 §5/§7: stats are clipped train + inheritance WITHOUT rounding, so no continuity
    // correction (T05b review S3). P(stat ≥ min) for the unclipped Gaussian; the golden data never
    // reaches the clip bounds [1, statCap].
    p *= upper((min - (mu[i]! + e.expectedStatGain[i]!)) / sd);
  }
  return p;
}

const pairs: {
  ids: [string, string];
  plan: ReturnType<typeof planInheritance>;
  e: InheritanceResult;
}[] = [];
for (let i = 0; i < g.roster.length; i++)
  for (let j = i + 1; j < g.roster.length; j++) {
    const a = g.roster[i]!;
    const b = g.roster[j]!;
    if (a.characterId === b.characterId) continue;
    if (a.characterId === gold.traineeCharacterId || b.characterId === gold.traineeCharacterId)
      continue;
    const plan = planInheritance(
      g.ctx,
      gold.traineeOutfitId,
      [legacyFromVeteran(a), legacyFromVeteran(b)],
      gold.scenarioId,
    );
    pairs.push({ ids: [a.id, b.id], plan, e: expectationFromPlan(plan) });
  }
const same = (p: readonly string[], q: readonly string[]) => p.includes(q[0]!) && p.includes(q[1]!);

/** 50 §5 Monte Carlo: inh once, train ~ MVN(xβ, Σ_N), hinted sampled once, acquired ~ Bern(E θ). */
function mcPMeet(pr: (typeof pairs)[number], f: Fitted, samples = 2000) {
  const seed = `t05b-q124-mc:${[...pr.ids].sort().join('|')}`;
  const inhRng = mulberry32(seedFromString(`${seed}:inh`));
  const trRng = mulberry32(seedFromString(`${seed}:train`));
  const skRng = mulberry32(seedFromString(`${seed}:skill`));
  let meet = 0;
  let acq = 0;
  for (let s = 0; s < samples; s++) {
    const inh = sampleInheritance(pr.plan, inhRng);
    const t = mvnDraw(fit.cov.factor, trRng);
    let ok = true;
    for (const [k, min] of Object.entries(target.minStats) as [StatKey, number][]) {
      const i = STAT_KEYS.indexOf(k);
      // Unrounded (T05b review S3); clip to [1, statCap] as 50 §5 step 3 (never binds here).
      const stat = Math.min(statCap, Math.max(1, mu[i]! + t[i]! + inh.statGain[i]!));
      if (stat < min) ok = false;
    }
    for (const [apt, min] of Object.entries(target.minAptitudes))
      if (GRADES.indexOf(inh.aptitudes[apt as (typeof APT_KEYS)[number]]) < GRADES.indexOf(min))
        ok = false;
    for (const sk of target.requiredSkills) {
      // Availability sampled ONCE (exposure, naive double count, conservative); the drop-
      // activation variant treats any potential lineage source as certain availability.
      const hinted = f.timesQ
        ? planSure.has(sk) || (inh.hints[sk] ?? 0) > 0
        : planSure.has(sk) || (pr.e.skillHintProb[sk] ?? 0) > 0;
      const got = hinted && skRng() < theta(f, gold.trainMode, sk);
      if (got) acq++;
      if (!got) ok = false;
    }
    if (ok) meet++;
  }
  return { pMeet: meet / samples, pAcquireX: acq / samples };
}

const feasibility: Record<string, unknown> = {};
for (const m of METHODS) {
  const f = fits[m];
  const scored = pairs
    .map((p) => ({ ...p, p: fastPMeet(p.e, f) }))
    .sort((a, b) => b.p - a.p || (a.ids.join() < b.ids.join() ? -1 : 1));
  const bestRank = scored.findIndex((s) => same(s.ids, gold.bestPair.parents)) + 1;
  const trapRank = scored.findIndex((s) => same(s.ids, gold.trapPair.parents)) + 1;
  const top = scored.slice(0, 12).map((s) => ({ s, mc: mcPMeet(s, f) }));
  top.sort((a, b) => b.mc.pMeet - a.mc.pMeet);
  const best = top.find((t) => same(t.s.ids, gold.bestPair.parents));
  const xHint = pHint(scored[bestRank - 1]!.e, gold.skillX);
  feasibility[m] = {
    pairs: scored.length,
    fastBestRank: bestRank,
    fastTrapRank: trapRank,
    fastTrapPMeet: scored[trapRank - 1]!.p,
    fastBestPMeet: f4(scored[bestRank - 1]!.p),
    fastSecondPMeet: f4(scored[bestRank === 1 ? 1 : 0]!.p),
    mcTop12BestRank: best ? top.indexOf(best) + 1 : null,
    mcBestPMeet: best ? best.mc.pMeet : null,
    bestPairXHintProb: f4(xHint),
    thetaX: f4(theta(f, gold.trainMode, gold.skillX)),
    fastPAcquireX: f4((f.timesQ ? xHint : 1) * theta(f, gold.trainMode, gold.skillX)),
    mcPAcquireX: best ? best.mc.pAcquireX : null,
  };
}

const xTrain = trainCells.filter((c) => c.skillId === gold.skillX);
const golden = {
  split: 'stored truth.holdout: fit on 192 train rows, evaluate on 48 holdout rows',
  cellCounts,
  priors: Object.fromEntries(METHODS.map((m) => [m, fits[m].priorStatus])),
  holdoutReliability,
  skillXTrainCells: xTrain.map((c) => ({
    row: c.rowId,
    mode: c.mode,
    q: f4(c.q),
    sure: c.sure,
    y: c.y,
  })),
  feasibility,
  oracle: {
    note: 'ORACLE diagnostic only: exposure-weighted mean |posterior mean − planted conditional rate| over train candidate cells; planted rates never feed an estimator',
    ...Object.fromEntries(METHODS.map((m) => [m, oracle(fits[m])])),
  },
};
console.log('== Q-124 Part B (golden)');
console.log(JSON.stringify(golden));

if (write) {
  const out = new URL('../results/q124-skills.json', import.meta.url);
  await writeResult(out, {
    command: 'node docs/reference/model-semantics/probes/q124-skills.ts --write',
    synthetic,
    golden,
  });
}
