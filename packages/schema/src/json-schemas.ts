import { z } from 'zod';
import { ReviewItem, OwnedCardsSync, RosterVeteran } from './api.ts';
import { VeteranCapture } from './capture.ts';
import { CmTarget } from './cm-target.ts';
import {
  AffinityFile,
  CardsFile,
  CharactersFile,
  MasterLatest,
  OutfitsFile,
  RanksFile,
  ScenariosFile,
  SkillsFile,
  SparksFile,
  VocabFile,
} from './master.ts';
import { ModelSnapshot } from './model-snapshot.ts';
import { Rules } from './rules.ts';

/** One entry per top-level contract; the key is the `json/<key>.schema.json` file name. */
export const CONTRACTS = {
  VeteranCapture,
  OwnedCardsSync,
  RosterVeteran,
  ReviewItem,
  CmTarget,
  ModelSnapshot,
  Rules,
  MasterLatest,
  'master.characters': CharactersFile,
  'master.outfits': OutfitsFile,
  'master.skills': SkillsFile,
  'master.sparks': SparksFile,
  'master.cards': CardsFile,
  'master.affinity': AffinityFile,
  'master.scenarios': ScenariosFile,
  'master.ranks': RanksFile,
  'master.vocab': VocabFile,
} as const satisfies Record<string, z.ZodType>;

export type ContractName = keyof typeof CONTRACTS;

/**
 * JSON Schema (draft 2020-12) for a contract, via zod's own exporter.
 * `io: 'input'` because consumers (the C# agent, API clients) produce the input side.
 */
export function contractJsonSchema(name: ContractName): Record<string, unknown> {
  return z.toJSONSchema(CONTRACTS[name], { target: 'draft-2020-12', io: 'input' });
}
