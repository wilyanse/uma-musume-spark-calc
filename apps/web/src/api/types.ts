/**
 * The web app's data access, typed with `@uma/schema` (types only) against the routes as T04/T04b
 * actually implement them (apps/api/src/routes/*), not the older design bindings:
 * - `GET /owned-cards` returns an ARRAY of rows with a per-row `syncedAt` (no `heldCount`, Q-71);
 * - `GET /cm-targets` returns plain `CmTarget[]` without timestamps (Q-72);
 * - `GET /model-snapshots?kind=` returns the latest one or 404 when none exists;
 * - there is no dismiss endpoint for review items (Q-70).
 */
import type {
  CmTarget,
  HealthResponse,
  ModelSnapshot,
  ModelSnapshotKind,
  ReviewItem,
  RosterVeteran,
  RosterVeteranDetail,
  TrainMode,
} from '@uma/schema';

/** `GET /api/v1/owned-cards` row (apps/api/src/routes/owned-cards.ts). */
export interface OwnedCardRow {
  cardId: string;
  lb: number;
  level: number;
  confidence: number;
  syncedAt: string;
}

/** POST/PUT body: the server owns `id` (apps/api/src/routes/cm-targets.ts `CmTargetInput`). */
export type CmTargetInput = Omit<CmTarget, 'id'> & { id?: string };

export interface RosterResult {
  /** `ETag` of the response (null when the source has none). */
  etag: string | null;
  roster: RosterVeteran[];
  /** True when the server answered 304 and `roster` is the cached copy. */
  notModified: boolean;
}

export interface DataSource {
  readonly kind: 'api' | 'fixture';
  health(): Promise<HealthResponse>;
  /** `GET /roster` with `If-None-Match` when `cached` is given (01 §9, 60 §3). */
  roster(cached?: { etag: string; roster: RosterVeteran[] }): Promise<RosterResult>;
  veteran(id: string): Promise<RosterVeteranDetail>;
  patchVeteran(id: string, body: { trainMode: TrainMode }): Promise<RosterVeteranDetail>;
  deleteVeteran(id: string): Promise<void>;
  reviewItems(status: 'open' | 'resolved'): Promise<ReviewItem[]>;
  resolveReviewItem(id: string, value: unknown): Promise<ReviewItem>;
  /** URL of a stored crop, or null when the source has none. */
  cropUrl(cropKey: string): string | null;
  ownedCards(): Promise<OwnedCardRow[]>;
  targets(): Promise<CmTarget[]>;
  createTarget(input: CmTargetInput): Promise<CmTarget>;
  updateTarget(id: string, input: CmTargetInput): Promise<CmTarget>;
  deleteTarget(id: string): Promise<void>;
  /** Latest snapshot (of `kind` when given), or null on 404. */
  latestSnapshot(kind?: ModelSnapshotKind): Promise<ModelSnapshot | null>;
  storeSnapshot(snapshot: ModelSnapshot): Promise<ModelSnapshot>;
}
