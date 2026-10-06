/**
 * Human labels for `CaptureField.path` JSON pointers (S03 list, S02 low-confidence links), plus
 * the candidate label/kind lookup by field. Paths index the veteran's arrays as stored (01 §3,
 * Q-110: deck/parents are in slot order; sparks keep their capture order).
 */
import type { RosterVeteran } from '@uma/schema';
import type { MasterData } from '../master/load.ts';
import { APT_LABEL, STAT_LABEL } from './keys.ts';

const OWNER: Record<string, string> = { self: 'Self', parent1: 'Parent 1', parent2: 'Parent 2' };

export function humanPath(path: string, v: RosterVeteran | undefined): string {
  const seg = path.split('/').slice(1);
  const [head, a, b] = seg;
  switch (head) {
    case 'stats':
      return `Stats · ${STAT_LABEL[a as keyof typeof STAT_LABEL] ?? a}`;
    case 'aptitudes':
      return `Aptitudes · ${APT_LABEL[a as keyof typeof APT_LABEL] ?? a}`;
    case 'sparks': {
      if (a === 'parent1' || a === 'parent2') return `Sparks · ${OWNER[a]} · whole block`;
      const i = Number(a);
      const sp = v?.sparks[i];
      if (!sp) return `Sparks · #${i + 1}${b ? ` · ${b}` : ''}`;
      const n = v!.sparks.slice(0, i + 1).filter((s) => s.owner === sp.owner && s.type === sp.type).length;
      return `Sparks · ${OWNER[sp.owner]} · ${sp.type} #${n}${b && b !== 'sparkId' ? ` · ${b}` : ''}`;
    }
    case 'skills':
      return `Skills · #${Number(a) + 1}${b && b !== 'skillId' ? ` · ${b}` : ''}`;
    case 'deck':
      return `Deck · slot ${Number(a) + 1}${b ? ` · ${b === 'cardId' ? 'card' : b}` : ''}`;
    case 'parents':
      return `Parents · slot ${Number(a) + 1}${b ? ` · ${b === 'characterId' ? 'character' : b === 'outfitId' ? 'outfit' : b}` : ''}`;
    case 'career':
      return `Career · ${a ?? ''}`;
    default:
      return seg.join(' · ');
  }
}

/** Label + kind text for a candidate value, by what the path points at. */
export function candidateLabel(value: unknown, path: string, m: MasterData): { label: string; kind: string } {
  if (typeof value !== 'string') return { label: JSON.stringify(value), kind: '' };
  const leaf = path.split('/').pop();
  if (value.startsWith('spark:')) {
    const s = m.sparks.get(value);
    return { label: s?.name ?? value, kind: s ? `${s.type} · ${s.target.kind}` : 'unknown spark' };
  }
  if (value.startsWith('skill:')) {
    const s = m.skills.get(value);
    return { label: s?.name ?? value, kind: s ? `skill · ${s.rarity}` : 'unknown skill' };
  }
  if (value.startsWith('character:')) return { label: m.characters.get(value)?.name ?? value, kind: 'character' };
  if (value.startsWith('outfit:')) {
    const o = m.outfits.get(value);
    return { label: o ? o.title : value, kind: o ? `outfit · ${m.characters.get(o.characterId)?.name ?? ''}` : 'outfit' };
  }
  if (value.startsWith('card:')) {
    const c = m.cards.get(value);
    return { label: c ? c.name : value, kind: c ? `card · ${c.title}` : 'card' };
  }
  if (value.startsWith('scenario:')) return { label: m.scenarios.get(value)?.name ?? value, kind: 'scenario' };
  return { label: value, kind: leaf ?? '' };
}

/** Which vocab kind a free-text search should look in for this path (null = any). */
export function vocabKindFor(path: string): 'character' | 'outfit' | 'skill' | 'spark' | 'scenario' | 'epithet' | null {
  const leaf = path.split('/').pop();
  if (path.startsWith('/sparks/')) return 'spark';
  if (path.startsWith('/skills/')) return 'skill';
  if (leaf === 'characterId') return 'character';
  if (leaf === 'outfitId') return 'outfit';
  if (leaf === 'scenarioId') return 'scenario';
  if (leaf === 'epithet') return 'epithet';
  return null;
}
