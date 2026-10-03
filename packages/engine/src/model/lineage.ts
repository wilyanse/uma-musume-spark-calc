/**
 * The lineage RECORDED on a roster veteran (50 §4 "its real parents, grandparents"), as the
 * training model sees it. Roster matching and guest rules:
 *
 * - matched parent (`matchedVeteranId` present in the supplied roster): the matched roster record
 *   (`legacyFromVeteran`), so its own parents become the child's grandparents;
 * - guest parent (`isGuest`): the parent's character and the sparks recorded on the child under
 *   that owner; a guest's own parents are never visible, so no grandparents;
 * - unmatched non-guest parent, or a `matchedVeteranId` that is not in the supplied roster: the
 *   same as a guest (recorded sparks, no grandparents). The missing grandparents' variance is
 *   absorbed by Σ_N (ADR-0002 §2 limitations).
 */
import type { Legacy, Veteran } from '../types.ts';
import { legacyFromVeteran } from '../inheritance/inheritance.ts';

export type ParentKind = 'matched' | 'guest' | 'unmatched' | 'matched-missing';

export interface RecordedParent {
  legacy: Legacy;
  kind: ParentKind;
  /** Sparks recorded on the child under this parent's owner. */
  recordedSparks: number;
}

export function recordedParent(
  v: Veteran,
  slot: 1 | 2,
  byId: ReadonlyMap<string, Veteran>,
): RecordedParent | null {
  const p = v.parents.find((x) => x.slot === slot);
  if (!p) return null;
  const owner = slot === 1 ? 'parent1' : 'parent2';
  const sparks = v.sparks
    .filter((s) => s.owner === owner)
    .map((s) => ({ sparkId: s.sparkId, type: s.type, stars: s.stars }));
  const matched = p.matchedVeteranId ? byId.get(p.matchedVeteranId) : undefined;
  if (matched) {
    return { legacy: legacyFromVeteran(matched), kind: 'matched', recordedSparks: sparks.length };
  }
  return {
    legacy: { veteranId: null, characterId: p.characterId, sparks, grandparents: [null, null] },
    kind: p.isGuest ? 'guest' : p.matchedVeteranId ? 'matched-missing' : 'unmatched',
    recordedSparks: sparks.length,
  };
}
