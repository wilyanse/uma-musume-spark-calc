/**
 * Engine session: configures the worker with the loaded master data, the right context and (T15c)
 * the validated browser-local rules override, and runs the fit-or-reuse model flow shared by S06
 * and S07 (60 §3).
 *
 * T15c invariants (62):
 * - The engine-context query is keyed by the EXACT stored override string, so any apply/reset in
 *   this or another tab reconfigures the worker; the worker reports the effective context identity.
 * - Base-context models may use the existing server snapshot store (record v2 binds the snapshot
 *   to the effective identity + roster ETag/content). Under an override, the server is never read
 *   for a model and NEVER written: the model lives in a browser-local envelope, refitted whenever
 *   it is missing or its provenance differs.
 * - The stored override is re-read before fitting and before any write; a change means the
 *   context this flow was started with is stale, so it stops instead of writing.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelSnapshot, RosterVeteran } from '@uma/schema';
import { useServices, type AppServices } from './services.ts';
import { qk, useMaster } from './queries.ts';
import type { ContextInfo, EngineErrorInfo, FitOutput, SnapshotProvenance } from '../workers/engine.api.ts';
import type { MasterData } from '../master/load.ts';
import { decideModel, loadFitRecord, saveFitRecord, type FitReason } from '../lib/model.ts';
import { errorText } from '../api/errors.ts';
import { withRulesLock } from './rulesLock.ts';
import { digestOf } from '../lib/digest.ts';
import { useMemo } from 'react';
import {
  checkOverrideFor,
  localModelMismatch,
  parseOverride,
  readLocalModel,
  saveLocalModel,
  type ActiveOverride,
  type LocalModelEnvelope,
} from '../lib/rulesOverride.ts';
import { storedOverrideRaw, UNREADABLE, useStoredOverrideRaw } from './rulesSession.ts';

export class EngineFailure extends Error {
  override name = 'EngineFailure';
  constructor(readonly info: EngineErrorInfo) {
    super(info.message);
  }
}

export const contextKindFor = (s: AppServices) => (s.source.kind === 'fixture' && s.loadGolden ? 'golden-fixture' : 'production');

/** The configured worker context plus the browser-local override state it was configured from. */
export interface EngineContextState extends ContextInfo {
  /** The exact stored override string this context was configured from (null = none stored). */
  storedRaw: string | null;
  /** Stored record revision (0 when none / invalid). */
  storedRevision: number;
  /** The valid stored override record in force, or null. */
  storedOverride: ActiveOverride | null;
  /** Why a stored override is NOT in force (corrupt, wrong mode/master/context, refused by the worker). */
  overrideProblem: string | null;
}

/**
 * `enabled: false` lets an observer (the shell footer) share the SAME query without starting it:
 * every observer of a key shares one query, so this never configures the worker a second time.
 */
export function useEngineContext(enabled = true) {
  const services = useServices();
  const master = useMaster();
  const kind = contextKindFor(services);
  const raw = useStoredOverrideRaw(services);
  const masterIdentity = useMemo(() => master.data ? digestOf(master.data.bundle) : null, [master.data]);
  return useQuery<EngineContextState>({
    queryKey: ['engine-context', master.data?.version, masterIdentity, kind, raw],
    enabled: enabled && !!master.data,
    staleTime: Infinity,
    // The worker holds ONE context: an inactive key must never be served from cache later (e.g. a
    // stored string seen again after a rollback) without reconfiguring the worker.
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const m = master.data as MasterData;
      const golden = kind === 'golden-fixture' ? await services.loadGolden!() : undefined;
      const parsed = raw === UNREADABLE ? ({ status: 'invalid', reason: 'browser storage could not be read', raw } as const) : parseOverride(raw, services.source.kind);
      let problem: string | null = parsed.status === 'invalid' ? `the stored rules override is invalid (${parsed.reason}) and was not applied` : null;
      let active: ActiveOverride | null = null;
      if (parsed.status === 'ok') {
        const why = checkOverrideFor(parsed.active, { kind, masterVersion: m.version });
        if (why) problem = `the stored rules override was not applied: ${why}`;
        else active = parsed.active;
      }
      const r = await services.engine.configure({
        bundle: m.bundle,
        kind,
        ...(golden ? { golden } : {}),
        override: active
          ? { id: active.id, rule: 'blueStatGain', proposed: [...active.proposed], baseFingerprint: active.base.fingerprint, sourceReportId: active.sourceReport.id, multiplier: active.sourceReport.multiplier }
          : null,
      });
      if (!r.ok) throw new EngineFailure(r.error);
      if (active && r.value.overrideRejected) problem = `the stored rules override was not applied: ${r.value.overrideRejected}`;
      return {
        ...r.value,
        storedRaw: raw,
        storedRevision: parsed.status === 'invalid' ? 0 : parsed.revision,
        storedOverride: r.value.override ? active : null,
        overrideProblem: problem,
      };
    },
  });
}

/** The transient result of the last fit in this tab (never persisted; S07 charts use it). */
export const FIT_SUMMARY_KEY = ['fit-summary'] as const;
export interface SessionFit {
  output: FitOutput;
  reason: FitReason;
  at: string;
}

export type ModelOutcome =
  | {
      status: 'ready';
      snapshot: ModelSnapshot;
      /** The context identity the snapshot was fitted under (sent with every rank). */
      provenance: SnapshotProvenance;
      /** True when the model is browser-local (fitted under the override; never on the server). */
      local: boolean;
      fitted: SessionFit | null;
      legacy: ModelSnapshot | null;
      storeError: string | null;
    }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; engine?: EngineErrorInfo };

export const STALE_RULES_MESSAGE =
  'The rules override changed (in this or another tab) while this was running, so the result was discarded. The context is being reloaded; try again.';

/**
 * Fit-or-reuse. `onFitStart` lets the UI show "fitting…" before the (cancellable) worker job runs.
 * `force` refits regardless (S07 "Refit model", or a corrupt snapshot).
 */
export async function ensureModel(
  // Only what fit-or-reuse uses (it generates no client ids, so no injected randomness).
  services: Omit<AppServices, 'random'>,
  qc: ReturnType<typeof useQueryClient>,
  args: {
    roster: RosterVeteran[];
    rosterEtag: string | null;
    rosterIdentity: string;
    masterVersion: string;
    ctx: EngineContextState;
    force?: FitReason;
    onFitStart?: (reason: FitReason, cancel: () => void) => void;
    isCurrent?: () => boolean;
  },
): Promise<ModelOutcome> {
  const { source, store, engine, now } = services;
  const ctx = args.ctx;
  const fresh = () => storedOverrideRaw(services) === ctx.storedRaw;
  const live = () => !args.isCurrent || args.isCurrent();
  if (!fresh()) return { status: 'error', message: STALE_RULES_MESSAGE };
  const mode = source.kind;

  if (ctx.override) {
    // Browser-local override in force: the server snapshot store is never read or written.
    const want = {
      overrideId: ctx.override.id,
      contextFingerprint: ctx.fingerprint,
      baseFingerprint: ctx.baseFingerprint,
      masterVersion: args.masterVersion,
      rosterEtag: args.rosterEtag,
      rosterIdentity: args.rosterIdentity,
    };
    let reason: FitReason = args.force ?? 'no-snapshot';
    if (!args.force) {
      const env = readLocalModel(store, mode);
      if (env.status === 'ok') {
        const why = localModelMismatch(env.env, want);
        if (!why) return { status: 'ready', snapshot: env.env.snapshot, provenance: { contextFingerprint: env.env.contextFingerprint }, local: true, fitted: null, legacy: null, storeError: null };
        reason = why === 'the roster changed' ? 'roster-changed' : why === 'master data changed' ? 'master-changed' : 'context-changed';
      } else if (env.status === 'invalid') reason = 'corrupt';
    }
    const job = engine.fit(args.roster, { nowIso: now().toISOString() });
    args.onFitStart?.(reason, job.cancel);
    const outcome = await job.promise;
    if (outcome.status === 'cancelled' || outcome.status === 'superseded') return { status: 'cancelled' };
    if (outcome.status === 'crashed') return { status: 'error', message: `The engine worker stopped: ${outcome.message}` };
    if (!outcome.result.ok) return { status: 'error', message: outcome.result.error.message, engine: outcome.result.error };
    if (!live()) return { status: 'cancelled' };
    const out = outcome.result.value;
    if (!fresh() || out.contextFingerprint !== ctx.fingerprint || !out.overridden) return { status: 'error', message: STALE_RULES_MESSAGE };
    const fitted: SessionFit = { output: out, reason, at: now().toISOString() };
    qc.setQueryData(FIT_SUMMARY_KEY, fitted);
    const env: LocalModelEnvelope = { schema: 'uma-browser-local-model', v: 1, mode, ...want, snapshot: out.snapshot, savedAt: now().toISOString() };
    let saved: { ok: true } | { ok: false; reason: string };
    try {
      saved = await withRulesLock(store, mode, () => {
        if (!live() || !fresh()) return { ok: false as const, reason: STALE_RULES_MESSAGE };
        return saveLocalModel(store, mode, env);
      });
    } catch (e) {
      saved = { ok: false, reason: errorText(e) };
    }
    if (!live() || !fresh()) return { status: 'cancelled' };
    void qc.invalidateQueries({ queryKey: ['local-model'] });
    return {
      status: 'ready',
      snapshot: out.snapshot,
      provenance: { contextFingerprint: out.contextFingerprint },
      local: true,
      fitted,
      legacy: null,
      storeError: saved.ok ? null : `The model was fitted for the browser-local override but couldn't be kept in this browser (${saved.reason}); it is used for this tab only and will be refitted next time.`,
    };
  }

  let v2: ModelSnapshot | null;
  let anyLatest: ModelSnapshot | null;
  try {
    [v2, anyLatest] = await Promise.all([source.latestSnapshot('training-v2'), source.latestSnapshot()]);
  } catch (e) {
    return { status: 'error', message: `Couldn't load the model snapshot. ${errorText(e)}` };
  }
  if (!live()) return { status: 'cancelled' };
  if (!fresh()) return { status: 'error', message: STALE_RULES_MESSAGE };
  const decision = args.force
    ? ({ action: 'fit', reason: args.force, legacy: anyLatest?.kind === 'training-v1' ? anyLatest : null } as const)
    : decideModel({
        v2,
        anyLatest,
        rosterEtag: args.rosterEtag,
        rosterIdentity: args.rosterIdentity,
        masterVersion: args.masterVersion,
        context: ctx.kind,
        contextFingerprint: ctx.fingerprint,
        record: loadFitRecord(store, mode),
      });
  if (decision.action === 'use') {
    return { status: 'ready', snapshot: decision.snapshot, provenance: { contextFingerprint: ctx.fingerprint }, local: false, fitted: null, legacy: null, storeError: null };
  }
  const job = engine.fit(args.roster, { nowIso: now().toISOString() });
  args.onFitStart?.(decision.reason, job.cancel);
  const outcome = await job.promise;
  if (outcome.status === 'cancelled' || outcome.status === 'superseded') return { status: 'cancelled' };
  if (outcome.status === 'crashed') return { status: 'error', message: `The engine worker stopped: ${outcome.message}` };
  if (!outcome.result.ok) return { status: 'error', message: outcome.result.error.message, engine: outcome.result.error };
  if (!live()) return { status: 'cancelled' };
  const out = outcome.result.value;
  // Never POST a model whose context is not exactly this base context (e.g. the worker was
  // reconfigured with an override meanwhile): the snapshot API has no rules fingerprint (Q-141).
  if (!fresh() || out.overridden || out.contextFingerprint !== ctx.fingerprint) return { status: 'error', message: STALE_RULES_MESSAGE };
  const fitted: SessionFit = { output: out, reason: decision.reason, at: now().toISOString() };
  qc.setQueryData(FIT_SUMMARY_KEY, fitted);
  let storeError: string | null = null;
  try {
    await source.storeSnapshot(out.snapshot);
    saveFitRecord(store, mode, {
      v: 2,
      snapshotId: out.snapshot.id,
      rosterEtag: args.rosterEtag,
      rosterIdentity: args.rosterIdentity,
      masterVersion: args.masterVersion,
      context: ctx.kind,
      contextFingerprint: out.contextFingerprint,
    });
  } catch (e) {
    storeError = `The model was fitted but couldn't be stored: ${errorText(e)}`;
  }
  void qc.invalidateQueries({ queryKey: ['model-snapshot'] });
  return { status: 'ready', snapshot: out.snapshot, provenance: { contextFingerprint: out.contextFingerprint }, local: false, fitted, legacy: decision.legacy, storeError };
}

export function useSessionFit(): SessionFit | undefined {
  const qc = useQueryClient();
  return useQuery<SessionFit | null>({
    queryKey: FIT_SUMMARY_KEY,
    queryFn: () => qc.getQueryData<SessionFit>(FIT_SUMMARY_KEY) ?? null,
    staleTime: Infinity,
  }).data ?? undefined;
}

export function useLatestSnapshot(enabled = true) {
  const { source } = useServices();
  return useQuery({ queryKey: qk.snapshot('latest'), queryFn: () => source.latestSnapshot(), enabled });
}

/** T15c: the browser-local model envelope (read from storage; never fetched from the server). */
export function useLocalModel(enabled: boolean) {
  const services = useServices();
  return useQuery({
    queryKey: ['local-model', services.source.kind],
    enabled,
    staleTime: Infinity,
    queryFn: () => readLocalModel(services.store, services.source.kind),
  });
}
