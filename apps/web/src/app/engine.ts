/**
 * Engine session: configures the worker with the loaded master data and the right context, and
 * runs the fit-or-reuse model flow shared by S06 and S07 (60 §3).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelSnapshot, RosterVeteran } from '@uma/schema';
import { useServices, type AppServices } from './services.ts';
import { qk, useMaster } from './queries.ts';
import type { ContextInfo, EngineErrorInfo, FitOutput } from '../workers/engine.api.ts';
import type { MasterData } from '../master/load.ts';
import { decideModel, loadFitRecord, saveFitRecord, type FitReason } from '../lib/model.ts';
import { errorText } from '../api/errors.ts';

export class EngineFailure extends Error {
  override name = 'EngineFailure';
  constructor(readonly info: EngineErrorInfo) {
    super(info.message);
  }
}

export const contextKindFor = (s: AppServices) => (s.source.kind === 'fixture' && s.loadGolden ? 'golden-fixture' : 'production');

export function useEngineContext() {
  const services = useServices();
  const master = useMaster();
  const kind = contextKindFor(services);
  return useQuery<ContextInfo>({
    queryKey: ['engine-context', master.data?.version, kind],
    enabled: !!master.data,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const m = master.data as MasterData;
      const golden = kind === 'golden-fixture' ? await services.loadGolden!() : undefined;
      const r = await services.engine.configure({ bundle: m.bundle, kind, ...(golden ? { golden } : {}) });
      if (!r.ok) throw new EngineFailure(r.error);
      return r.value;
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
  | { status: 'ready'; snapshot: ModelSnapshot; fitted: SessionFit | null; legacy: ModelSnapshot | null; storeError: string | null }
  | { status: 'cancelled' }
  | { status: 'error'; message: string; engine?: EngineErrorInfo };

/**
 * Fit-or-reuse. `onFitStart` lets the UI show "fitting…" before the (cancellable) worker job runs.
 * `force` refits regardless (S07 "Refit model", or a corrupt snapshot).
 */
export async function ensureModel(
  services: AppServices,
  qc: ReturnType<typeof useQueryClient>,
  args: {
    roster: RosterVeteran[];
    rosterEtag: string | null;
    masterVersion: string;
    context: string;
    force?: FitReason;
    onFitStart?: (reason: FitReason, cancel: () => void) => void;
    isCurrent?: () => boolean;
  },
): Promise<ModelOutcome> {
  const { source, store, engine, now } = services;
  let v2: ModelSnapshot | null;
  let anyLatest: ModelSnapshot | null;
  try {
    [v2, anyLatest] = await Promise.all([source.latestSnapshot('training-v2'), source.latestSnapshot()]);
  } catch (e) {
    return { status: 'error', message: `Couldn't load the model snapshot. ${errorText(e)}` };
  }
  if (args.isCurrent && !args.isCurrent()) return { status: 'cancelled' };
  const decision = args.force
    ? ({ action: 'fit', reason: args.force, legacy: anyLatest?.kind === 'training-v1' ? anyLatest : null } as const)
    : decideModel({
        v2,
        anyLatest,
        rosterEtag: args.rosterEtag,
        masterVersion: args.masterVersion,
        context: args.context,
        record: loadFitRecord(store, source.kind),
      });
  if (decision.action === 'use') {
    return { status: 'ready', snapshot: decision.snapshot, fitted: null, legacy: null, storeError: null };
  }
  const job = engine.fit(args.roster, { nowIso: now().toISOString() });
  args.onFitStart?.(decision.reason, job.cancel);
  const outcome = await job.promise;
  if (outcome.status === 'cancelled' || outcome.status === 'superseded') return { status: 'cancelled' };
  if (outcome.status === 'crashed') return { status: 'error', message: `The engine worker stopped: ${outcome.message}` };
  if (!outcome.result.ok) return { status: 'error', message: outcome.result.error.message, engine: outcome.result.error };
  if (args.isCurrent && !args.isCurrent()) return { status: 'cancelled' };
  const out = outcome.result.value;
  const fitted: SessionFit = { output: out, reason: decision.reason, at: now().toISOString() };
  qc.setQueryData(FIT_SUMMARY_KEY, fitted);
  let storeError: string | null = null;
  try {
    await source.storeSnapshot(out.snapshot);
    saveFitRecord(store, source.kind, {
      snapshotId: out.snapshot.id,
      rosterEtag: args.rosterEtag,
      masterVersion: args.masterVersion,
      context: args.context,
    });
  } catch (e) {
    storeError = `The model was fitted but couldn't be stored: ${errorText(e)}`;
  }
  void qc.invalidateQueries({ queryKey: ['model-snapshot'] });
  return { status: 'ready', snapshot: out.snapshot, fitted, legacy: decision.legacy, storeError };
}

export function useSessionFit(): SessionFit | undefined {
  const qc = useQueryClient();
  return useQuery<SessionFit | null>({
    queryKey: FIT_SUMMARY_KEY,
    queryFn: () => qc.getQueryData<SessionFit>(FIT_SUMMARY_KEY) ?? null,
    staleTime: Infinity,
  }).data ?? undefined;
}

export function useLatestSnapshot() {
  const { source } = useServices();
  return useQuery({ queryKey: qk.snapshot('latest'), queryFn: () => source.latestSnapshot() });
}
