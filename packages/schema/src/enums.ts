import { z } from 'zod';

/** 01 §1: stats order is always [speed, stamina, power, guts, wit]. */
export const STAT_KEYS = ['spd', 'sta', 'pow', 'gut', 'wit'] as const;
/** 01 §1: aptitude keys, in the canonical order used by the fingerprint. */
export const APT_KEYS = [
  'turf',
  'dirt',
  'sprint',
  'mile',
  'medium',
  'long',
  'front',
  'pace',
  'late',
  'end',
] as const;
/** 01 §1: grade enum, ordinal 0-7. */
export const GRADES = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'] as const;

export const StatKey = z.enum(STAT_KEYS);
export const AptKey = z.enum(APT_KEYS);
export const Grade = z.enum(GRADES);

export const SparkType = z.enum(['blue', 'pink', 'green', 'white']);
export const SparkOwner = z.enum(['self', 'parent1', 'parent2']);
export const TrainMode = z.enum(['independent', 'manual']);
export const ModeSource = z.enum(['epithet', 'override']);
export const CardType = z.enum(['speed', 'stamina', 'power', 'guts', 'wit', 'friend', 'group']);
export const Rarity = z.enum(['R', 'SR', 'SSR']);
export const FieldStatus = z.enum(['ok', 'low_confidence', 'corrected']);

export type StatKey = z.infer<typeof StatKey>;
export type AptKey = z.infer<typeof AptKey>;
export type Grade = z.infer<typeof Grade>;
export type SparkType = z.infer<typeof SparkType>;
export type SparkOwner = z.infer<typeof SparkOwner>;
export type TrainMode = z.infer<typeof TrainMode>;
export type ModeSource = z.infer<typeof ModeSource>;
export type CardType = z.infer<typeof CardType>;
export type Rarity = z.infer<typeof Rarity>;
export type FieldStatus = z.infer<typeof FieldStatus>;

/** Ordinal of a grade, G = 0 ... S = 7. */
export function gradeOrdinal(grade: Grade): number {
  return GRADES.indexOf(grade);
}
