import { z } from 'zod';
import {
  CaptureField,
  OWNED_CARDS_SYNC_RULES,
  ParentShape,
  veteranShape,
  checkVeteran,
} from './capture.ts';
import { CardId, Confidence, IsoUtc, NonEmpty, Ulid, Sha256Hex } from './primitives.ts';
import { ModeSource, TrainMode } from './enums.ts';

/** 01 §4 `PUT /api/v1/owned-cards` body. */
export const OwnedCardsSync = z.strictObject({
  schemaVersion: z.literal(1),
  capturedAt: IsoUtc,
  masterVersion: NonEmpty,
  /** From "Held N/255". */
  heldCount: z.number().int().min(0),
  cards: z
    .array(
      z.strictObject({
        cardId: CardId,
        lb: z.number().int().min(0).max(4),
        level: z.number().int().min(1),
        confidence: Confidence,
      }),
    )
    .superRefine((cards, ctx) => {
      const seen = new Set<string>();
      cards.forEach((c, i) => {
        if (seen.has(c.cardId)) {
          ctx.addIssue({
            code: 'custom',
            message: OWNED_CARDS_SYNC_RULES[0].message,
            path: [i, 'cardId'],
          });
        }
        seen.add(c.cardId);
      });
    }),
});
export type OwnedCardsSync = z.infer<typeof OwnedCardsSync>;

/** 01 §3 response: 201 `{created: true}` / 200 `{created: false}`; `reviewItemIds` when any field is low_confidence. */
export const IngestResponse = z.strictObject({
  veteranId: Ulid,
  created: z.boolean(),
  reviewItemIds: z.array(Ulid).optional(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

const rosterParent = z.strictObject({ ...ParentShape, matchedVeteranId: Ulid.nullable() });

/** 01 §9: the `veteran` object + `{id, fingerprint, modeSource, minConfidence, capturedAt}` + `parents[].matchedVeteranId`. */
export const RosterVeteran = z
  .strictObject({
    ...veteranShape,
    parents: z.array(rosterParent).length(2),
    id: Ulid,
    fingerprint: Sha256Hex,
    modeSource: ModeSource,
    minConfidence: Confidence,
    capturedAt: IsoUtc,
  })
  .superRefine(checkVeteran);
export type RosterVeteran = z.infer<typeof RosterVeteran>;

/** 01 §9 `GET /api/v1/veterans/:id`: RosterVeteran + `fields`. */
export const RosterVeteranDetail = z
  .strictObject({
    ...RosterVeteran.shape,
    fields: z.array(CaptureField),
  })
  .superRefine(checkVeteran);
export type RosterVeteranDetail = z.infer<typeof RosterVeteranDetail>;

/** 01 §9 `PATCH /api/v1/veterans/:id` body. */
export const VeteranPatch = z.strictObject({ trainMode: TrainMode.optional() });
export type VeteranPatch = z.infer<typeof VeteranPatch>;

export const ReviewStatus = z.enum(['open', 'resolved', 'dismissed']);

/** 01 §9 `GET /api/v1/review-items`: joined with the field and its crop key. */
export const ReviewItem = z.strictObject({
  id: Ulid,
  veteranId: Ulid,
  path: CaptureField.shape.path,
  status: ReviewStatus,
  resolvedValue: z.unknown(),
  createdAt: IsoUtc,
  resolvedAt: IsoUtc.nullable(),
  field: CaptureField,
  /** Same as `field.cropKey`, surfaced for convenience. */
  cropKey: z.string().nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

/** 01 §9 `POST /api/v1/review-items/:id/resolve` body. */
export const ResolveReviewRequest = z.strictObject({ value: z.unknown() });
export type ResolveReviewRequest = z.infer<typeof ResolveReviewRequest>;

/** 01 §9 `GET /api/v1/health`. */
export const HealthResponse = z.strictObject({
  ok: z.boolean(),
  masterVersion: NonEmpty,
  dbSchemaVersion: z.union([z.string(), z.number()]),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
