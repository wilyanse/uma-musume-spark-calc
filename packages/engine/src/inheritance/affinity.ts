import type { EngineContext } from '../context.ts';
import { pairKey } from '../context.ts';
import type { Legacy, SparkSource } from '../types.ts';

/**
 * Affinity (compatibility) between the trainee, the parents and the grandparents.
 *
 * Interpretation (Q-81, `verified:false`): the smallest reading of the data T03 publishes and of
 * the GameTora calculator it cites (rules.json `affinityMultiplier.source`):
 * - `affinity(a, b)` = Σ points of the `affinity.json` groups that contain both a and b,
 *   plus any `pairs` entry for {a, b};
 * - `affinity(a, b, c)` = Σ points of the groups that contain all three (the pairwise table can't
 *   express triples, so it doesn't contribute);
 * - relationships: T–P1, T–P2, P1–P2, and T–Px–GPxy for each of the four grandparents;
 * - each legacy has its own affinity, used for its sparks' activation multiplier:
 *   Px = aff(T,Px) + aff(P1,P2) + Σ_y aff(T,Px,GPxy); GPxy = aff(T,Px,GPxy).
 * The calculator also adds bonuses for G1 races both legacies won and for shared epithets. The
 * roster doesn't record won races or legacy epithets per legacy, so those terms are 0 and listed
 * in `unsupportedTerms`.
 */
export interface AffinityRelation {
  /** e.g. `T-P1`, `P1-P2`, `T-P1-GP1a`. */
  label: string;
  members: string[];
  points: number;
}

export interface AffinityResult {
  total: number;
  /** One entry per relationship considered, in a fixed order (zeros included). */
  breakdown: AffinityRelation[];
  /** The affinity each source's sparks roll with. */
  perSource: Record<SparkSource, number>;
  /** Terms the cited source has but the engine can't compute from roster data. */
  unsupportedTerms: string[];
}

export function affinity2(ctx: EngineContext, a: string, b: string): number {
  if (a === b) return 0;
  const ga = ctx.affinityGroupsOf.get(a);
  const gb = ctx.affinityGroupsOf.get(b);
  let sum = ctx.affinityPairs.get(pairKey(a, b)) ?? 0;
  if (ga && gb) {
    const [small, big] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
    for (const [g, pts] of small) if (big.has(g)) sum += pts;
  }
  return sum;
}

export function affinity3(ctx: EngineContext, a: string, b: string, c: string): number {
  if (a === b || a === c || b === c) return 0;
  const ga = ctx.affinityGroupsOf.get(a);
  const gb = ctx.affinityGroupsOf.get(b);
  const gc = ctx.affinityGroupsOf.get(c);
  if (!ga || !gb || !gc) return 0;
  let sum = 0;
  for (const [g, pts] of ga) if (gb.has(g) && gc.has(g)) sum += pts;
  return sum;
}

export function computeAffinity(
  ctx: EngineContext,
  traineeCharacterId: string,
  parents: readonly [Legacy, Legacy],
): AffinityResult {
  const T = traineeCharacterId;
  const [p1, p2] = parents;
  const breakdown: AffinityRelation[] = [];
  const add = (label: string, members: string[], points: number): number => {
    breakdown.push({ label, members, points });
    return points;
  };
  const tp1 = add('T-P1', [T, p1.characterId], affinity2(ctx, T, p1.characterId));
  const tp2 = add('T-P2', [T, p2.characterId], affinity2(ctx, T, p2.characterId));
  const pp = add(
    'P1-P2',
    [p1.characterId, p2.characterId],
    affinity2(ctx, p1.characterId, p2.characterId),
  );
  const gpAff = (p: Legacy, idx: 0 | 1, label: string): number => {
    const gp = p.grandparents[idx];
    const id = gp?.characterId ?? null;
    return add(
      `T-${label}`,
      id ? [T, p.characterId, id] : [T, p.characterId],
      id ? affinity3(ctx, T, p.characterId, id) : 0,
    );
  };
  const g1a = gpAff(p1, 0, 'P1-GP1a');
  const g1b = gpAff(p1, 1, 'P1-GP1b');
  const g2a = gpAff(p2, 0, 'P2-GP2a');
  const g2b = gpAff(p2, 1, 'P2-GP2b');
  return {
    total: tp1 + tp2 + pp + g1a + g1b + g2a + g2b,
    breakdown,
    perSource: {
      P1: tp1 + pp + g1a + g1b,
      P2: tp2 + pp + g2a + g2b,
      GP1a: g1a,
      GP1b: g1b,
      GP2a: g2a,
      GP2b: g2b,
    },
    unsupportedTerms: ['race-win bonus (shared G1 wins between legacies)', 'epithet bonus'],
  };
}
