/**
 * Reads the published Global master bundle (`apps/web/public/master/<latest>/`) from disk and
 * validates every file against the shared `@uma/schema` schemas. Read-only: it never writes or
 * refreshes the bundle. Used by the engine tests and by `scripts/smoke.ts`, which runs under
 * plain `node` (no transform flag), so this file uses erasable TypeScript only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AffinityFile,
  CardsFile,
  CharactersFile,
  MasterLatest,
  OutfitsFile,
  RanksFile,
  Rules,
  RosterVeteran,
  ScenariosFile,
  SkillsFile,
  SparksFile,
  VocabFile,
} from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';

export const PUBLISHED_MASTER_DIR = join(import.meta.dirname, '../../../apps/web/public/master');

function readJson(dir: string, file: string): unknown {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

/** The bundle named by `latest.json`, schema-validated. */
export function loadPublishedBundle(): MasterBundle {
  const latest = MasterLatest.parse(readJson(PUBLISHED_MASTER_DIR, 'latest.json'));
  const dir = join(PUBLISHED_MASTER_DIR, latest.version);
  return {
    version: latest.version,
    characters: CharactersFile.parse(readJson(dir, 'characters.json')),
    outfits: OutfitsFile.parse(readJson(dir, 'outfits.json')),
    skills: SkillsFile.parse(readJson(dir, 'skills.json')),
    sparks: SparksFile.parse(readJson(dir, 'sparks.json')),
    cards: CardsFile.parse(readJson(dir, 'cards.json')),
    affinity: AffinityFile.parse(readJson(dir, 'affinity.json')),
    scenarios: ScenariosFile.parse(readJson(dir, 'scenarios.json')),
    ranks: RanksFile.parse(readJson(dir, 'ranks.json')),
    vocab: VocabFile.parse(readJson(dir, 'vocab.json')),
    rules: Rules.parse(readJson(dir, 'rules.json')),
  };
}

type SparkInput = { sparkId: string; type: 'blue' | 'pink' | 'green' | 'white'; stars: 1 | 2 | 3 };
type ParentInput = { characterId: string; isGuest?: boolean; matchedVeteranId?: string | null };

/**
 * A schema-valid `RosterVeteran` (01 §9) with the given character, sparks per owner and parents.
 * Fields the inheritance model doesn't read (stats, deck, …) get fixed valid values.
 */
export function makeRosterVeteran(input: {
  id: string;
  characterId: string;
  outfitId: string;
  cardId: string;
  scenarioId: string;
  self: SparkInput[];
  parent1: SparkInput[];
  parent2: SparkInput[];
  /** Listed in this array order; `slot` follows `slots` (default [1, 2]). */
  parents: [ParentInput, ParentInput];
  slots?: [1 | 2, 1 | 2];
}): RosterVeteran {
  const slots = input.slots ?? [1, 2];
  return RosterVeteran.parse({
    id: input.id,
    fingerprint: 'a'.repeat(64),
    modeSource: 'epithet',
    minConfidence: 0.95,
    capturedAt: '2026-09-30T00:00:00Z',
    characterId: input.characterId,
    outfitId: input.outfitId,
    rank: 'A',
    rating: 10000,
    epithet: 'Independent Learner',
    trainMode: 'independent',
    stats: { spd: 1000, sta: 800, pow: 900, gut: 400, wit: 600 },
    aptitudes: {
      turf: 'A', dirt: 'G', sprint: 'G', mile: 'A', medium: 'A',
      long: 'C', front: 'G', pace: 'A', late: 'B', end: 'G',
    },
    skills: [],
    sparks: [
      ...input.self.map((s) => ({ owner: 'self', ...s })),
      ...input.parent1.map((s) => ({ owner: 'parent1', ...s })),
      ...input.parent2.map((s) => ({ owner: 'parent2', ...s })),
    ],
    deck: [1, 2, 3, 4, 5, 6].map((slot) => ({ slot, cardId: input.cardId, lb: 4, level: 50, borrowed: false })),
    parents: input.parents.map((p, i) => ({
      slot: slots[i],
      characterId: p.characterId,
      outfitId: null,
      isGuest: p.isGuest ?? false,
      guestTrainer: p.isGuest ? 'Guest Trainer' : null,
      matchedVeteranId: p.matchedVeteranId ?? null,
    })),
    scenarioId: input.scenarioId,
    career: { races: 30, wins: 20, fans: 500000, dateAcquired: '2026-09-01' },
  });
}
