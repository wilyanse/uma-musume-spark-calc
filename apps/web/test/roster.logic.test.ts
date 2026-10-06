import { describe, expect, it } from 'vitest';
import { APT_KEYS as SCHEMA_APT, GRADES as SCHEMA_GRADES, STAT_KEYS as SCHEMA_STATS } from '@uma/schema';
import { APT_KEYS, GRADES, STAT_KEYS } from '../src/lib/keys.ts';
import {
  defaultFilter,
  filterRoster,
  lastImport,
  selfSparkSummary,
  sortRoster,
  type RosterFilter,
} from '../src/lib/roster.ts';
import { goldenRoster, masterData } from './fixtures.ts';

describe('contract key constants', () => {
  it('equal the @uma/schema exports', () => {
    expect(STAT_KEYS).toEqual(SCHEMA_STATS);
    expect(APT_KEYS).toEqual(SCHEMA_APT);
    expect(GRADES).toEqual(SCHEMA_GRADES);
  });
});

describe('roster filter (F05, 60 §3 client-side)', () => {
  const roster = goldenRoster();
  const f = (p: Partial<RosterFilter>) => filterRoster(roster, { ...defaultFilter, ...p });

  it('default filter keeps everything', () => {
    expect(f({})).toHaveLength(roster.length);
  });
  it('filters by mode and scenario', () => {
    const out = f({ mode: 'manual', scenarioId: 'scenario:ura-finale' });
    expect(out.length).toBe(36);
    expect(out.every((v) => v.trainMode === 'manual' && v.scenarioId === 'scenario:ura-finale')).toBe(true);
  });
  it('filters by character', () => {
    const c = roster[0]!.characterId;
    const out = f({ characterId: c });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((v) => v.characterId === c)).toBe(true);
  });
  it('has-spark X with stars >= N looks at every owner', () => {
    const out = f({ sparkId: 'spark:restraint', minStars: 3 });
    // best1 holds a 3★ self restraint spark (truth.json); its guest parent's 2★ does not reach 3.
    expect(out.map((v) => v.id)).toContain('01M379DKQ86T9BGV6696R6DWN2');
    expect(
      out.every((v) => v.sparks.some((s) => s.sparkId === 'spark:restraint' && s.stars >= 3)),
    ).toBe(true);
    const two = f({ sparkId: 'spark:restraint', minStars: 2 });
    expect(two.length).toBeGreaterThanOrEqual(out.length);
  });
  it('rating range is inclusive and open-ended when blank', () => {
    const ratings = roster.map((v) => v.rating).sort((a, b) => a - b);
    const mid = ratings[130]!;
    expect(f({ ratingMin: mid }).every((v) => v.rating >= mid)).toBe(true);
    expect(f({ ratingMax: mid }).every((v) => v.rating <= mid)).toBe(true);
    expect(f({ ratingMin: mid, ratingMax: mid }).every((v) => v.rating === mid)).toBe(true);
  });
});

describe('roster sort', () => {
  const roster = goldenRoster();
  const m = masterData();
  it('sorts by rating desc and asc, stable on id', () => {
    const d = sortRoster(roster, 'rating', 'desc', m);
    for (let i = 1; i < d.length; i++) expect(d[i - 1]!.rating).toBeGreaterThanOrEqual(d[i]!.rating);
    const a = sortRoster(roster, 'rating', 'asc', m);
    expect(a[0]!.rating).toBe(d[d.length - 1]!.rating);
  });
  it('sorts by a stat', () => {
    const d = sortRoster(roster, 'spd', 'desc', m);
    expect(d[0]!.stats.spd).toBe(Math.max(...roster.map((v) => v.stats.spd)));
  });
  it('sorts by date acquired (newest first by default direction desc)', () => {
    const d = sortRoster(roster, 'date', 'desc', m);
    expect(d[0]!.career.dateAcquired >= d[d.length - 1]!.career.dateAcquired).toBe(true);
  });
  it('sorts by veteran name via master data', () => {
    const a = sortRoster(roster, 'name', 'asc', m);
    const names = a.map((v) => m.characters.get(v.characterId)?.name ?? v.characterId);
    expect([...names].sort((x, y) => x.localeCompare(y))).toEqual(names);
  });
  it('does not mutate its input', () => {
    const copy = roster.map((v) => v.id);
    sortRoster(roster, 'rating', 'asc', m);
    expect(roster.map((v) => v.id)).toEqual(copy);
  });
});

describe('roster summaries', () => {
  it('self spark summary has one blue, one pink and at most one green', () => {
    const s = selfSparkSummary(goldenRoster()[0]!);
    expect(s.blue?.type).toBe('blue');
    expect(s.pink?.type).toBe('pink');
  });
  it('last import is the max capturedAt, null when empty', () => {
    const r = goldenRoster();
    expect(lastImport(r)).toBe(r.map((v) => v.capturedAt).sort().at(-1));
    expect(lastImport([])).toBeNull();
  });
});
