/**
 * 50 §5/§6 and 50 §9 T06 items 2 (MC coverage), 4 (MC variance single count), 5 (availability
 * once), 6 (version guard) and 7 (determinism, independent streams); 70 F09 (quantile order,
 * aptitude normalisation, clipping to the cap without rounding).
 */
import { describe, expect, it } from 'vitest';
import { APT_KEYS, GRADES, STAT_KEYS } from '@uma/schema';
import type { CmTarget, ModelSnapshot } from '@uma/schema';
import {
  planInheritance,
  predictChild,
  prepareModel,
  rankPairs,
  recordedParent,
  RefitRequiredError,
  scoreTarget,
  ScoreRequiresSamplesError,
} from '../../src/index.ts';
import type { ChildPrediction, EngineContext, PredictionSamples } from '../../src/index.ts';
import { preparePlan, simulate } from '../../src/predict/index.ts';
import { quantileSorted } from '../../src/predict/normal.ts';
import {
  byId,
  ctx,
  goldenFit,
  planInput,
  roster,
  storedSplit,
  target,
  truth,
} from '../model/golden-fit.ts';

const { snapshot } = goldenFit();
const best = truth.golden.bestPair.parents.map((id) => byId.get(id)!) as [
  (typeof roster)[number],
  (typeof roster)[number],
];
const X = truth.golden.skillX;

describe('version guard (ADR-0002 §4)', () => {
  const v1 = { ...snapshot, kind: 'training-v1' } as ModelSnapshot;
  it('predictChild and rankPairs reject training-v1 with a typed refit-required error', () => {
    for (const run of [
      () => predictChild(ctx, v1, planInput, best, { seed: 1, samples: 10 }),
      () => rankPairs(ctx, v1, planInput, roster.slice(0, 5), target),
    ]) {
      expect(run).toThrow(RefitRequiredError);
      expect(run).toThrow(expect.objectContaining({ kind: 'training-v1', reason: 'legacy-kind' }));
    }
  });
  it('unknown kinds, malformed params and another master version also require a refit', () => {
    expect(() => prepareModel(ctx, { ...snapshot, kind: 'training-v3' })).toThrow(
      expect.objectContaining({ reason: 'unknown-kind' }),
    );
    expect(() => prepareModel(ctx, null)).toThrow(RefitRequiredError);
    const bad = structuredClone(snapshot);
    bad.params.perStat.spd.coef.pop();
    expect(() => prepareModel(ctx, bad)).toThrow(expect.objectContaining({ reason: 'malformed' }));
    expect(() => prepareModel(ctx, { ...snapshot, masterVersion: 'other' })).toThrow(
      expect.objectContaining({ reason: 'master-version-mismatch' }),
    );
    expect(() => prepareModel(ctx, snapshot)).not.toThrow();
  });
});

describe('predictChild summaries (70 F09)', () => {
  const pred = predictChild(ctx, snapshot, planInput, best, { seed: 'f09', samples: 2000 });

  it('p10 ≤ p50 ≤ p90 per stat, within [1, statCap]', () => {
    for (const k of STAT_KEYS) {
      const s = pred.stats[k];
      expect(s.p10).toBeLessThanOrEqual(s.p50);
      expect(s.p50).toBeLessThanOrEqual(s.p90);
      expect(s.p10).toBeGreaterThanOrEqual(1);
      expect(s.p90).toBeLessThanOrEqual(pred.statCap);
    }
  });

  it('aptitude probabilities are normalised per aptitude and match the exact T05 distribution', () => {
    for (const a of APT_KEYS) {
      const sum = GRADES.reduce((s, g) => s + pred.aptitudes[a][g], 0);
      expect(sum).toBeCloseTo(1, 12);
      const exact = GRADES.reduce((s, g) => s + pred.gaussian.aptitudeDist[a][g], 0);
      expect(exact).toBeCloseTo(1, 12);
      for (const g of GRADES) {
        expect(Math.abs(pred.aptitudes[a][g] - pred.gaussian.aptitudeDist[a][g])).toBeLessThan(
          0.04,
        );
      }
    }
  });

  it('acquisition probabilities are in [0, 1]; the unique skill is never a candidate', () => {
    const unique = ctx.outfits.get(planInput.traineeOutfitId)!.uniqueSkillId;
    expect(pred.skills[unique]).toBeUndefined();
    for (const s of Object.values(pred.skills)) {
      expect(s.pAcquire).toBeGreaterThanOrEqual(0);
      expect(s.pAcquire).toBeLessThanOrEqual(1);
      expect(s.pAcquireMc).toBeGreaterThanOrEqual(0);
      expect(s.pAcquireMc).toBeLessThanOrEqual(1);
    }
    expect(pred.skills[X]!.guaranteed).toBe(false);
    expect(pred.rawSamples).toBeUndefined();
  });

  it('rejects bad sample counts and decks with typed errors', () => {
    expect(() => predictChild(ctx, snapshot, planInput, best, { seed: 1, samples: 0 })).toThrow(
      expect.objectContaining({ code: 'samples' }),
    );
    expect(() =>
      predictChild(ctx, snapshot, { ...planInput, deck: planInput.deck.slice(0, 5) }, best, {
        seed: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'deck-size' }));
  });
});

describe('clipping to [1, statCap] without rounding', () => {
  it('clips at the cap and at 1, never rounds', () => {
    // A context whose scenario cap is 900 (below the planned spd mean) and a model whose wit
    // intercept is shifted far below 1.
    const scenarios = new Map(ctx.scenarios);
    const p = scenarios.get(planInput.scenarioId)!;
    scenarios.set(planInput.scenarioId, { ...p, statCap: () => 900 });
    const capped: EngineContext = { ...ctx, scenarios };
    const low = structuredClone(snapshot);
    low.params.perStat.wit.intercept -= 5000;
    const pred = predictChild(capped, low, planInput, best, {
      seed: 'clip',
      samples: 500,
      keepSamples: true,
    });
    const spd = pred.rawSamples!.stats.spd;
    expect(pred.statCap).toBe(900);
    expect(Math.max(...spd)).toBe(900);
    expect(pred.stats.spd.clippedHigh).toBeGreaterThan(0.5);
    expect(pred.stats.wit.clippedLow).toBe(1);
    expect(pred.stats.wit.p90).toBe(1);
    // Unclipped stats keep their fractional values (no rounding) and equal train + inh exactly.
    const raw = pred.rawSamples!;
    let unclipped = 0;
    let fractional = 0;
    for (const k of STAT_KEYS) {
      raw.stats[k].forEach((v, i) => {
        const sum = raw.training[k][i]! + raw.inheritance[k][i]!;
        expect(v).toBe(Math.min(900, Math.max(1, sum)));
        if (v > 1 && v < 900) {
          unclipped++;
          if (!Number.isInteger(v)) fractional++;
        }
      });
    }
    expect(unclipped).toBeGreaterThanOrEqual(500);
    expect(fractional).toBe(unclipped);
  });
});

describe('determinism and independent streams', () => {
  const run = (seed: string, model = snapshot, pair = best, skills?: string[]) =>
    predictChild(ctx, model, planInput, pair, { seed, samples: 300, keepSamples: true, skills });

  it('the same seed gives identical samples; another seed differs', () => {
    expect(run('d1')).toEqual(run('d1'));
    expect(run('d2').rawSamples!.stats.spd).not.toEqual(run('d1').rawSamples!.stats.spd);
  });

  it('changing inheritance consumption leaves training draws unchanged', () => {
    // A different pair rolls a different number of activations per sample on the inh stream.
    const other = [
      best[0],
      roster.find(
        (v) =>
          v.characterId !== best[0].characterId &&
          v.characterId !== best[1].characterId &&
          v.characterId !== ctx.outfits.get(planInput.traineeOutfitId)!.characterId &&
          v.sparks.length !== best[1].sparks.length,
      )!,
    ] as const;
    const a = run('s', snapshot, best).rawSamples!;
    const b = run('s', snapshot, [...other]).rawSamples!;
    for (const k of STAT_KEYS) expect(b.training[k]).toEqual(a.training[k]);
    expect(
      STAT_KEYS.some((k) => !a.inheritance[k].every((x, i) => x === b.inheritance[k][i])),
    ).toBe(true);
  });

  it('changing training draws leaves inheritance and skill draws unchanged', () => {
    const scaled = structuredClone(snapshot);
    scaled.params.residualCov = scaled.params.residualCov.map((r) => r.map((x) => 4 * x));
    const a = run('s', snapshot).rawSamples!;
    const b = run('s', scaled).rawSamples!;
    for (const k of STAT_KEYS) {
      expect(b.inheritance[k]).toEqual(a.inheritance[k]);
      expect(b.training[k]).not.toEqual(a.training[k]);
    }
    expect(b.skillUniforms).toEqual(a.skillUniforms);
  });

  it('changing skill-stream consumption leaves inheritance and training unchanged', () => {
    const a = run('s', snapshot, best, [X]).rawSamples!;
    const b = run('s', snapshot, best, ['skill:aaa-extra', X, 'skill:zzz-extra']).rawSamples!;
    for (const k of STAT_KEYS) {
      expect(b.training[k]).toEqual(a.training[k]);
      expect(b.inheritance[k]).toEqual(a.inheritance[k]);
    }
    expect(b.skillUniforms[X]).not.toEqual(a.skillUniforms[X]);
  });
});

describe('single count of inheritance and availability', () => {
  const pred = predictChild(ctx, snapshot, planInput, best, {
    seed: 'var',
    samples: 20000,
    keepSamples: true,
    skills: [X],
  });
  const raw = pred.rawSamples!;

  it('MC variance of training + inheritance ≈ Σ_N,kk + Var[inh_k]', () => {
    STAT_KEYS.forEach((k, i) => {
      const xs = raw.training[k].map((t, s) => t + raw.inheritance[k][s]!);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
      const ratio = v / pred.gaussian.variance[i]!;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
      expect(Math.abs(m - pred.gaussian.mean[i]!)).toBeLessThan(4 * Math.sqrt(v / xs.length));
    });
  });

  it('P(acquire) = P(hinted)·E[θ] once, never P(hinted)²·E[θ]', () => {
    const s = pred.skills[X]!;
    expect(s.pHinted).toBeGreaterThan(0.3);
    expect(s.pHinted).toBeLessThan(0.95);
    expect(s.pAcquire).toBeCloseTo(s.pHinted * s.theta, 15);
    const se = Math.sqrt((s.pAcquire * (1 - s.pAcquire)) / raw.n);
    expect(Math.abs(s.pAcquireMc - s.pAcquire)).toBeLessThan(4 * se);
    expect(Math.abs(s.pAcquireMc - s.pHinted ** 2 * s.theta)).toBeGreaterThan(8 * se);
    // Every acquisition used the skill uniform below θ (Bernoulli(E[θ]) given availability).
    const acq = raw.skills[X]!;
    const u = raw.skillUniforms[X]!;
    for (let i = 0; i < raw.n; i++) if (acq[i]) expect(u[i]!).toBeLessThan(s.theta);
  });

  it('a skill with no source is never acquired; a deck skill is acquired at E[θ]', () => {
    const none = 'skill:restraint';
    const trap = truth.golden.trapPair.parents.map((id) => byId.get(id)!) as [
      (typeof best)[0],
      (typeof best)[0],
    ];
    const p = predictChild(ctx, snapshot, planInput, trap, {
      seed: 'none',
      samples: 500,
      skills: [none],
    });
    expect(p.skills[none]!.pHinted).toBe(0);
    expect(p.skills[none]!.pAcquireMc).toBe(0);
    const deckSkill = [...ctx.cards.get(planInput.deck[0]!.cardId)!.hintSkillIds].find(
      (s) => s !== ctx.outfits.get(planInput.traineeOutfitId)!.uniqueSkillId,
    )!;
    const q = predictChild(ctx, snapshot, planInput, best, {
      seed: 'deck',
      samples: 4000,
      skills: [deckSkill],
    });
    expect(q.skills[deckSkill]!.guaranteed).toBe(true);
    expect(q.skills[deckSkill]!.pHinted).toBe(1);
    expect(Math.abs(q.skills[deckSkill]!.pAcquireMc - q.skills[deckSkill]!.theta)).toBeLessThan(
      0.03,
    );
  });
});

describe('stored-split Monte Carlo p10–p90 coverage (50 §9 T06 item 2)', () => {
  it('the seeded §5 MC coverage of the holdout rows with Σ_N is in [0.72, 0.88]', () => {
    const model = prepareModel(ctx, snapshot);
    const results: number[] = [];
    for (const seed of ['t06-mc:0', 't06-mc:1']) {
      let hit = 0;
      let cells = 0;
      for (const id of storedSplit.holdoutIds) {
        const v = byId.get(id)!;
        const pc = preparePlan(ctx, model, {
          traineeOutfitId: v.outfitId,
          deck: v.deck,
          trainMode: v.trainMode,
          scenarioId: v.scenarioId,
        });
        // The row's RECORDED lineage (matched / guest / unmatched rules, as in the fit).
        const legs = [
          recordedParent(v, 1, byId)!.legacy,
          recordedParent(v, 2, byId)!.legacy,
        ] as const;
        const plan = planInheritance(ctx, v.outfitId, legs, v.scenarioId);
        const raw = simulate(pc, plan, 2000, `${seed}:${id}`, []);
        for (const k of STAT_KEYS) {
          const sorted = Float64Array.from(raw.stats[k]).sort();
          const y = v.stats[k];
          if (y >= quantileSorted(sorted, 0.1) && y <= quantileSorted(sorted, 0.9)) hit++;
          cells++;
        }
      }
      results.push(hit / cells);
    }
    console.info(
      `[T06] stored split MC p10–p90 coverage: ${results.map((x) => x.toFixed(4)).join(', ')}`,
    );
    for (const c of results) {
      expect(c).toBeGreaterThanOrEqual(0.72);
      expect(c).toBeLessThanOrEqual(0.88);
    }
  });
});

describe('scoreTarget (50 §6)', () => {
  /** Hand-built samples: spd passes in samples 0,1 only, sta in 2,3 only (anti-correlated). */
  function fake(): ChildPrediction {
    const n = 4;
    const stats = Object.fromEntries(
      STAT_KEYS.map((k) => [k, new Float64Array(n).fill(500)]),
    ) as PredictionSamples['stats'];
    stats.spd = Float64Array.from([1200, 1150, 900, 1000]);
    stats.sta = Float64Array.from([700, 600, 900, 850]);
    const aptitudes = Object.fromEntries(
      APT_KEYS.map((k) => [k, new Uint8Array(n).fill(6)]),
    ) as PredictionSamples['aptitudes'];
    aptitudes.turf = Uint8Array.from([6, 6, 6, 4]);
    const raw: PredictionSamples = {
      n,
      stats,
      training: stats,
      inheritance: stats,
      aptitudes,
      skills: {
        'skill:a': Uint8Array.from([1, 1, 1, 1]),
        'skill:o': Uint8Array.from([1, 0, 0, 0]),
      },
      skillUniforms: {},
    };
    return { rawSamples: raw, targetScores: {} } as unknown as ChildPrediction;
  }
  const t: CmTarget = {
    ...target,
    minStats: { spd: 1100, sta: 800 },
    minAptitudes: { turf: 'A' },
    requiredSkills: ['skill:a'],
    optionalSkills: [{ skillId: 'skill:o', weight: 10 }],
    statWeights: { spd: 2 },
  };

  it('pMeet is the JOINT share, not the product of marginals', () => {
    const s = scoreTarget(fake(), t);
    const product = s.requirements.reduce((p, r) => p * r.passRate, 1);
    expect(s.pMeet).toBe(0);
    expect(product).toBeCloseTo(0.5 * 0.5 * 0.75, 15);
    expect(s.method).toBe('monte-carlo');
  });

  it('bottleneck = lowest marginal pass rate (first on ties); surplus = Σ w E[(x − m)+] + Σ w P(acq)', () => {
    const s = scoreTarget(fake(), t);
    expect(s.bottleneck).toMatchObject({ kind: 'stat', key: 'spd', passRate: 0.5 });
    const spdEx = (100 + 50 + 0 + 0) / 4;
    const staEx = (0 + 0 + 100 + 50) / 4;
    expect(s.surplus).toBeCloseTo(2 * spdEx + 1 * staEx + 10 * 0.25, 12);
    const onlyApt = scoreTarget(fake(), { ...t, minStats: {}, requiredSkills: [] });
    expect(onlyApt.bottleneck).toMatchObject({ kind: 'aptitude', key: 'turf', passRate: 0.75 });
    expect(onlyApt.pMeet).toBe(0.75);
  });

  it('a target with no requirements has pMeet 1 and no bottleneck', () => {
    const s = scoreTarget(fake(), {
      ...t,
      minStats: {},
      minAptitudes: {},
      requiredSkills: [],
      optionalSkills: [],
    });
    expect(s.pMeet).toBe(1);
    expect(s.bottleneck).toBeNull();
    expect(s.surplus).toBe(0);
  });

  it('retained and non-retained paths give the same JOINT score; neither falls back to marginals', () => {
    const kept = predictChild(ctx, snapshot, planInput, best, {
      seed: 'sc',
      samples: 2000,
      keepSamples: true,
      target,
    });
    const dropped = predictChild(ctx, snapshot, planInput, best, {
      seed: 'sc',
      samples: 2000,
      target,
    });
    expect(dropped.rawSamples).toBeUndefined();
    expect(scoreTarget(dropped, target)).toEqual(scoreTarget(kept, target));
    const product = scoreTarget(kept, target).requirements.reduce((p, r) => p * r.passRate, 1);
    expect(scoreTarget(kept, target).pMeet).not.toBe(product);
    // No samples and no recorded target: a typed error, never a product of marginals.
    const bare = predictChild(ctx, snapshot, planInput, best, { seed: 'sc', samples: 50 });
    expect(() => scoreTarget(bare, target)).toThrow(ScoreRequiresSamplesError);
    expect(() => scoreTarget(dropped, { ...target, minStats: { spd: 1 } })).toThrow(
      ScoreRequiresSamplesError,
    );
  });

  it('a required skill that was not simulated is an error, not a silent pass', () => {
    const kept = predictChild(ctx, snapshot, planInput, best, {
      seed: 'sc',
      samples: 10,
      keepSamples: true,
      skills: [],
    });
    expect(() => scoreTarget(kept, target)).toThrow(ScoreRequiresSamplesError);
  });
});
