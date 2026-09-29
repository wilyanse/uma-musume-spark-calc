import { z } from 'zod';
import { AptKey, Grade, StatKey } from './enums.ts';
import { NonEmpty, SkillId, Ulid } from './primitives.ts';

const partial = <K extends string>(keys: z.ZodEnum<{ [k in K]: k }>, value: z.ZodType) =>
  z.partialRecord(keys, value);

/** 01 §10. */
export const CmTarget = z.strictObject({
  id: Ulid,
  name: NonEmpty,
  course: z.strictObject({
    surface: z.enum(['turf', 'dirt']),
    distance: z.enum(['sprint', 'mile', 'medium', 'long']),
    meters: z.number().int().min(1).optional(),
    notes: z.string().optional(),
  }),
  style: z.enum(['front', 'pace', 'late', 'end']),
  minStats: partial(StatKey, z.number().int().min(1).max(2000)),
  minAptitudes: partial(AptKey, Grade),
  /** Skill IDs, all required. */
  requiredSkills: z.array(SkillId),
  /** Secondary sort. */
  optionalSkills: z.array(z.strictObject({ skillId: SkillId, weight: z.number() })),
  /** Secondary sort, default 1. */
  statWeights: partial(StatKey, z.number()).optional(),
});
export type CmTarget = z.infer<typeof CmTarget>;
