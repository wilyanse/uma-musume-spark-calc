import type { AptKey, RosterVeteran, SparkType, StatKey, TrainMode } from '@uma/schema';

/** 50 §1: `Veteran` = `RosterVeteran` from 01 §9. */
export type Veteran = RosterVeteran;
export type DeckSlot = RosterVeteran['deck'][number];
export type Stars = 1 | 2 | 3;

/** 50 §1 planner input (consumed by T06). */
export interface PlanInput {
  traineeOutfitId: string;
  /** Exactly 6 slots. */
  deck: DeckSlot[];
  trainMode: TrainMode;
  scenarioId: string;
  lockParent1?: string;
}

/** Five numbers in the 01 §1 stat order `[spd, sta, pow, gut, wit]`. */
export type StatVector = [number, number, number, number, number];

/**
 * What one spark activation does to the child (50 §3 "Effects of one activation").
 * Scenario plugins may return a `Partial<Effect>` for scenario-specific white sparks (50 §2).
 */
export interface Effect {
  /** Stat points added, in stat order. */
  stats: StatVector;
  /** Aptitude grade steps added (integers), before the S cap. */
  aptitudeGrades: Partial<Record<AptKey, number>>;
  /**
   * Skill hints granted. Within one activation a skill id appears at most once: the engine
   * merges duplicates (keeping the highest level), so one activation is one hint chance.
   */
  hints: { skillId: string; level: number }[];
}

/** One spark on a legacy, as the engine consumes it. */
export interface SparkRef {
  sparkId: string;
  type: SparkType;
  stars: Stars;
}

/**
 * A legacy (a parent) as the inheritance model needs it: its character, its own sparks and its
 * two parents (the child's grandparents). Built from a roster veteran by `legacyFromVeteran`, or
 * by T06 from a veteran's recorded parent blocks (guests, unmatched parents).
 */
export interface Legacy {
  /** Roster veteran id when the legacy is a roster veteran, else null (guest / unmatched). */
  veteranId: string | null;
  characterId: string;
  sparks: SparkRef[];
  /** Index 0 = the legacy's parent slot 1, index 1 = slot 2. Null when unknown. */
  grandparents: [Grandparent | null, Grandparent | null];
}

export interface Grandparent {
  /** Null when the grandparent's character is unknown; its sparks still roll, affinity is 0. */
  characterId: string | null;
  sparks: SparkRef[];
}

/** Where a spark comes from: parents, then the grandparents (`GP1a` = P1's parent slot 1). */
export type SparkSource = 'P1' | 'P2' | 'GP1a' | 'GP1b' | 'GP2a' | 'GP2b';
export const SPARK_SOURCES: readonly SparkSource[] = ['P1', 'P2', 'GP1a', 'GP1b', 'GP2a', 'GP2b'];

export type { AptKey, StatKey };
