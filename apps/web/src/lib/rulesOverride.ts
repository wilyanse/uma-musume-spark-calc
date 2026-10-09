/**
 * T15c (62 §Provenance contract, web-local): the BROWSER-LOCAL rules override and the local
 * overridden-model envelope. Not a shared contract: nothing here is sent to the API, and an
 * overridden model is never stored through `POST /model-snapshots` (01 §13 has no rules
 * fingerprint, Q-141). Both records are versioned, mode-namespaced (`uma:<mode>:…`) and validated
 * on every read; a corrupt/unknown record is reported with a reason, never guessed.
 *
 * Writes are compare-and-swap on the exact stored string the caller last read, so a newer
 * revision written by another tab is never overwritten silently, and every write is read back so a
 * dropped or throwing write never claims durability.
 */
import { ModelSnapshot as SnapshotSchema } from '@uma/schema';
import type { ModelSnapshot } from '@uma/schema';
import type { ContextKind } from '../workers/engine.api.ts';
import type { KeyValueStore } from './storage.ts';
import { storageKey } from './storage.ts';

export type DataMode = 'api' | 'fixture';
export const OVERRIDE_SCHEMA = 'uma-browser-rules-override';
export const LOCAL_MODEL_SCHEMA = 'uma-browser-local-model';
const FP_RE = /^sha256:[0-9a-f]{64}$/;

export const overrideKey = (mode: DataMode) => storageKey(mode, 'rules-override');
export const localModelKey = (mode: DataMode) => storageKey(mode, 'rules-override-model');

/** The calibration report a proposal came from, and the exact context it was computed under. */
export interface OverrideSourceReport {
  id: string;
  generatedAt: string;
  multiplier: number;
  /** Identity of the context the report ran under (= the override's base). */
  contextFingerprint: string;
  /** The blueStatGain table in force when the report ran. */
  current: [number, number, number];
  rosterEtag: string | null;
  rosterIdentity: string;
}

export interface ActiveOverride {
  id: string;
  appliedAt: string;
  rule: 'blueStatGain';
  /** ABSOLUTE proposed star values (they replace the base table; never re-multiplied). */
  proposed: [number, number, number];
  verified: false;
  source: string;
  sourceReport: OverrideSourceReport;
  base: { contextKind: ContextKind; masterVersion: string; rulesVersion: string; fingerprint: string };
}

export interface OverrideEnvelope {
  schema: typeof OVERRIDE_SCHEMA;
  v: 1;
  mode: DataMode;
  /**
   * Monotonic per mode key; bumped by every successful write (apply or reset), including over an
   * invalid record whose revision is still readable. Restarts at 1 only after an unparseable one.
   */
  revision: number;
  active: ActiveOverride | null;
}

export type OverrideRead =
  | { status: 'none'; revision: number; raw: string | null }
  | { status: 'ok'; revision: number; active: ActiveOverride; raw: string }
  | { status: 'invalid'; reason: string; raw: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const triple = (v: unknown): v is [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function activeProblem(a: unknown): string | null {
  if (!isObj(a)) return 'active override is not an object';
  if (a.rule !== 'blueStatGain') return `unsupported rule ${String(a.rule)} (only blueStatGain proposals are supported)`;
  if (!triple(a.proposed)) return 'proposed values must be three numbers, finite and ≥ 0';
  if (a.verified !== false) return 'a browser-local override must stay verified:false';
  if (!str(a.id) || !str(a.appliedAt) || !str(a.source)) return 'missing id, appliedAt or source';
  const r = a.sourceReport;
  if (!isObj(r) || !str(r.id) || !str(r.generatedAt) || typeof r.multiplier !== 'number' || !Number.isFinite(r.multiplier) ||
    !triple(r.current) || !str(r.contextFingerprint) || !FP_RE.test(r.contextFingerprint) ||
    !(r.rosterEtag === null || typeof r.rosterEtag === 'string') || !str(r.rosterIdentity)) return 'source report provenance is missing or malformed';
  const b = a.base;
  if (!isObj(b) || (b.contextKind !== 'production' && b.contextKind !== 'golden-fixture') || !str(b.masterVersion) || !str(b.rulesVersion)) return 'base context is missing or malformed';
  if (!str(b.fingerprint) || !FP_RE.test(b.fingerprint)) return 'base context fingerprint is missing or not a sha256 identity';
  return null;
}

export function parseOverride(raw: string | null, mode: DataMode): OverrideRead {
  if (raw === null) return { status: 'none', revision: 0, raw: null };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'stored override is unreadable (not JSON)', raw };
  }
  if (!isObj(v)) return { status: 'invalid', reason: 'stored override is not an object', raw };
  if (v.schema !== OVERRIDE_SCHEMA) return { status: 'invalid', reason: `unknown schema ${String(v.schema)}`, raw };
  if (v.v !== 1) return { status: 'invalid', reason: `unsupported override record version ${String(v.v)}`, raw };
  if (v.mode !== mode) return { status: 'invalid', reason: `record belongs to data mode ${String(v.mode)}, not ${mode}`, raw };
  if (typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 0) return { status: 'invalid', reason: 'bad revision', raw };
  if (v.active === null) return { status: 'none', revision: v.revision, raw };
  const p = activeProblem(v.active);
  if (p) return { status: 'invalid', reason: p, raw };
  return { status: 'ok', revision: v.revision, active: v.active as ActiveOverride, raw };
}

/** Reads and validates; a throwing storage is an invalid (visible) state, not "no override". */
export function readOverride(store: KeyValueStore, mode: DataMode): OverrideRead {
  let raw: string | null;
  try {
    raw = store.getItem(overrideKey(mode));
  } catch (e) {
    return { status: 'invalid', reason: `browser storage could not be read: ${errText(e)}`, raw: '' };
  }
  return parseOverride(raw, mode);
}

/** Why a valid stored override cannot be used with the current base context (null = usable). */
export function checkOverrideFor(a: ActiveOverride, ctx: { kind: ContextKind; masterVersion: string }): string | null {
  if (a.base.contextKind !== ctx.kind) return `it was applied to the ${a.base.contextKind} context, but this app runs the ${ctx.kind} context`;
  if (a.base.masterVersion !== ctx.masterVersion) return `it was applied with master ${a.base.masterVersion}, but master ${ctx.masterVersion} is loaded`;
  return null;
}

export type WriteResult = { ok: true; revision: number; raw: string } | { ok: false; reason: string };

const errText = (e: unknown) => (e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e));

/**
 * Compare-and-swap write of the override state. `expectedRaw` is the exact stored string the
 * caller's decision was based on (null = nothing stored). Refuses when storage changed since.
 */
export function writeOverrideState(store: KeyValueStore, mode: DataMode, expectedRaw: string | null, active: ActiveOverride | null): WriteResult {
  const key = overrideKey(mode);
  let current: string | null;
  try {
    current = store.getItem(key);
  } catch (e) {
    return { ok: false, reason: `browser storage could not be read: ${errText(e)}` };
  }
  if (current !== expectedRaw) return { ok: false, reason: 'the rules override changed in another tab (or storage changed) since this was confirmed; nothing was written' };
  const prev = parseOverride(current, mode);
  const revision = (prev.status === 'invalid' ? recoverableRevision(current) : prev.revision) + 1;
  const env: OverrideEnvelope = { schema: OVERRIDE_SCHEMA, v: 1, mode, revision, active };
  const raw = JSON.stringify(env);
  try {
    store.setItem(key, raw);
  } catch (e) {
    return { ok: false, reason: `browser storage refused the write: ${errText(e)}` };
  }
  let back: string | null;
  try {
    back = store.getItem(key);
  } catch (e) {
    return { ok: false, reason: `browser storage could not be read back: ${errText(e)}` };
  }
  if (back !== raw) return { ok: false, reason: 'the write did not persist (storage read-back differs)' };
  return { ok: true, revision, raw };
}

/**
 * The revision of an INVALID stored record when it is still recoverable (a JSON object with a
 * non-negative integer `revision`), so overwriting it stays monotonic. 0 only when no revision can
 * be read at all (unparseable / unreadable storage), in which case the sequence restarts at 1:
 * compare-and-swap is on the exact stored string, so this affects the counter, not safety.
 */
export function recoverableRevision(raw: string | null): number {
  if (raw === null) return 0;
  try {
    const v: unknown = JSON.parse(raw);
    const r = isObj(v) ? v.revision : undefined;
    return typeof r === 'number' && Number.isSafeInteger(r) && r >= 0 ? r : 0;
  } catch {
    return 0;
  }
}

/** Raw restore used only to roll back a just-written value (best effort; reported by the caller). */
export function restoreRaw(store: KeyValueStore, key: string, raw: string | null): boolean {
  try {
    if (raw === null) store.removeItem(key);
    else store.setItem(key, raw);
    return store.getItem(key) === raw;
  } catch {
    return false;
  }
}

/** A model fitted under a browser-local override, stored ONLY in this browser (never POSTed). */
export interface LocalModelEnvelope {
  schema: typeof LOCAL_MODEL_SCHEMA;
  v: 1;
  mode: DataMode;
  overrideId: string;
  contextFingerprint: string;
  baseFingerprint: string;
  masterVersion: string;
  rosterEtag: string | null;
  rosterIdentity: string;
  snapshot: ModelSnapshot;
  savedAt: string;
}

export type LocalModelRead = { status: 'none' } | { status: 'ok'; env: LocalModelEnvelope } | { status: 'invalid'; reason: string };

/**
 * Structural check of the envelope and its snapshot. The authoritative `ModelSnapshot` schema
 * (zod) runs in the worker on every use (`rankPairs` → `prepareModel`), so a snapshot that passes
 * here but violates 01 §13 is still refused (refit) before it can rank.
 */
export function parseLocalModel(raw: string | null, mode: DataMode): LocalModelRead {
  if (raw === null) return { status: 'none' };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'stored local model is unreadable (not JSON)' };
  }
  if (!isObj(v) || v.schema !== LOCAL_MODEL_SCHEMA) return { status: 'invalid', reason: 'unknown local model record' };
  if (v.v !== 1) return { status: 'invalid', reason: `unsupported local model record version ${String(v.v)}` };
  if (v.mode !== mode) return { status: 'invalid', reason: `local model belongs to data mode ${String(v.mode)}, not ${mode}` };
  if (!str(v.overrideId) || !str(v.masterVersion) || !str(v.rosterIdentity) || !str(v.savedAt) || !(v.rosterEtag === null || typeof v.rosterEtag === 'string')) {
    return { status: 'invalid', reason: 'local model provenance is missing' };
  }
  if (!str(v.contextFingerprint) || !FP_RE.test(v.contextFingerprint) || !str(v.baseFingerprint) || !FP_RE.test(v.baseFingerprint)) {
    return { status: 'invalid', reason: 'local model context fingerprint is missing or not a sha256 identity' };
  }
  const s = v.snapshot;
  if (!isObj(s) || s.kind !== 'training-v2' || !str(s.id) || s.masterVersion !== v.masterVersion || !isObj(s.params)) {
    return { status: 'invalid', reason: 'local model snapshot is not a training-v2 snapshot for its master version' };
  }
  const parsed = SnapshotSchema.safeParse(s);
  if (!parsed.success) return { status: 'invalid', reason: `local model violates ModelSnapshot schema: ${parsed.error.message}` };
  return { status: 'ok', env: { ...v, snapshot: parsed.data } as unknown as LocalModelEnvelope };
}

export function readLocalModel(store: KeyValueStore, mode: DataMode): LocalModelRead {
  try {
    return parseLocalModel(store.getItem(localModelKey(mode)), mode);
  } catch (e) {
    return { status: 'invalid', reason: `browser storage could not be read: ${errText(e)}` };
  }
}

export interface LocalModelExpectation {
  overrideId: string;
  contextFingerprint: string;
  baseFingerprint: string;
  masterVersion: string;
  rosterEtag: string | null;
  rosterIdentity: string;
}

/** Why a stored local model cannot be reused for `want` (null = exact match). */
export function localModelMismatch(env: LocalModelEnvelope, want: LocalModelExpectation): string | null {
  if (env.overrideId !== want.overrideId) return 'it belongs to another override';
  if (env.baseFingerprint !== want.baseFingerprint) return 'its base context differs';
  if (env.contextFingerprint !== want.contextFingerprint) return 'it was fitted under another rules context';
  if (env.masterVersion !== want.masterVersion) return 'master data changed';
  if (env.rosterEtag !== want.rosterEtag || env.rosterIdentity !== want.rosterIdentity) return 'the roster changed';
  return null;
}

export function saveLocalModel(store: KeyValueStore, mode: DataMode, env: LocalModelEnvelope): { ok: true } | { ok: false; reason: string } {
  const key = localModelKey(mode);
  const raw = JSON.stringify(env);
  const checked = parseLocalModel(raw, mode);
  if (checked.status !== 'ok') return { ok: false, reason: checked.status === 'invalid' ? checked.reason : 'missing model' };
  try {
    store.setItem(key, raw);
    if (store.getItem(key) !== raw) return { ok: false, reason: 'the write did not persist (storage read-back differs)' };
  } catch (e) {
    return { ok: false, reason: `browser storage refused the model: ${errText(e)}` };
  }
  return { ok: true };
}

export function removeLocalModel(store: KeyValueStore, mode: DataMode): boolean {
  return restoreRaw(store, localModelKey(mode), null);
}
