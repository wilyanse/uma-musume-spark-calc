/**
 * 50 §7 `rankPairs`: every legal roster pair, a closed-form Gaussian fast pass, the full seeded
 * Monte Carlo for the top K = 100 and the top N = 50 results.
 *
 * - Candidates are roster veterans only (guests are never roster veterans and never candidates).
 *   A pair is legal when the two veterans differ, have different characters and neither has the
 *   trainee's character (50 §3). `lockParent1` fixes parent 1 to that roster veteran.
 * - Pair order: parent 1 is the locked veteran, otherwise the smaller veteran id. The MC seed is
 *   derived only from `RankOptions.seed` and the two ids, so it does not depend on roster order.
 * - Sort keys: pMeet desc, surplus desc, then the pair key (`id1|id2`) ascending, so ties are
 *   deterministic. The fast pass orders the precise candidates; the MC result re-sorts them.
 */
import type { CmTarget } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import {
  expectationFromPlan,
  legacyFromVeteran,
  planInheritance,
} from '../inheritance/inheritance.ts';
import type { Contribution, InheritanceResult } from '../inheritance/inheritance.ts';
import type { AffinityResult } from '../inheritance/affinity.ts';
import type { Legacy, PlanInput, Veteran } from '../types.ts';
import { ModelInputError } from '../model/errors.ts';
import { prepareModel } from '../model/prepared.ts';
import {
  DEFAULT_SAMPLES,
  gaussianScore,
  normalizeTarget,
  predictPlanned,
  preparePlan,
  targetKey,
} from '../predict/index.ts';
import type { ChildPrediction, Requirement, TargetScore } from '../predict/index.ts';

export const DEFAULT_TOP_K = 100;
export const DEFAULT_TOP_N = 50;
export const PROGRESS_EVERY = 1000;
export const DEFAULT_RANK_SEED = 'rank';

export interface RankOptions {
  /** Pairs re-scored by the full Monte Carlo (default 100). */
  topK?: number;
  /** Results returned (default 50, at most topK). */
  topN?: number;
  /** MC samples per precise pair (default 2000). */
  samples?: number;
  /** Base of the pair-derived MC seeds `${seed}:${id1}|${id2}` (default 'rank'). */
  seed?: string | number;
}

export interface RankProgress {
  phase: 'fast' | 'precise';
  done: number;
  total: number;
}

export interface RankedPair {
  /** [parent 1, parent 2] roster veteran ids. */
  parents: [string, string];
  pMeet: number;
  surplus: number;
  bottleneck: Requirement | null;
  affinity: AffinityResult;
  contributions: Contribution[];
  /** The Monte Carlo prediction (no raw samples), with its joint target score recorded. */
  prediction: ChildPrediction;
  /** The precise (MC) score. */
  score: TargetScore;
  /** The Gaussian fast-pass score that selected the pair. */
  fast: { pMeet: number; surplus: number; rank: number };
  /** 1-based final rank. */
  rank: number;
}

export interface RankResult {
  results: RankedPair[];
  /** Legal pairs evaluated by the fast pass. */
  evaluatedPairs: number;
  /** Veterans considered after the trainee-character exclusion. */
  candidates: number;
  excludedVeterans: { id: string; reason: 'trainee-character' }[];
  preciseEvaluated: number;
  locked: string | null;
}

interface FastEntry {
  i: number;
  j: number;
  key: string;
  pMeet: number;
  surplus: number;
}

const cmp = (a: { pMeet: number; surplus: number; key: string }, b: typeof a) =>
  b.pMeet - a.pMeet || b.surplus - a.surplus || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function positiveInt(name: string, v: number | undefined, dflt: number): number {
  const x = v ?? dflt;
  if (!Number.isInteger(x) || x < 1) {
    throw new ModelInputError('rank-options', `${name} must be a positive integer, got ${x}`);
  }
  return x;
}

/** 50 §7 with diagnostics (evaluated pair count, exclusions). */
export function rankPairsDetailed(
  ctx: EngineContext,
  model: unknown,
  input: PlanInput,
  roster: readonly Veteran[],
  target: CmTarget,
  opts: RankOptions = {},
  onProgress?: (p: RankProgress) => void,
): RankResult {
  const prepared = prepareModel(ctx, model); // RefitRequiredError for training-v1
  const pc = preparePlan(ctx, prepared, input);
  const nt = normalizeTarget(target);
  const topK = positiveInt('topK', opts.topK, DEFAULT_TOP_K);
  const topN = Math.min(topK, positiveInt('topN', opts.topN, DEFAULT_TOP_N));
  const samples = positiveInt('samples', opts.samples, DEFAULT_SAMPLES);
  const seedBase = String(opts.seed ?? DEFAULT_RANK_SEED);

  const ids = new Set<string>();
  for (const v of roster) {
    if (ids.has(v.id)) throw new ModelInputError('duplicate-id', v.id);
    ids.add(v.id);
  }
  const lockId = input.lockParent1 ?? null;
  if (lockId !== null && !ids.has(lockId)) {
    throw new ModelInputError('locked-parent', `lockParent1 ${lockId} is not a roster veteran`);
  }
  const sorted = [...roster].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const excludedVeterans: RankResult['excludedVeterans'] = [];
  const cand: Veteran[] = [];
  for (const v of sorted) {
    if (v.characterId === pc.traineeCharacterId) {
      excludedVeterans.push({ id: v.id, reason: 'trainee-character' });
    } else cand.push(v);
  }
  const legacies: Legacy[] = cand.map(legacyFromVeteran);
  const lockIdx = lockId === null ? -1 : cand.findIndex((v) => v.id === lockId);

  // Enumerate legal pairs (indices into `cand`, i = parent 1).
  const pairs: [number, number][] = [];
  if (lockId === null) {
    for (let i = 0; i < cand.length; i++)
      for (let j = i + 1; j < cand.length; j++)
        if (cand[i]!.characterId !== cand[j]!.characterId) pairs.push([i, j]);
  } else if (lockIdx >= 0) {
    for (let j = 0; j < cand.length; j++)
      if (j !== lockIdx && cand[j]!.characterId !== cand[lockIdx]!.characterId)
        pairs.push([lockIdx, j]);
  } // a locked veteran with the trainee's character has no legal pair

  // Fast pass.
  const fast: FastEntry[] = new Array(pairs.length);
  const total = pairs.length;
  for (let n = 0; n < total; n++) {
    const [i, j] = pairs[n]!;
    const plan = planInheritance(
      ctx,
      input.traineeOutfitId,
      [legacies[i]!, legacies[j]!],
      input.scenarioId,
    );
    const exp = expectationFromPlan(plan);
    const s = gaussianScore(pc, exp, nt);
    fast[n] = { i, j, key: `${cand[i]!.id}|${cand[j]!.id}`, pMeet: s.pMeet, surplus: s.surplus };
    if (onProgress && ((n + 1) % PROGRESS_EVERY === 0 || n + 1 === total)) {
      onProgress({ phase: 'fast', done: n + 1, total });
    }
  }
  fast.sort(cmp);

  // Precise pass: full MC for the top K.
  const k = Math.min(topK, fast.length);
  const precise: {
    entry: FastEntry;
    fastRank: number;
    pred: ChildPrediction;
    exp: InheritanceResult;
    score: TargetScore;
    key: string;
    pMeet: number;
    surplus: number;
  }[] = [];
  const tk = targetKey(target);
  for (let r = 0; r < k; r++) {
    const e = fast[r]!;
    const plan = planInheritance(
      ctx,
      input.traineeOutfitId,
      [legacies[e.i]!, legacies[e.j]!],
      input.scenarioId,
    );
    const exp = expectationFromPlan(plan);
    const pairIds = [cand[e.i]!.id, cand[e.j]!.id].sort();
    const pred = predictPlanned(pc, plan, exp, {
      samples,
      seed: `${seedBase}:${pairIds[0]}|${pairIds[1]}`,
      target,
    });
    const score = pred.targetScores[tk]!;
    precise.push({
      entry: e,
      fastRank: r + 1,
      pred,
      exp,
      score,
      key: e.key,
      pMeet: score.pMeet,
      surplus: score.surplus,
    });
    onProgress?.({ phase: 'precise', done: r + 1, total: k });
  }
  precise.sort(cmp);
  const results: RankedPair[] = precise.slice(0, topN).map((p, idx) => ({
    parents: [cand[p.entry.i]!.id, cand[p.entry.j]!.id],
    pMeet: p.score.pMeet,
    surplus: p.score.surplus,
    bottleneck: p.score.bottleneck,
    affinity: p.exp.affinity,
    contributions: p.exp.contributions,
    prediction: p.pred,
    score: p.score,
    fast: { pMeet: p.entry.pMeet, surplus: p.entry.surplus, rank: p.fastRank },
    rank: idx + 1,
  }));
  return {
    results,
    evaluatedPairs: total,
    candidates: cand.length,
    excludedVeterans,
    preciseEvaluated: k,
    locked: lockId,
  };
}

/** 50 §1 `rankPairs(ctx, model, input, roster, target, opts, onProgress?)`: the top N pairs. */
export function rankPairs(
  ctx: EngineContext,
  model: unknown,
  input: PlanInput,
  roster: readonly Veteran[],
  target: CmTarget,
  opts: RankOptions = {},
  onProgress?: (p: RankProgress) => void,
): RankedPair[] {
  return rankPairsDetailed(ctx, model, input, roster, target, opts, onProgress).results;
}
