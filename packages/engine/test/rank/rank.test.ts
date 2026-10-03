/**
 * 50 §7 and 70 F11: legal pairs, guests never candidates, trainee-character exclusion, lock
 * handling, deterministic pair-derived seeds and ties, progress, top-K precise MC and top-N
 * results; the golden best pair ranks #1 and the trap stays out of the top 10.
 */
import { describe, expect, it } from 'vitest';
import type { CmTarget, RosterVeteran } from '@uma/schema';
import {
  ModelInputError,
  predictChild,
  rankPairs,
  rankPairsDetailed,
  scoreTarget,
} from '../../src/index.ts';
import type { RankProgress } from '../../src/index.ts';
import { byId, ctx, goldenFit, planInput, roster, target, truth } from '../model/golden-fit.ts';

const { snapshot } = goldenFit();
const traineeChar = ctx.outfits.get(planInput.traineeOutfitId)!.characterId;
const samePair = (p: readonly string[], q: readonly string[]) =>
  p.length === 2 && p.includes(q[0]!) && p.includes(q[1]!);

/** Brute-force count of legal pairs (independent of the implementation). */
function legalPairs(vs: readonly RosterVeteran[], lock?: string): number {
  let n = 0;
  for (const a of vs)
    for (const b of vs) {
      if (a.id >= b.id && !lock) continue;
      if (lock && a.id !== lock) continue;
      if (a.id === b.id || a.characterId === b.characterId) continue;
      if (a.characterId === traineeChar || b.characterId === traineeChar) continue;
      n++;
    }
  return n;
}

describe('golden ranking (full pipeline, 260 veterans)', () => {
  const progress: RankProgress[] = [];
  const res = rankPairsDetailed(ctx, snapshot, planInput, roster, target, {}, (p) =>
    progress.push(p),
  );

  it('evaluates every legal roster pair and reports progress every 1000 pairs', () => {
    expect(res.evaluatedPairs).toBe(legalPairs(roster));
    console.info(`[T06] golden legal pairs evaluated: ${res.evaluatedPairs}`);
    const fast = progress.filter((p) => p.phase === 'fast');
    expect(fast.map((p) => p.done)).toEqual([
      ...Array.from({ length: Math.floor(res.evaluatedPairs / 1000) }, (_, i) => (i + 1) * 1000),
      ...(res.evaluatedPairs % 1000 ? [res.evaluatedPairs] : []),
    ]);
    expect(fast.every((p) => p.total === res.evaluatedPairs)).toBe(true);
    expect(progress.filter((p) => p.phase === 'precise')).toHaveLength(100);
    expect(res.excludedVeterans.every((e) => byId.get(e.id)!.characterId === traineeChar)).toBe(
      true,
    );
  });

  it('full MC for the top 100 (2000 draws each), top 50 returned', () => {
    expect(res.preciseEvaluated).toBe(100);
    expect(res.results).toHaveLength(50);
    for (const r of res.results) {
      expect(r.prediction.samples).toBe(2000);
      expect(r.score.method).toBe('monte-carlo');
      expect(r.prediction.rawSamples).toBeUndefined();
      expect(r.fast.rank).toBeLessThanOrEqual(100);
    }
    expect(res.results.map((r) => r.rank)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('results are sorted by pMeet desc, surplus desc, then pair key', () => {
    for (let i = 1; i < res.results.length; i++) {
      const a = res.results[i - 1]!;
      const b = res.results[i]!;
      const ok =
        a.pMeet > b.pMeet ||
        (a.pMeet === b.pMeet &&
          (a.surplus > b.surplus ||
            (a.surplus === b.surplus && a.parents.join('|') < b.parents.join('|'))));
      expect(ok).toBe(true);
    }
  });

  it('the planted best pair ranks #1 and the trap pair is not in the top 10', () => {
    const top = res.results[0]!;
    expect(samePair(top.parents, truth.golden.bestPair.parents)).toBe(true);
    const trapRank = res.results.findIndex((r) =>
      samePair(r.parents, truth.golden.trapPair.parents),
    );
    expect(trapRank === -1 || trapRank >= 10).toBe(true);
    console.info(
      `[T06] golden #1 ${top.parents.join('|')} pMeet MC ${top.pMeet} (fast ${top.fast.pMeet.toFixed(4)}), #2 MC ${res.results[1]!.pMeet}; trap in top 50: ${trapRank === -1 ? 'no' : trapRank + 1}; bottleneck ${JSON.stringify(top.bottleneck)}`,
    );
    expect(top.bottleneck?.kind).toBe('skill');
    expect(top.affinity.total).toBeGreaterThan(0);
    expect(top.contributions.length).toBeGreaterThan(0);
  });

  it('the result equals a direct predictChild with the pair-derived seed (joint MC score)', () => {
    const top = res.results[0]!;
    const ids = [...top.parents].sort();
    const p = predictChild(
      ctx,
      snapshot,
      planInput,
      [byId.get(top.parents[0])!, byId.get(top.parents[1])!],
      {
        seed: `rank:${ids[0]}|${ids[1]}`,
        samples: 2000,
        target,
      },
    );
    expect(scoreTarget(p, target)).toEqual(top.score);
  });
});

describe('legality, locks and empty cases', () => {
  const small = roster.slice(0, 30);
  const opts = { topK: 20, topN: 10, samples: 200 };

  it('guests are never candidates: only roster ids appear; illegal pairs never scored', () => {
    const ids = new Set(small.map((v) => v.id));
    const res = rankPairsDetailed(ctx, snapshot, planInput, small, target, opts);
    expect(res.evaluatedPairs).toBe(legalPairs(small));
    for (const r of res.results) {
      expect(ids.has(r.parents[0]) && ids.has(r.parents[1])).toBe(true);
      const [a, b] = r.parents.map((id) => byId.get(id)!);
      expect(a!.characterId).not.toBe(b!.characterId);
      expect(a!.characterId).not.toBe(traineeChar);
      expect(b!.characterId).not.toBe(traineeChar);
    }
  });

  it('trainee-character veterans are excluded and reported', () => {
    const t = roster.find((v) => v.characterId === traineeChar)!;
    const res = rankPairsDetailed(ctx, snapshot, planInput, [...small, t], target, opts);
    expect(res.excludedVeterans).toEqual([{ id: t.id, reason: 'trainee-character' }]);
    expect(res.results.every((r) => !r.parents.includes(t.id))).toBe(true);
  });

  it('lockParent1 fixes parent 1 and pairs it with every legal partner', () => {
    const lock = small[3]!.id;
    const res = rankPairsDetailed(
      ctx,
      snapshot,
      { ...planInput, lockParent1: lock },
      small,
      target,
      opts,
    );
    expect(res.locked).toBe(lock);
    expect(res.evaluatedPairs).toBe(legalPairs(small, lock));
    expect(res.results.every((r) => r.parents[0] === lock)).toBe(true);
    const golden = rankPairs(
      ctx,
      snapshot,
      { ...planInput, lockParent1: truth.golden.bestPair.parents[1] },
      roster,
      target,
      { topK: 10, topN: 5, samples: 500 },
    );
    expect(samePair(golden[0]!.parents, truth.golden.bestPair.parents)).toBe(true);
    expect(golden[0]!.parents[0]).toBe(truth.golden.bestPair.parents[1]);
  });

  it('locking an unknown veteran is a typed error; locking a trainee-character veteran gives no pairs', () => {
    expect(() =>
      rankPairs(
        ctx,
        snapshot,
        { ...planInput, lockParent1: '01KGQZ0000G01DENCM0000NONE' },
        small,
        target,
        opts,
      ),
    ).toThrow(ModelInputError);
    const t = roster.find((v) => v.characterId === traineeChar)!;
    const res = rankPairsDetailed(
      ctx,
      snapshot,
      { ...planInput, lockParent1: t.id },
      [...small, t],
      target,
      opts,
    );
    expect(res.evaluatedPairs).toBe(0);
    expect(res.results).toEqual([]);
  });

  it('empty and one-veteran rosters give no results; same-character pairs are skipped', () => {
    expect(rankPairs(ctx, snapshot, planInput, [], target, opts)).toEqual([]);
    expect(rankPairs(ctx, snapshot, planInput, [small[0]!], target, opts)).toEqual([]);
    const a = small.find((v) => v.characterId !== traineeChar)!;
    const twin = { ...a, id: '01KGQZ0000G01DENCM0000TWIN' };
    expect(
      rankPairsDetailed(ctx, snapshot, planInput, [a, twin], target, opts).evaluatedPairs,
    ).toBe(0);
    expect(() => rankPairs(ctx, snapshot, planInput, [a, a], target, opts)).toThrow(
      expect.objectContaining({ code: 'duplicate-id' }),
    );
  });

  it('is deterministic and independent of roster order; ties break by pair key', () => {
    const a = rankPairs(ctx, snapshot, planInput, small, target, opts);
    const b = rankPairs(ctx, snapshot, planInput, [...small].reverse(), target, opts);
    expect(b).toEqual(a);
    // An unreachable target: every pMeet and surplus is 0, so order = pair key ascending.
    const impossible: CmTarget = {
      ...target,
      minStats: { spd: 2000 },
      minAptitudes: {},
      requiredSkills: [],
      optionalSkills: [],
    };
    const tied = rankPairs(ctx, snapshot, planInput, small, impossible, opts);
    const keys = tied.map((r) => r.parents.join('|'));
    expect(keys).toEqual([...keys].sort());
    expect(tied.every((r) => r.pMeet === 0)).toBe(true);
  });

  it('validates options with typed errors', () => {
    expect(() => rankPairs(ctx, snapshot, planInput, small, target, { topK: 0 })).toThrow(
      ModelInputError,
    );
    expect(() => rankPairs(ctx, snapshot, planInput, small, target, { samples: 1.5 })).toThrow(
      ModelInputError,
    );
    expect(() =>
      rankPairs(ctx, snapshot, planInput, small, { ...target, minStats: { spd: NaN } }, opts),
    ).toThrow(ModelInputError);
  });
});
