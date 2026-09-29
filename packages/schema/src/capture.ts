import { z } from 'zod';
import {
  APT_KEYS,
  AptKey,
  FieldStatus,
  Grade,
  SparkOwner,
  SparkType,
  STAT_KEYS,
  TrainMode,
} from './enums.ts';
import {
  CardId,
  CharacterId,
  Confidence,
  DateOnly,
  IsoUtc,
  NonEmpty,
  OutfitId,
  ScenarioId,
  Sha256Hex,
  SkillId,
  SparkId,
  Ulid,
} from './primitives.ts';

const stat = z.number().int().min(1).max(2000);

export const Stats = z.strictObject({
  spd: stat,
  sta: stat,
  pow: stat,
  gut: stat,
  wit: stat,
});

/** Exactly the 10 aptitudes (01 §3). */
export const Aptitudes = z.strictObject(
  Object.fromEntries(APT_KEYS.map((k) => [k, Grade])) as Record<AptKey, typeof Grade>,
);

export const VeteranSkill = z.strictObject({
  skillId: SkillId,
  /** Only unique skills carry a level. */
  level: z.number().int().min(1).nullable(),
});

export const VeteranSpark = z.strictObject({
  owner: SparkOwner,
  sparkId: SparkId,
  type: SparkType,
  stars: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const DeckSlot = z.strictObject({
  slot: z.number().int().min(1).max(6),
  cardId: CardId,
  lb: z.number().int().min(0).max(4),
  level: z.number().int().min(1),
  borrowed: z.boolean(),
});

export const ParentShape = {
  slot: z.union([z.literal(1), z.literal(2)]),
  characterId: CharacterId,
  outfitId: OutfitId.nullable(),
  isGuest: z.boolean(),
  guestTrainer: z.string().nullable(),
};
export const Parent = z.strictObject(ParentShape);

export const Career = z.strictObject({
  races: z.number().int().min(0),
  wins: z.number().int().min(0),
  fans: z.number().int().min(0).nullable(),
  dateAcquired: DateOnly,
});

/** Field shapes of the `veteran` object (01 §3), reusable by RosterVeteran (01 §9). */
export const veteranShape = {
  characterId: CharacterId,
  outfitId: OutfitId,
  rank: NonEmpty,
  rating: z.number().int().min(0),
  epithet: z.string(),
  trainMode: TrainMode,
  stats: Stats,
  aptitudes: Aptitudes,
  skills: z.array(VeteranSkill),
  sparks: z.array(VeteranSpark),
  deck: z.array(DeckSlot).length(6),
  parents: z.array(Parent).length(2),
  scenarioId: ScenarioId,
  career: Career,
};

type VeteranLike = {
  characterId: string;
  sparks: { owner: string; sparkId: string; type: string }[];
  deck: { slot: number }[];
  parents: { slot: number; characterId: string }[];
};

/** Validation messages are part of the contract: tests and the API assert on them. */
export const RULE = {
  deckSlots: 'deck slots must be exactly 1..6, each once',
  parentSlots: 'parent slots must be exactly 1 and 2, each once',
  parentsDiffer: 'the two parents must be different characters',
  parentNotSelf: 'a parent must not be the same character as the veteran',
  sparkDuplicate: 'the same spark appears twice for one owner',
  sparkShape: 'spark shape violated: exactly one blue, one pink and at most one green per owner',
  selfSparks: 'self sparks are required: exactly one blue and one pink',
  parentSparksUnreadable:
    'a parent owner with no sparks needs a low_confidence field whose path starts with "/sparks"',
} as const;

const SPARK_OWNERS = SparkOwner.options;

/** Cross-field rules on the `veteran` object (01 §3 Validation). Shared with RosterVeteran. */
export function checkVeteran(v: VeteranLike, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: 'custom', message, path });

  const deckSlots = v.deck.map((d) => d.slot).sort((a, b) => a - b);
  if (deckSlots.join() !== '1,2,3,4,5,6') issue(RULE.deckSlots, ['deck']);

  const parentSlots = v.parents.map((p) => p.slot).sort((a, b) => a - b);
  if (parentSlots.join() !== '1,2') issue(RULE.parentSlots, ['parents']);

  const [p1, p2] = v.parents;
  if (p1 && p2 && p1.characterId === p2.characterId) issue(RULE.parentsDiffer, ['parents']);
  v.parents.forEach((p, i) => {
    if (p.characterId === v.characterId) issue(RULE.parentNotSelf, ['parents', i, 'characterId']);
  });

  const seen = new Set<string>();
  v.sparks.forEach((s, i) => {
    const key = `${s.owner}|${s.sparkId}`;
    if (seen.has(key)) issue(RULE.sparkDuplicate, ['sparks', i]);
    seen.add(key);
  });

  for (const owner of SPARK_OWNERS) {
    const own = v.sparks.filter((s) => s.owner === owner);
    if (own.length === 0) {
      if (owner === 'self') issue(RULE.selfSparks, ['sparks']);
      continue; // parent owners may be unread; the capture-level rule requires a flag.
    }
    const count = (t: string) => own.filter((s) => s.type === t).length;
    if (count('blue') !== 1 || count('pink') !== 1 || count('green') > 1) {
      issue(`${RULE.sparkShape} (owner ${owner})`, ['sparks']);
    }
  }
}

export const Veteran = z.strictObject(veteranShape).superRefine(checkVeteran);
export type Veteran = z.infer<typeof Veteran>;

export const CaptureField = z.strictObject({
  /** JSON pointer into `veteran`, e.g. "/stats/spd", "/sparks/3/stars". */
  path: z.string().regex(/^(\/[^/]+)+$/, 'expected a non-empty JSON pointer such as "/stats/spd"'),
  rawText: z.string().nullable(),
  value: z.unknown(),
  confidence: Confidence,
  status: FieldStatus,
  /** Top 3, for text matched to vocab. */
  candidates: z.array(z.strictObject({ value: z.unknown(), score: z.number() })).max(3),
  /** R2 key if a crop was uploaded (01 §8). */
  cropKey: z.string().nullable(),
});
export type CaptureField = z.infer<typeof CaptureField>;

export const VeteranCapture = z
  .strictObject({
    schemaVersion: z.literal(1),
    captureId: Ulid,
    capturedAt: IsoUtc,
    agentVersion: NonEmpty,
    layoutVersion: NonEmpty,
    masterVersion: NonEmpty,
    /** sha256 hex, see fingerprint.ts (01 §5). */
    fingerprint: Sha256Hex,
    veteran: Veteran,
    fields: z.array(CaptureField),
  })
  .superRefine((capture, ctx) => {
    const flagged = capture.fields.some(
      (f) => f.status === 'low_confidence' && f.path.startsWith('/sparks'),
    );
    for (const owner of SPARK_OWNERS) {
      if (owner === 'self') continue;
      const has = capture.veteran.sparks.some((s) => s.owner === owner);
      if (!has && !flagged) {
        ctx.addIssue({
          code: 'custom',
          message: `${RULE.parentSparksUnreadable} (owner ${owner})`,
          path: ['fields'],
        });
      }
    }
  });
export type VeteranCapture = z.infer<typeof VeteranCapture>;

export { STAT_KEYS };
