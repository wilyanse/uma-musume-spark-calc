/** S01 client-side filter/sort over the already-loaded roster (60 §3, bindings S01). Pure. */
import type { RosterVeteran, SparkType, TrainMode } from '@uma/schema';
import type { MasterData } from '../master/load.ts';

export interface RosterFilter {
  characterId: string;
  mode: TrainMode | 'all';
  scenarioId: string;
  sparkId: string;
  minStars: 1 | 2 | 3;
  ratingMin: number | null;
  ratingMax: number | null;
}

export const defaultFilter: RosterFilter = {
  characterId: '',
  mode: 'all',
  scenarioId: '',
  sparkId: '',
  minStars: 1,
  ratingMin: null,
  ratingMax: null,
};

export function filterRoster(roster: readonly RosterVeteran[], f: RosterFilter): RosterVeteran[] {
  return roster.filter(
    (v) =>
      (!f.characterId || v.characterId === f.characterId) &&
      (f.mode === 'all' || v.trainMode === f.mode) &&
      (!f.scenarioId || v.scenarioId === f.scenarioId) &&
      (!f.sparkId || v.sparks.some((s) => s.sparkId === f.sparkId && s.stars >= f.minStars)) &&
      (f.ratingMin === null || v.rating >= f.ratingMin) &&
      (f.ratingMax === null || v.rating <= f.ratingMax),
  );
}

export type SortKey =
  | 'name'
  | 'rank'
  | 'rating'
  | 'spd'
  | 'sta'
  | 'pow'
  | 'gut'
  | 'wit'
  | 'mode'
  | 'scenario'
  | 'date';
export type SortDir = 'asc' | 'desc';

export const SORT_LABEL: Record<SortKey, string> = {
  name: 'veteran',
  rank: 'rank',
  rating: 'rating',
  spd: 'speed',
  sta: 'stamina',
  pow: 'power',
  gut: 'guts',
  wit: 'wit',
  mode: 'mode',
  scenario: 'scenario',
  date: 'date',
};

export function sortRoster(
  roster: readonly RosterVeteran[],
  key: SortKey,
  dir: SortDir,
  m: MasterData,
): RosterVeteran[] {
  const val = (v: RosterVeteran): string | number => {
    switch (key) {
      case 'name':
        return m.characters.get(v.characterId)?.name ?? v.characterId;
      case 'rank':
        // Order of the badge in master ranks.json (by its minRating); unknown badges sort first.
        return m.bundle.ranks.find((r) => r.id === v.rank)?.minRating ?? -1;
      case 'rating':
        return v.rating;
      case 'mode':
        return v.trainMode;
      case 'scenario':
        return m.scenarios.get(v.scenarioId)?.name ?? v.scenarioId;
      case 'date':
        return v.career.dateAcquired;
      default:
        return v.stats[key];
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...roster].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c !== 0 ? sign * c : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type SparkLite = RosterVeteran['sparks'][number];

/** 01 §3: exactly one blue and one pink, at most one green on `self`. */
export function selfSparkSummary(v: RosterVeteran): Partial<Record<Exclude<SparkType, 'white'>, SparkLite>> {
  const out: Partial<Record<Exclude<SparkType, 'white'>, SparkLite>> = {};
  for (const s of v.sparks) {
    if (s.owner === 'self' && s.type !== 'white' && !out[s.type]) out[s.type] = s;
  }
  return out;
}

export function lastImport(roster: readonly RosterVeteran[]): string | null {
  let max: string | null = null;
  for (const v of roster) if (max === null || v.capturedAt > max) max = v.capturedAt;
  return max;
}
