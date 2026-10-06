/**
 * Contract key lists (01 §1), duplicated as plain constants so the main bundle can stay free of
 * the zod runtime (`@uma/schema` is imported for types only outside the engine worker). A unit
 * test checks they equal the `@uma/schema` exports.
 */
import type { AptKey, Grade, StatKey } from '@uma/schema';

export const STAT_KEYS: readonly StatKey[] = ['spd', 'sta', 'pow', 'gut', 'wit'];
export const APT_KEYS: readonly AptKey[] = [
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
];
export const GRADES: readonly Grade[] = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];

export const STAT_LABEL: Record<StatKey, string> = {
  spd: 'Speed',
  sta: 'Stamina',
  pow: 'Power',
  gut: 'Guts',
  wit: 'Wit',
};
export const STAT_SHORT: Record<StatKey, string> = {
  spd: 'Spd',
  sta: 'Sta',
  pow: 'Pow',
  gut: 'Gut',
  wit: 'Wit',
};
export const APT_LABEL: Record<AptKey, string> = {
  turf: 'Turf',
  dirt: 'Dirt',
  sprint: 'Sprint',
  mile: 'Mile',
  medium: 'Medium',
  long: 'Long',
  front: 'Front',
  pace: 'Pace',
  late: 'Late',
  end: 'End',
};
export const APT_GROUPS: readonly { label: string; keys: readonly AptKey[] }[] = [
  { label: 'Track', keys: ['turf', 'dirt'] },
  { label: 'Distance', keys: ['sprint', 'mile', 'medium', 'long'] },
  { label: 'Style', keys: ['front', 'pace', 'late', 'end'] },
];

export const gradeOrdinal = (g: Grade): number => GRADES.indexOf(g);

/** 50 §9 / 70 §3 F08 acceptance band for the 80% holdout interval coverage. */
export const COVERAGE_BAND: readonly [number, number] = [0.72, 0.88];
/** 10 §2: "low data" when n < 10 (a display rule from the approved design). */
export const LOW_DATA_N = 10;
