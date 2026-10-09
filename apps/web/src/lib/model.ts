/**
 * When to fit vs reuse the model (60 §3 + ADR-0002), as a pure decision.
 *
 * Fit when no `training-v2` snapshot exists, the roster ETag or the master version changed since
 * that snapshot was fitted, or this browser has no record of what it was fitted on (the snapshot
 * carries no roster ETag or rules version, Q-141, so an unknown provenance is treated as stale).
 * A legacy `training-v1` snapshot is never reused or relabelled: it is reported and a v2 fit runs.
 *
 * T15c: the record (v2) also binds the snapshot to the EFFECTIVE context identity (SHA-256 of the
 * exact rules/master/synthetic inputs) and the roster content digest. A pre-T15c record has no
 * identity, so it reads as unknown provenance and forces a refit (never guessed from rules.version).
 * This record is only ever written for base-context fits stored through the API; models fitted
 * under a browser-local override live in their own local envelope (lib/rulesOverride.ts).
 *
 * T17 (ADR-0003): record v3 also binds the snapshot to the engine's training-ELIGIBILITY policy.
 * A v2 record (written before T17) reads with `eligibilityPolicy: null`, which never matches, so a
 * model fitted on the old (raw 0.9 score) population is refitted exactly once even when the roster
 * ETag, content, master and rules context are unchanged. Snapshot kinds are never relabelled.
 */
import type { ModelSnapshot } from '@uma/schema';
import { STAT_KEYS } from './keys.ts';
import { readJson, storageKey, writeJson, type KeyValueStore } from './storage.ts';

/** Display-only guard: the worker remains authoritative for full schema/covariance validation. */
export function isReadableSnapshot(v: unknown): v is ModelSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as ModelSnapshot;
  const p = s.params;
  return typeof s.id === 'string' && typeof s.masterVersion === 'string' && typeof s.trainedAt === 'string' &&
    Number.isInteger(s.nSamples) && s.nSamples >= 0 &&
    (s.kind === 'training-v1' || s.kind === 'training-v2') && !!p && !!p.holdout && !!p.holdout.mae &&
    Number.isFinite(p.holdout.coverage80) && STAT_KEYS.every((k) => Number.isFinite(p.holdout.mae[k]) &&
      !!p.perStat?.[k] && Number.isFinite(p.perStat[k].sigma));
}

export interface FitRecord {
  v: 3;
  snapshotId: string;
  rosterEtag: string | null;
  /** Roster content digest (lib/calibration.ts `rosterIdentity`). */
  rosterIdentity: string;
  masterVersion: string;
  /** Engine context the fit used ('production' or the fixture-only 'golden-fixture'). */
  context: string;
  /** Effective context identity the worker reported for this fit. */
  contextFingerprint: string;
  /** T17: training-eligibility policy of the fit; null = a pre-T17 record (old policy, unknown). */
  eligibilityPolicy: string | null;
}

/** v2 (pre-T17) and v3 records share every field except the eligibility policy. */
const isRecord = (v: unknown): v is Omit<FitRecord, 'v' | 'eligibilityPolicy'> & { v: 2 | 3; eligibilityPolicy?: unknown } => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r.v === 3 ? typeof r.eligibilityPolicy !== 'string' || r.eligibilityPolicy === '' : r.v !== 2) return false;
  return (
    typeof r.snapshotId === 'string' &&
    (r.rosterEtag === null || typeof r.rosterEtag === 'string') &&
    typeof r.rosterIdentity === 'string' &&
    typeof r.masterVersion === 'string' &&
    typeof r.context === 'string' &&
    typeof r.contextFingerprint === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(r.contextFingerprint)
  );
};

export const fitRecordKey = (mode: 'api' | 'fixture') => storageKey(mode, 'model-fit');
export function loadFitRecord(s: KeyValueStore, mode: 'api' | 'fixture'): FitRecord | null {
  const r = readJson<unknown>(s, fitRecordKey(mode), (v): v is unknown => v === null || isRecord(v), null);
  if (!r || !isRecord(r)) return null;
  // A v2 record predates the policy: normalise to v3 with an UNKNOWN (null) policy, never a guess.
  return { ...r, v: 3, eligibilityPolicy: r.v === 3 ? (r.eligibilityPolicy as string) : null };
}
export const saveFitRecord = (s: KeyValueStore, mode: 'api' | 'fixture', r: FitRecord) =>
  writeJson(s, fitRecordKey(mode), r);

export type FitReason =
  | 'no-snapshot'
  | 'legacy-only'
  | 'roster-changed'
  | 'master-changed'
  | 'context-changed'
  | 'eligibility-changed'
  | 'unknown-provenance'
  | 'corrupt'
  | 'requested';

export const FIT_REASON_TEXT: Record<FitReason, string> = {
  'no-snapshot': 'no model has been fitted yet',
  'legacy-only': 'only a legacy training-v1 snapshot exists (pre-ADR-0002, refit required)',
  'roster-changed': 'the roster changed since the last fit',
  'master-changed': 'master data changed since the last fit',
  'context-changed': 'the rules context changed since the last fit',
  'eligibility-changed': 'the training eligibility policy changed since the last fit (accepted/corrected captures now count; ADR-0003)',
  'unknown-provenance': "this browser can't prove which roster and rules context the stored snapshot was fitted on",
  corrupt: 'the stored snapshot is corrupt',
  requested: 'you asked for a refit',
};

export type ModelDecision =
  | { action: 'use'; snapshot: ModelSnapshot }
  | { action: 'fit'; reason: FitReason; legacy: ModelSnapshot | null };

export function decideModel(input: {
  v2: ModelSnapshot | null;
  /** Latest snapshot of any kind (to notice a legacy one). */
  anyLatest: ModelSnapshot | null;
  rosterEtag: string | null;
  rosterIdentity: string;
  masterVersion: string;
  context: string;
  contextFingerprint: string;
  /** T17: the worker's training-eligibility policy (ContextInfo.eligibilityPolicy). */
  eligibilityPolicy: string;
  record: FitRecord | null;
}): ModelDecision {
  const legacy = input.anyLatest?.kind === 'training-v1' ? input.anyLatest : null;
  const s = input.v2;
  if (!s) return { action: 'fit', reason: legacy ? 'legacy-only' : 'no-snapshot', legacy };
  if (s.masterVersion !== input.masterVersion) return { action: 'fit', reason: 'master-changed', legacy };
  const r = input.record;
  if (!r || r.snapshotId !== s.id) return { action: 'fit', reason: 'unknown-provenance', legacy };
  if (r.eligibilityPolicy !== input.eligibilityPolicy) return { action: 'fit', reason: 'eligibility-changed', legacy };
  if (r.context !== input.context || r.contextFingerprint !== input.contextFingerprint) return { action: 'fit', reason: 'context-changed', legacy };
  if (r.masterVersion !== input.masterVersion) return { action: 'fit', reason: 'master-changed', legacy };
  if (r.rosterEtag !== input.rosterEtag || r.rosterIdentity !== input.rosterIdentity) return { action: 'fit', reason: 'roster-changed', legacy };
  return { action: 'use', snapshot: s };
}
