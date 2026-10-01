/**
 * S2: seeded Monte Carlo vs the closed form over 50,000 draws, on a varied multi-spark lineage
 * (all five stats, two aptitudes with the S cap, three hinted skills, grandparent blue/pink/race/
 * scenario sparks, a duplicate-hint race row) and on the 9-spark lineage.
 *
 * Tolerances (N = 50,000 independent draws, fixed seeds, so the run is deterministic):
 * - Event-driven stat mean (statGain − initial bonus, so the constant bonus can't hide errors):
 *   |MC − exact| ≤ 5·σ/√N, with σ² from the exact `statGainCov` diagonal, AND ≤ 1% of the exact
 *   mean (50 §9). 5σ puts the chance of a false failure per check below 1e-6.
 * - Covariance diagonal: relative error ≤ 5% (the sample variance's relative SE here is < 1%).
 * - Probabilities (aptitude grades, hints): |MC − p| ≤ 5·√(p(1−p)/N) + 1e-9.
 * - Exact zeros (a stat nothing moves, a grade that can't be reached): MC must be exactly 0.
 */
import { describe, expect, it } from 'vitest';
import { GRADES, STAT_KEYS } from '@uma/schema';
import type { AptKey } from '@uma/schema';
import {
  expectationFromPlan,
  loadContext,
  mulberry32,
  planInheritance,
  sampleInheritance,
} from '../../src/index.ts';
import type { InheritancePlan, Legacy } from '../../src/index.ts';
import {
  lineage9,
  richLineage,
  SCENARIO,
  skill,
  toyMaster,
  toyRules,
  TRAINEE,
  TRAINEE_A,
} from './fixtures.ts';

const N = 50_000;
const Z = 5;

function compare(plan: InheritancePlan, seed: number, apts: AptKey[]) {
  const exact = expectationFromPlan(plan);
  const rng = mulberry32(seed);
  const sum = [0, 0, 0, 0, 0];
  const sumSq = [0, 0, 0, 0, 0];
  const gradeCounts = new Map<string, number>();
  const hintCounts = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const s = sampleInheritance(plan, rng);
    for (let k = 0; k < 5; k++) {
      const x = (s.statGain[k] as number) - (plan.initialStatBonus[k] as number);
      sum[k] = (sum[k] as number) + x;
      sumSq[k] = (sumSq[k] as number) + x * x;
    }
    for (const apt of apts)
      gradeCounts.set(
        `${apt}:${s.aptitudes[apt]}`,
        (gradeCounts.get(`${apt}:${s.aptitudes[apt]}`) ?? 0) + 1,
      );
    for (const id of Object.keys(s.hints)) hintCounts.set(id, (hintCounts.get(id) ?? 0) + 1);
  }

  let checkedStats = 0;
  STAT_KEYS.forEach((key, k) => {
    const exactMean = (exact.expectedStatGain[k] as number) - (exact.initialStatBonus[k] as number);
    const variance = exact.statGainCov[k]?.[k] as number;
    const mean = (sum[k] as number) / N;
    const sampleVar = (sumSq[k] as number) / N - mean * mean;
    if (exactMean === 0) {
      expect(variance, key).toBe(0);
      expect(mean, key).toBe(0);
      return;
    }
    checkedStats++;
    const tol = Math.min(Z * Math.sqrt(variance / N), 0.01 * Math.abs(exactMean));
    expect(
      Math.abs(mean - exactMean),
      `${key} mean ${mean} vs ${exactMean} (tol ${tol})`,
    ).toBeLessThanOrEqual(tol);
    expect(
      Math.abs(sampleVar / variance - 1),
      `${key} variance ${sampleVar} vs ${variance}`,
    ).toBeLessThanOrEqual(0.05);
  });

  for (const apt of apts) {
    const dist = exact.aptitudeDist[apt];
    for (const g of GRADES) {
      const p = dist[g];
      const f = (gradeCounts.get(`${apt}:${g}`) ?? 0) / N;
      if (p === 0) expect(f, `${apt} ${g}`).toBe(0);
      else
        expect(Math.abs(f - p), `${apt} ${g}: ${f} vs ${p}`).toBeLessThanOrEqual(
          Z * Math.sqrt((p * (1 - p)) / N) + 1e-9,
        );
    }
  }
  for (const [id, p] of Object.entries(exact.skillHintProb)) {
    const f = (hintCounts.get(id) ?? 0) / N;
    expect(Math.abs(f - p), `hint ${id}: ${f} vs ${p}`).toBeLessThanOrEqual(
      Z * Math.sqrt((p * (1 - p)) / N) + 1e-9,
    );
  }
  expect([...hintCounts.keys()].every((id) => id in exact.skillHintProb)).toBe(true);
  return { exact, checkedStats };
}

describe('Monte Carlo vs closed form, 50k seeded draws (S2)', () => {
  const ctx = loadContext(toyMaster(), toyRules());

  it('rich lineage: all five stats, turf/dirt with the S cap, three hints, GP/race/scenario effects', () => {
    const plan = planInheritance(ctx, TRAINEE_A, richLineage(), SCENARIO);
    // The lineage really exercises what it claims to.
    expect(new Set(plan.activations.map((a) => a.from))).toEqual(
      new Set(['P1', 'P2', 'GP1a', 'GP1b', 'GP2a', 'GP2b']),
    );
    expect(new Set(plan.activations.map((a) => a.kind))).toEqual(
      new Set(['blue', 'pink', 'green', 'white-skill', 'white-race', 'white-scenario']),
    );
    const { exact, checkedStats } = compare(plan, 0x5eed_0001, ['turf', 'dirt', 'mile']);
    expect(checkedStats).toBe(5);
    expect(Object.keys(exact.skillHintProb).sort()).toEqual([
      skill('race'),
      skill('x'),
      skill('y'),
    ]);
    expect(exact.aptitudeDist.turf.S).toBeGreaterThan(0.3); // turf A + up to 2×(1..2) steps, capped
    expect(exact.aptitudeDist.mile).toMatchObject({ C: 1, S: 0 }); // untouched aptitude
  });

  it('9-spark lineage from the hand-computed test', () => {
    const plan = planInheritance(ctx, TRAINEE, lineage9(), SCENARIO);
    const { checkedStats } = compare(plan, 0x5eed_0002, ['turf']);
    expect(checkedStats).toBe(3); // spd, pow, gut move; sta and wit stay exactly 0
  });

  it('3 events with an unknown grandparent character', () => {
    const three = loadContext(toyMaster(toyRules(), [1, 2, 3]), toyRules());
    const pair: [Legacy, Legacy] = richLineage();
    compare(planInheritance(three, TRAINEE, pair, SCENARIO), 0x5eed_0003, ['turf', 'dirt']);
  });
});
