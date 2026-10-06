/**
 * Human labels for `CaptureField.path` JSON pointers (S03 list, S02 low-confidence links), the
 * candidate label/kind lookup by field, and what a review resolution for a path may send. Paths
 * index the veteran's arrays as stored (01 §3, Q-110: deck/parents are in slot order; sparks keep
 * their capture order).
 */
import type { RosterVeteran, SparkType } from '@uma/schema';
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

export type IdVocab = 'character' | 'outfit' | 'skill' | 'spark' | 'scenario' | 'card';

/**
 * What a review resolution for `path` may send. Mirrors the leaves the API's `correctionTarget`
 * accepts (apps/api/src/checks.ts), typed by the 01 §3 `veteran` schema:
 * - `id`: a master-data ID found through a search. A spark slot only lists sparks of the slot's
 *   recorded type, because the resolution never changes `type`.
 * - `text`: free text. `/epithet` searches the epithet vocabulary but sends the epithet TEXT:
 *   `Veteran.epithet` is free text and the train-mode rule compares it (01 §6).
 * - `number` (`min`..`max`), `grade`, `boolean`: typed scalars, no vocabulary.
 * - `sparkList`: the `/sparks/<parent>` pseudo-pointer (candidates only).
 * - `none`: not correctable through a review item (`/trainMode`, spark `type`/`owner`,
 *   deck/parent `slot`, whole arrays or elements, unknown paths).
 */
export type Resolution =
  | { value: 'id'; vocab: IdVocab; sparkType?: SparkType }
  | { value: 'text'; vocab: 'epithet' | null }
  | { value: 'number'; vocab: null; min: number; max: number | null }
  | { value: 'grade' | 'boolean' | 'sparkList' | 'none'; vocab: null };

const NONE: Resolution = { value: 'none', vocab: null };
const num = (min: number, max: number | null): Resolution => ({ value: 'number', vocab: null, min, max });
const STAT_LEAVES = new Set(['spd', 'sta', 'pow', 'gut', 'wit']);

export function resolutionFor(path: string, v: RosterVeteran | undefined): Resolution {
  const seg = path.split('/').slice(1);
  const [head, a, b] = seg;
  if (seg.length === 1) {
    switch (head) {
      case 'characterId':
        return { value: 'id', vocab: 'character' };
      case 'outfitId':
        return { value: 'id', vocab: 'outfit' };
      case 'scenarioId':
        return { value: 'id', vocab: 'scenario' };
      case 'epithet':
        return { value: 'text', vocab: 'epithet' };
      case 'rank':
        return { value: 'text', vocab: null };
      case 'rating':
        return num(0, null);
      default:
        return NONE; // includes /trainMode (PATCH only) and whole objects/arrays
    }
  }
  if (seg.length === 2) {
    if (head === 'stats' && STAT_LEAVES.has(a!)) return num(1, 2000);
    if (head === 'aptitudes' && a && a in APT_LABEL) return { value: 'grade', vocab: null };
    if (head === 'sparks' && (a === 'parent1' || a === 'parent2')) return { value: 'sparkList', vocab: null };
    if (head === 'career') {
      if (a === 'races' || a === 'wins' || a === 'fans') return num(0, null);
      if (a === 'dateAcquired') return { value: 'text', vocab: null };
    }
    return NONE;
  }
  if (seg.length !== 3 || !/^\d+$/.test(a!)) return NONE;
  const i = Number(a);
  switch (head) {
    case 'skills':
      if (v && !v.skills[i]) return NONE;
      return b === 'skillId' ? { value: 'id', vocab: 'skill' } : b === 'level' ? num(1, null) : NONE;
    case 'sparks': {
      const sp = v?.sparks[i];
      if (v && !sp) return NONE;
      if (b === 'sparkId') return { value: 'id', vocab: 'spark', ...(sp ? { sparkType: sp.type } : {}) };
      if (b === 'stars') return num(1, 3);
      return NONE; // owner/type never change through a resolution
    }
    case 'deck':
      if (v && !v.deck[i]) return NONE;
      if (b === 'cardId') return { value: 'id', vocab: 'card' };
      if (b === 'lb') return num(0, 4);
      if (b === 'level') return num(1, null);
      if (b === 'borrowed') return { value: 'boolean', vocab: null };
      return NONE;
    case 'parents':
      if (v && !v.parents[i]) return NONE;
      if (b === 'characterId') return { value: 'id', vocab: 'character' };
      if (b === 'outfitId') return { value: 'id', vocab: 'outfit' };
      if (b === 'isGuest') return { value: 'boolean', vocab: null };
      if (b === 'guestTrainer') return { value: 'text', vocab: null };
      return NONE;
    default:
      return NONE;
  }
}

export interface VocabHit {
  key: string;
  label: string;
  kind: string;
  /** Exactly what the resolve request sends. */
  value: string;
}

/** Search for a resolution: at most `limit` hits by text, no duplicate values. */
export function searchVocab(query: string, res: Resolution, m: MasterData, _v?: RosterVeteran, limit = 8): VocabHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || res.vocab === null) return [];
  const out: VocabHit[] = [];
  const seen = new Set<string>();
  const push = (h: VocabHit) => {
    if (seen.has(h.value)) return;
    seen.add(h.value);
    out.push(h);
  };
  if (res.vocab === 'card') {
    for (const c of m.bundle.cards) {
      if (out.length >= limit) break;
      if (`${c.name} ${c.title}`.toLowerCase().includes(q)) push({ key: c.id, label: c.name, kind: `card · ${c.title}`, value: c.id });
    }
    return out;
  }
  const kind = res.vocab;
  for (const e of m.bundle.vocab) {
    if (out.length >= limit) break;
    if (e.kind !== kind || !e.text.toLowerCase().includes(q)) continue;
    if (kind === 'epithet') {
      push({ key: e.id, label: e.text, kind: 'epithet', value: e.text });
    } else if (kind === 'spark' && res.value === 'id' && res.sparkType) {
      const s = m.sparks.get(e.id);
      if (s && s.type === res.sparkType) push({ key: e.id, label: e.text, kind: `spark · ${s.type}`, value: e.id });
    } else {
      push({ key: e.id, label: e.text, kind: e.kind, value: e.id });
    }
  }
  return out;
}

/** Validation message for a typed number, or null when it is acceptable. */
export function numberError(raw: string, res: Extract<Resolution, { value: 'number' }>): string | null {
  const t = raw.trim();
  const n = Number(t);
  const range = res.max === null ? `of at least ${res.min}` : `from ${res.min} to ${res.max}`;
  if (!/^\d+$/.test(t) || n < res.min || (res.max !== null && n > res.max)) return `Enter a whole number ${range}.`;
  return null;
}
