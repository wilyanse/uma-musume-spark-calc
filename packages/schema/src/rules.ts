import { z } from 'zod';
import { NonEmpty } from './primitives.ts';

/** Every constant carries provenance (01 §12, AGENTS: never guess game facts). */
const sourced = { verified: z.boolean(), source: z.string() };

/** `{"1": x, "2": x, "3": x, verified, source}`: a value per spark star count. */
export const StarTable = z.strictObject({
  '1': z.number(),
  '2': z.number(),
  '3': z.number(),
  ...sourced,
});
export type StarTable = z.infer<typeof StarTable>;

/** Free-form table with provenance; the spec leaves the inner keys open (01 §12 "{…}"). */
const OpenTable = z.looseObject({ ...sourced });

export const Rules = z.strictObject({
  version: NonEmpty,
  activation: z.strictObject({
    blue: StarTable,
    pink: StarTable,
    green: StarTable,
    white: StarTable,
  }),
  affinityMultiplier: z.strictObject({ formula: NonEmpty, ...sourced }),
  grandparentWeight: z.strictObject({ value: z.number(), ...sourced }),
  blueStatGain: StarTable,
  blueInitialBonus: StarTable,
  pinkGradeGain: StarTable,
  whiteHintLevels: StarTable,
  raceSparkStatGain: OpenTable,
  scenarioSparkEffects: OpenTable,
});
export type Rules = z.infer<typeof Rules>;
