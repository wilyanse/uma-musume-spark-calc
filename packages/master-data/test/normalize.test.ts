import { describe, expect, it } from 'vitest';
import { buildRankNames, canonicalName, normalise, slugify, type RawBundle } from '../src/normalize.ts';

describe('slugify / canonicalName', () => {
  it('collapses non-alphanumerics to single dashes (01 §1)', () => {
    expect(slugify('T.M. Opera O')).toBe('t-m-opera-o');
    expect(slugify('Ignited Spirit: Stamina +')).toBe('ignited-spirit-stamina');
    expect(slugify('KEEP IT REAL.')).toBe('keep-it-real');
  });
  it('maps the small circle to the game glyph', () => {
    expect(canonicalName('Corner Recovery \u25CB')).toBe('Corner Recovery \u25EF');
    expect(canonicalName('Corner Recovery \u25CE')).toBe('Corner Recovery \u25CE');
  });
});

describe('buildRankNames', () => {
  it('has 98 names in ladder order and rejects a length mismatch', () => {
    const n = buildRankNames(98);
    expect(n.slice(0, 3)).toEqual(['G', 'G+', 'F']);
    expect(n[12]).toBe('A');
    expect(n[13]).toBe('A+');
    expect(n[17]).toBe('SS+');
    expect(n[18]).toBe('UG');
    expect(n[97]).toBe('US9');
    expect(() => buildRankNames(97)).toThrow();
  });
});

const rawFixture = (): RawBundle => ({
  characters: [
    { char_id: 1001, en_name: 'Alpha', playable_en: true },
    { char_id: 1002, en_name: 'Beta', playable_en: true },
    { char_id: 1003, en_name: 'JP Only', playable_en: undefined },
  ],
  characterCards: [
    { card_id: 100101, char_id: 1001, name_en: 'Alpha', title: 'x', title_en_gl: '[Same Title]', release_en: '2025-01-01', aptitude: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'S'], stat_bonus: [0, 20, 0, 10, 0], skills_unique: [1, 2], skills_innate: [3] },
    { card_id: 100201, char_id: 1002, name_en: 'Beta', title: 'x', title_en_gl: '[Same Title]', release_en: '2025-01-01', aptitude: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'S'], stat_bonus: [0, 0, 0, 0, 0], skills_unique: [2], skills_innate: [] },
    { card_id: 100301, char_id: 1003, name_en: 'JP Only', title: 'x', title_en_gl: '[Nope]', aptitude: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A', 'B', 'S'], stat_bonus: [0, 0, 0, 0, 0], skills_unique: [2], skills_innate: [] },
  ],
  supportCards: [],
  skills: [
    { id: 1, name_en: 'Low Unique', rarity: 3 },
    { id: 2, name_en: 'High Unique', rarity: 5 },
    { id: 3, name_en: 'Corner Recovery \u25CB', rarity: 1, cost: 170 },
    { id: 4, name_en: 'Unreleased', rarity: 1, unreleased: ['en'] },
  ],
  factors: { blue: [], pink: [], race: [], scenario: [], skill: [], other: [] },
  scenarios: [{ id: 1, name_en: 'Ura Finale', start_en: 1, hard_caps: [2000, 2000, 2000, 2000, 2000, 9999] }, { id: 6, hard_caps: [2000] }],
  staticScenarios: [],
  nicknames: [{ id: 1, name_en_gl: 'Independent Learner' }],
  ranks: Array.from({ length: 98 }, (_, i) => ({ id: i + 1, min_value: i * 10, max_value: i * 10 + 9 })),
  relations: [{ relation_type: 101, relation_point: 2 }, { relation_type: 102, relation_point: 3 }],
  relationMembers: [
    { chara_id: 1001, relation_type: 101 },
    { chara_id: 1002, relation_type: 101 },
    { chara_id: 1003, relation_type: 101 },
    { chara_id: 1001, relation_type: 102 },
  ],
});

describe('normalise', () => {
  const n = normalise(rawFixture(), { ids: {}, aliases: { 'character:alpha': ['Alpha Alias'] } });

  it('keeps only Global characters/outfits/skills', () => {
    expect(n.characters.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
    expect(n.outfits).toHaveLength(2);
    expect(n.skills.map((s) => s.name)).toEqual(['Low Unique', 'High Unique', 'Corner Recovery \u25EF']);
  });
  it('resolves slug collisions with -2 and reports them for overrides/ids.json', () => {
    expect(n.outfits.map((o) => o.id)).toEqual(['outfit:same-title', 'outfit:same-title-2']);
    expect(n.ids['outfit:100101']).toBe('outfit:same-title');
    expect(n.ids['outfit:100201']).toBe('outfit:same-title-2');
  });
  it('honours pinned IDs so collisions stay stable', () => {
    const swapped = normalise(rawFixture(), { ids: { 'outfit:100101': 'outfit:same-title-2', 'outfit:100201': 'outfit:same-title' }, aliases: {} });
    expect(swapped.outfits.find((o) => o.gameId === 100101)?.id).toBe('outfit:same-title-2');
  });
  it('takes the last released unique skill as the outfit unique skill', () => {
    expect(n.outfits[0]?.uniqueSkillId).toBe('skill:high-unique');
  });
  it('adds aliases from overrides and builds vocab with both circle glyphs', () => {
    expect(n.characters[0]?.aliases).toEqual(['Alpha Alias']);
    const texts = n.vocab.map((v) => v.text);
    expect(texts).toContain('Alpha Alias');
    expect(texts).toContain('Corner Recovery \u25CB');
    expect(texts).toContain('Corner Recovery \u25EF');
    expect(n.vocab.find((v) => v.text === 'Independent Learner')?.kind).toBe('epithet');
  });
  it('builds affinity groups only from Global members, dropping one-member groups', () => {
    expect(n.affinity.groups).toEqual([{ id: 'relation:101', members: ['character:alpha', 'character:beta'], points: 2 }]);
    expect(n.characters[0]?.affinityGroups).toEqual(['relation:101']);
  });
  it('uses the in-game casing from the static scenario factor (review S4)', () => {
    const raw = rawFixture();
    raw.staticScenarios = [{ id: 1, factors: [{ name_en: 'URA Finale' }] }] as never;
    const r = normalise(raw, { ids: {}, aliases: {} });
    expect(r.scenarios[0]?.name).toBe('URA Finale');
    expect(r.scenarios[0]?.id).toBe('scenario:ura-finale');
  });
  it('excludes scenarios without a Global start date', () => {
    expect(n.scenarios.map((s) => s.id)).toEqual(['scenario:ura-finale']);
    expect(n.scenarios[0]?.statCap).toBe(2000);
  });
  it('drops references to non-Global skills and logs the gap', () => {
    const raw = rawFixture();
    raw.supportCards = [
      { support_id: 1, char_id: 1001, char_name: 'Alpha', title_en: '[T]', type: 'intelligence', rarity: 3, release_en: '2025-01-01', event_skills: [4], hints: { hint_skills: [3, 4] } },
    ];
    const r = normalise(raw, { ids: {}, aliases: {} });
    expect(r.cards[0]?.type).toBe('wit');
    expect(r.cards[0]?.hintSkillIds).toEqual(['skill:corner-recovery']);
    expect(r.cards[0]?.eventSkillIds).toEqual([]);
    expect(r.gaps.some((g) => g.includes('skill 4'))).toBe(true);
  });
});

describe('ID stability across Global updates (01 §1, review B2)', () => {
  it('keeps a previously allocated slug when a NEW entity with a lower gameId shares it', () => {
    const before = rawFixture();
    before.skills.push({ id: 50, name_en: 'Forward March!', rarity: 1 });
    const first = normalise(before, { ids: {}, aliases: {} });
    expect(first.skills.find((s) => s.gameId === 50)?.id).toBe('skill:forward-march');

    const after = rawFixture();
    after.skills.push({ id: 50, name_en: 'Forward March!', rarity: 1 }, { id: 5, name_en: 'Forward March!', rarity: 1 });
    const second = normalise(after, { ids: first.ids, aliases: {} });
    expect(second.skills.find((s) => s.gameId === 50)?.id).toBe('skill:forward-march'); // existing ID unchanged
    expect(second.skills.find((s) => s.gameId === 5)?.id).toBe('skill:forward-march-2'); // newcomer moves
    // Regression guard: without the previous pins the lower gameId steals the base ID (the round-1 bug).
    expect(normalise(after, { ids: {}, aliases: {} }).skills.find((s) => s.gameId === 50)?.id).toBe('skill:forward-march-2');
  });

  it('pins every allocation, is deterministic, and never drops retired pins', () => {
    const a = normalise(rawFixture(), { ids: {}, aliases: {} });
    const b = normalise(rawFixture(), { ids: a.ids, aliases: {} });
    expect(b.ids).toEqual(a.ids);
    expect(a.ids['character:1001']).toBe('character:alpha');
    expect(a.ids['skill:3']).toBe('skill:corner-recovery');
    const retired = normalise(rawFixture(), { ids: { ...a.ids, 'skill:99': 'skill:gone' }, aliases: {} });
    expect(retired.ids['skill:99']).toBe('skill:gone');
  });

  it('rejects two pin keys that claim the same ID', () => {
    expect(() => normalise(rawFixture(), { ids: { 'skill:1': 'skill:x', 'skill:2': 'skill:x' }, aliases: {} })).toThrow(/both/);
  });
});
