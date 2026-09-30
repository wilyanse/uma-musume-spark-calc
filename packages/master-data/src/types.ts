// Master-data types. These are re-exports of the @uma/schema shapes (01 §11), so
// consumers (engine, web, api) can import `@uma/master-data` without a second definition.
export type {
  Affinity,
  Character,
  MasterLatest,
  Outfit,
  Rank,
  Rules,
  Scenario,
  Skill,
  Spark,
  SupportCard,
  VocabEntry,
} from '@uma/schema';

import type {
  Affinity,
  Character,
  Outfit,
  Rank,
  Rules,
  Scenario,
  Skill,
  Spark,
  SupportCard,
  VocabEntry,
} from '@uma/schema';

/** The whole bundle as loaded from `/master/<version>/`. */
export interface MasterBundle {
  version: string;
  characters: Character[];
  outfits: Outfit[];
  skills: Skill[];
  sparks: Spark[];
  cards: SupportCard[];
  affinity: Affinity;
  scenarios: Scenario[];
  ranks: Rank[];
  vocab: VocabEntry[];
  rules: Rules;
}
