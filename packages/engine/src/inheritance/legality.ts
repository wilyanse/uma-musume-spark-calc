import type { EngineContext } from '../context.ts';

/** Why a pair can't be used (50 §3 Legality). */
export type IllegalReason =
  | 'same-parent-character'
  | 'parent1-is-trainee-character'
  | 'parent2-is-trainee-character'
  | 'same-veteran';

export interface Legality {
  legal: boolean;
  reasons: IllegalReason[];
}

/** Thrown by `inheritanceExpectation` / `planInheritance` for an illegal pair. */
export class IllegalPairError extends Error {
  override name = 'IllegalPairError';
  readonly reasons: IllegalReason[];
  constructor(reasons: IllegalReason[]) {
    super(`illegal parent pair: ${reasons.join(', ')}`);
    this.reasons = reasons;
  }
}

/** Thrown when an input id (trainee outfit, scenario) isn't in the loaded master data. */
export class UnknownIdError extends Error {
  override name = 'UnknownIdError';
}

/**
 * 50 §3: `P1.characterId != P2.characterId`, and neither equals the trainee's character.
 * The same roster veteran can't be both parents either (implied: it has one character).
 * Pure and cheap, so T06 can filter all pairs before scoring.
 */
export function checkLegality(
  traineeCharacterId: string,
  p1: { characterId: string; veteranId?: string | null },
  p2: { characterId: string; veteranId?: string | null },
): Legality {
  const reasons: IllegalReason[] = [];
  if (p1.veteranId && p1.veteranId === p2.veteranId) reasons.push('same-veteran');
  if (p1.characterId === p2.characterId) reasons.push('same-parent-character');
  if (p1.characterId === traineeCharacterId) reasons.push('parent1-is-trainee-character');
  if (p2.characterId === traineeCharacterId) reasons.push('parent2-is-trainee-character');
  return { legal: reasons.length === 0, reasons };
}

/** The trainee outfit's character, or `UnknownIdError`. */
export function traineeCharacter(ctx: EngineContext, traineeOutfitId: string): string {
  const outfit = ctx.outfits.get(traineeOutfitId);
  if (!outfit) throw new UnknownIdError(`unknown trainee outfit ${traineeOutfitId}`);
  return outfit.characterId;
}
