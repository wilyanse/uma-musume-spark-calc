import { z } from 'zod';
import {
  APT_KEYS,
  AptKey,
  CardType,
  Grade,
  Rarity,
  SparkType,
  STAT_KEYS,
  StatKey,
} from './enums.ts';
import {
  AnyMasterId,
  CardId,
  CharacterId,
  DHashHex,
  NonEmpty,
  OutfitId,
  ScenarioId,
  Sha256Hex,
  SkillId,
  SparkId,
} from './primitives.ts';

const gameId = z.number().int().optional();

const perKey = <K extends string>(keys: readonly K[], value: z.ZodType) =>
  z.strictObject(Object.fromEntries(keys.map((k) => [k, value])) as Record<K, z.ZodType>);

export const Character = z.strictObject({
  id: CharacterId,
  gameId,
  name: NonEmpty,
  aliases: z.array(z.string()),
  affinityGroups: z.array(z.string()),
  /** dHash hex of portrait icons, for parent/grandparent identification. */
  iconHashes: z.array(DHashHex),
});
export type Character = z.infer<typeof Character>;

export const Outfit = z.strictObject({
  id: OutfitId,
  gameId,
  characterId: CharacterId,
  title: NonEmpty,
  aptitudes: perKey(APT_KEYS, Grade) as z.ZodType<Record<AptKey, Grade>>,
  /** Growth rate per stat, in percent. */
  growth: perKey(STAT_KEYS, z.number()) as z.ZodType<Record<StatKey, number>>,
  uniqueSkillId: SkillId,
  innateSkillIds: z.array(SkillId),
});
export type Outfit = z.infer<typeof Outfit>;

export const SkillRarity = z.enum(['normal', 'gold', 'unique', 'evolved']);

export const Skill = z.strictObject({
  id: SkillId,
  gameId,
  name: NonEmpty,
  aliases: z.array(z.string()),
  rarity: SkillRarity,
  cost: z.number().optional(),
  tags: z.array(z.string()),
});
export type Skill = z.infer<typeof Skill>;

export const SparkTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stat'), stat: StatKey }),
  z.strictObject({ kind: z.literal('aptitude'), apt: AptKey }),
  z.strictObject({ kind: z.literal('skill'), skillId: SkillId }),
  z.strictObject({ kind: z.literal('race'), raceId: NonEmpty }),
  z.strictObject({ kind: z.literal('scenario'), scenarioId: ScenarioId }),
]);

export const Spark = z.strictObject({
  id: SparkId,
  gameId,
  name: NonEmpty,
  type: SparkType,
  target: SparkTarget,
});
export type Spark = z.infer<typeof Spark>;

export const SupportCard = z.strictObject({
  id: CardId,
  gameId,
  name: NonEmpty,
  title: z.string(),
  characterId: CharacterId.optional(),
  type: CardType,
  rarity: Rarity,
  hintSkillIds: z.array(SkillId),
  eventSkillIds: z.array(SkillId),
  /** dHash hex of card art. */
  artHashes: z.array(DHashHex),
});
export type SupportCard = z.infer<typeof SupportCard>;

export const AffinityGroup = z.strictObject({
  id: NonEmpty,
  members: z.array(CharacterId),
  points: z.number(),
});

/**
 * `{groups}` per 01 §11. The spec also allows "the pairwise table the source provides";
 * that is the optional `pairs` list (see changelog T01 decisions).
 */
export const Affinity = z.strictObject({
  groups: z.array(AffinityGroup),
  pairs: z.array(z.strictObject({ a: CharacterId, b: CharacterId, points: z.number() })).optional(),
});
export type Affinity = z.infer<typeof Affinity>;

export const Scenario = z.strictObject({
  id: ScenarioId,
  name: NonEmpty,
  statCap: z.number().int().min(1),
  inheritanceTurns: z.array(z.number().int().min(1)),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type Scenario = z.infer<typeof Scenario>;

export const Rank = z.strictObject({ id: NonEmpty, minRating: z.number().int().min(0) });
export type Rank = z.infer<typeof Rank>;

export const VocabEntry = z.strictObject({
  kind: z.enum(['character', 'outfit', 'skill', 'spark', 'scenario', 'epithet']),
  id: AnyMasterId,
  text: NonEmpty,
});
export type VocabEntry = z.infer<typeof VocabEntry>;

// One schema per file; the array-based files hold entries, affinity is an object.
export const CharactersFile = z.array(Character);
export const OutfitsFile = z.array(Outfit);
export const SkillsFile = z.array(Skill);
export const SparksFile = z.array(Spark);
export const CardsFile = z.array(SupportCard);
export const AffinityFile = Affinity;
export const ScenariosFile = z.array(Scenario);
export const RanksFile = z.array(Rank);
export const VocabFile = z.array(VocabEntry);

export const MASTER_FILE_NAMES = [
  'characters',
  'outfits',
  'skills',
  'sparks',
  'cards',
  'affinity',
  'scenarios',
  'ranks',
  'vocab',
  'rules',
] as const;

/** `/master/latest.json` -> `{version, files:{…}, sha256:{…}}` (01 §11). */
export const MasterLatest = z.strictObject({
  version: NonEmpty,
  /** File name (e.g. `characters.json`) -> path or URL of that file. */
  files: z.record(z.string(), z.string()),
  /** File name -> sha256 hex of the file. */
  sha256: z.record(z.string(), Sha256Hex),
});
export type MasterLatest = z.infer<typeof MasterLatest>;
