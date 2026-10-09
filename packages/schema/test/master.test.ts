import { describe, expect, it } from 'vitest';
import {
  Affinity,
  CharactersFile,
  CmTarget,
  MasterLatest,
  MODEL_SNAPSHOT_KINDS,
  ModelSnapshot,
  OutfitsFile,
  OwnedCardsSync,
  RanksFile,
  Rules,
  RosterVeteran,
  ReviewItem,
  ScenariosFile,
  SkillsFile,
  SparksFile,
  CardsFile,
  VocabFile,
} from '../src/index.ts';
import { baseVeteran } from './fixtures.ts';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  expect(schema.safeParse(v).success).toBe(true);
const bad = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  expect(schema.safeParse(v).success).toBe(false);

const ULID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';

describe('OwnedCardsSync (01 §4)', () => {
  const sync = {
    schemaVersion: 1,
    capturedAt: '2026-09-29T08:00:00Z',
    masterVersion: 'test-1',
    heldCount: 1,
    cards: [{ cardId: 'card:kitasan-black-ssr', lb: 4, level: 50, confidence: 0.98 }],
  };
  it('parses', () => ok(OwnedCardsSync, sync));
  it('rejects duplicate cardIds', () =>
    bad(OwnedCardsSync, { ...sync, heldCount: 2, cards: [sync.cards[0], sync.cards[0]] }));
  it('rejects a malformed cardId', () =>
    bad(OwnedCardsSync, { ...sync, cards: [{ ...sync.cards[0], cardId: 'Kitasan' }] }));
  it('rejects LB 5', () => bad(OwnedCardsSync, { ...sync, cards: [{ ...sync.cards[0], lb: 5 }] }));
  it('rejects confidence 2', () =>
    bad(OwnedCardsSync, { ...sync, cards: [{ ...sync.cards[0], confidence: 2 }] }));
});

describe('RosterVeteran (01 §9)', () => {
  const roster = () => ({
    ...baseVeteran(),
    parents: baseVeteran().parents.map((p) => ({ ...p, matchedVeteranId: null })),
    id: ULID,
    fingerprint: 'a'.repeat(64),
    modeSource: 'epithet',
    minConfidence: 0.9,
    capturedAt: '2026-09-29T08:00:00Z',
  });
  it('parses', () => ok(RosterVeteran, roster()));
  it('requires matchedVeteranId on parents', () => {
    const r = roster();
    r.parents = baseVeteran().parents.map((p) => ({ ...p })) as never;
    bad(RosterVeteran, r);
  });
  it('applies the parent rules too', () => {
    const r = roster();
    r.parents[1]!.characterId = r.parents[0]!.characterId;
    bad(RosterVeteran, r);
  });
  // T17 / ADR-0003: optional capture-status flag; absent = legacy row (strict numeric gate).
  it('accepts hasLowConfidence true/false and keeps it; absent stays absent (legacy)', () => {
    for (const flag of [true, false]) {
      const p = RosterVeteran.safeParse({ ...roster(), hasLowConfidence: flag });
      expect(p.success).toBe(true);
      expect(p.data!.hasLowConfidence).toBe(flag);
    }
    const legacy = RosterVeteran.parse(roster());
    expect('hasLowConfidence' in legacy).toBe(false);
  });
  it('rejects a malformed hasLowConfidence, never coercing it', () => {
    for (const flag of ['false', 'true', 0, 1, null, {}]) bad(RosterVeteran, { ...roster(), hasLowConfidence: flag });
  });
  it('keeps minConfidence independent of the flag (raw score, ADR-0003)', () => {
    const p = RosterVeteran.parse({ ...roster(), minConfidence: 0.3, hasLowConfidence: false });
    expect(p.minConfidence).toBe(0.3);
  });
});

describe('ReviewItem', () => {
  const field = {
    path: '/stats/spd',
    rawText: '1l00',
    value: 1100,
    confidence: 0.4,
    status: 'low_confidence',
    candidates: [{ value: 1100, score: 0.8 }],
    cropKey: 'crops/x/y.png',
  };
  const item = {
    id: ULID,
    veteranId: ULID,
    path: '/stats/spd',
    status: 'open',
    resolvedValue: null,
    createdAt: '2026-09-29T08:00:00Z',
    resolvedAt: null,
    field,
    cropKey: 'crops/x/y.png',
  };
  it('parses', () => ok(ReviewItem, item));
  it('rejects a status outside open/resolved/dismissed', () =>
    bad(ReviewItem, { ...item, status: 'closed' }));
});

describe('CmTarget (01 §10)', () => {
  const t = {
    id: ULID,
    name: 'Libra CM',
    course: { surface: 'turf', distance: 'medium', meters: 2200 },
    style: 'pace',
    minStats: { spd: 1000, wit: 600 },
    minAptitudes: { turf: 'A', medium: 'A', pace: 'A' },
    requiredSkills: ['skill:a'],
    optionalSkills: [{ skillId: 'skill:b', weight: 2 }],
  };
  it('parses with partial records and no statWeights', () => ok(CmTarget, t));
  it('rejects a non-ULID id', () => bad(CmTarget, { ...t, id: 't1' }));
  it('rejects an unknown stat key', () => bad(CmTarget, { ...t, minStats: { luck: 1 } }));
  it('rejects a bad grade', () => bad(CmTarget, { ...t, minAptitudes: { turf: 'Z' } }));
  it('rejects a bad surface', () =>
    bad(CmTarget, { ...t, course: { ...t.course, surface: 'snow' } }));
});

describe('master data files (01 §11)', () => {
  const apt = {
    turf: 'A',
    dirt: 'G',
    sprint: 'G',
    mile: 'A',
    medium: 'A',
    long: 'C',
    front: 'G',
    pace: 'A',
    late: 'B',
    end: 'G',
  };
  it('characters need iconHashes', () => {
    const c = {
      id: 'character:a',
      name: 'A',
      aliases: [],
      affinityGroups: ['g1'],
      iconHashes: ['ffee00'],
    };
    ok(CharactersFile, [c]);
    bad(CharactersFile, [{ ...c, iconHashes: undefined }]);
    bad(CharactersFile, [{ ...c, iconHashes: ['XYZ'] }]);
  });
  it('outfits', () => {
    const o = {
      id: 'outfit:a',
      characterId: 'character:a',
      title: 'A',
      aptitudes: apt,
      growth: { spd: 10, sta: 0, pow: 10, gut: 0, wit: 0 },
      uniqueSkillId: 'skill:u',
      innateSkillIds: [],
    };
    ok(OutfitsFile, [o]);
    bad(OutfitsFile, [{ ...o, growth: { spd: 10 } }]);
  });
  it('skills', () => {
    const s = { id: 'skill:a', name: 'A', aliases: [], rarity: 'gold', tags: [] };
    ok(SkillsFile, [s]);
    bad(SkillsFile, [{ ...s, rarity: 'mythic' }]);
  });
  it('sparks (discriminated targets)', () => {
    ok(SparksFile, [
      { id: 'spark:speed', name: 'Speed', type: 'blue', target: { kind: 'stat', stat: 'spd' } },
    ]);
    bad(SparksFile, [
      { id: 'spark:speed', name: 'Speed', type: 'blue', target: { kind: 'stat', stat: 'luck' } },
    ]);
    bad(SparksFile, [{ id: 'spark:speed', name: 'Speed', type: 'blue', target: { kind: 'nope' } }]);
  });
  it('cards', () => {
    const c = {
      id: 'card:a',
      name: 'A',
      title: 't',
      type: 'speed',
      rarity: 'SSR',
      hintSkillIds: [],
      eventSkillIds: [],
      artHashes: ['00ff'],
    };
    ok(CardsFile, [c]);
    bad(CardsFile, [{ ...c, rarity: 'UR' }]);
  });
  it('affinity groups', () => {
    ok(Affinity, { groups: [{ id: 'g1', members: ['character:a', 'character:b'], points: 1 }] });
    bad(Affinity, { groups: [{ id: 'g1', members: ['nope'], points: 1 }] });
  });
  it('scenarios, ranks, vocab', () => {
    ok(ScenariosFile, [
      { id: 'scenario:ura-finale', name: 'URA', statCap: 1200, inheritanceTurns: [12, 24] },
    ]);
    ok(RanksFile, [{ id: 'A+', minRating: 10000 }]);
    ok(VocabFile, [
      { kind: 'epithet', id: 'epithet:independent-learner', text: 'Independent Learner' },
    ]);
    bad(VocabFile, [{ kind: 'race', id: 'race:x', text: 'x' }]);
  });
  it('latest.json', () => {
    ok(MasterLatest, {
      version: 'v1',
      files: { characters: 'characters.json' },
      sha256: { characters: 'a'.repeat(64) },
    });
    bad(MasterLatest, { version: 'v1', files: {}, sha256: { characters: 'zz' } });
  });
});

describe('Rules (01 §12)', () => {
  const star = { '1': 0, '2': 0, '3': 0, verified: false, source: 'placeholder' };
  const rules = () => ({
    version: 'rules-1',
    activation: { blue: star, pink: star, green: star, white: star },
    affinityMultiplier: { formula: '1 + affinity/100', verified: false, source: 'placeholder' },
    grandparentWeight: { value: 0.5, verified: false, source: 'placeholder' },
    blueStatGain: star,
    blueInitialBonus: star,
    pinkGradeGain: star,
    whiteHintLevels: star,
    raceSparkStatGain: { verified: false, source: 'placeholder' },
    scenarioSparkEffects: { verified: false, source: 'placeholder' },
  });
  it('parses', () => ok(Rules, rules()));
  it('requires verified and source on each constant', () => {
    const r = rules();
    delete (r.grandparentWeight as Partial<typeof r.grandparentWeight>).source;
    bad(Rules, r);
  });
});

describe('ModelSnapshot (01 §13)', () => {
  const per = { coef: [0.1], intercept: 1, sigma: 2 };
  const snap = () => ({
    id: ULID,
    kind: 'training-v1',
    masterVersion: 'v1',
    trainedAt: '2026-09-29T08:00:00Z',
    nSamples: 10,
    params: {
      features: ['f'],
      perStat: { spd: per, sta: per, pow: per, gut: per, wit: per },
      residualCov: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
      skillAcquire: { independent: { '*': { a: 1, b: 1 } }, manual: {} },
      holdout: { mae: { spd: 1, sta: 1, pow: 1, gut: 1, wit: 1 }, coverage80: 0.8 },
    },
  });
  it('parses', () => ok(ModelSnapshot, snap()));
  it('accepts legacy training-v1 and training-v2 (ADR-0002), unchanged on round trip', () => {
    for (const kind of MODEL_SNAPSHOT_KINDS) {
      const s = { ...snap(), kind };
      expect(ModelSnapshot.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
    }
    expect(MODEL_SNAPSHOT_KINDS).toEqual(['training-v1', 'training-v2']);
  });
  it('rejects an unknown kind', () => {
    bad(ModelSnapshot, { ...snap(), kind: 'training-v3' });
    bad(ModelSnapshot, { ...snap(), kind: 'training' });
  });
  it('rejects a non-ULID id', () => bad(ModelSnapshot, { ...snap(), id: 'snap1' }));
  it('rejects a 4x5 residualCov', () => {
    const s = snap();
    s.params.residualCov.pop();
    bad(ModelSnapshot, s);
  });
  it('rejects a missing train mode in skillAcquire', () => {
    const s = snap();
    delete (s.params.skillAcquire as Partial<typeof s.params.skillAcquire>).manual;
    bad(ModelSnapshot, s);
  });
});
