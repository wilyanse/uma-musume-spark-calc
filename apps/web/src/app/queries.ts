/**
 * TanStack Query hooks over the injected `DataSource` (60 §1, §3).
 * - Roster: loaded once with its ETag; refetches send `If-None-Match` and a 304 keeps the cached
 *   array (same object identity, so nothing downstream recomputes).
 * - Mode override: optimistic PATCH with rollback on error; detail + roster refetch on settle.
 * - Review resolve: invalidates roster + review queries.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CmTarget, RosterVeteran, RosterVeteranDetail, TrainMode } from '@uma/schema';
import { useServices } from './services.ts';
import type { CmTargetInput, RosterResult } from '../api/types.ts';
import type { MasterData } from '../master/load.ts';
import { HttpError } from '../api/errors.ts';

export const qk = {
  master: ['master'] as const,
  health: ['health'] as const,
  roster: ['roster'] as const,
  veteran: (id: string) => ['veteran', id] as const,
  review: (status: string) => ['review', status] as const,
  ownedCards: ['owned-cards'] as const,
  targets: ['cm-targets'] as const,
  snapshot: (kind: string) => ['model-snapshot', kind] as const,
};

export function useMaster() {
  const { loadMaster } = useServices();
  return useQuery<MasterData>({ queryKey: qk.master, queryFn: loadMaster, staleTime: 60_000, retry: 1 });
}

export function useHealth() {
  const { source } = useServices();
  return useQuery({ queryKey: qk.health, queryFn: () => source.health(), staleTime: 60_000 });
}

export function useRoster() {
  const { source } = useServices();
  const qc = useQueryClient();
  return useQuery<RosterResult>({
    queryKey: qk.roster,
    queryFn: async () => {
      const prev = qc.getQueryData<RosterResult>(qk.roster);
      return source.roster(prev?.etag ? { etag: prev.etag, roster: prev.roster } : undefined);
    },
    // Keep the same object when the server says 304, so `select`/memo consumers don't recompute.
    structuralSharing: (old, next) => {
      const o = old as RosterResult | undefined;
      const n = next as RosterResult;
      return n.notModified && o ? o : n;
    },
  });
}

export function useVeteran(id: string) {
  const { source } = useServices();
  return useQuery({ queryKey: qk.veteran(id), queryFn: () => source.veteran(id), retry: false });
}

/** 60 §3: PATCH with an optimistic update, rolled back on error. */
export function usePatchMode(id: string) {
  const { source } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trainMode: TrainMode) => source.patchVeteran(id, { trainMode }),
    onMutate: async (trainMode) => {
      await qc.cancelQueries({ queryKey: qk.veteran(id) });
      await qc.cancelQueries({ queryKey: qk.roster });
      const prevDetail = qc.getQueryData<RosterVeteranDetail>(qk.veteran(id));
      const prevRoster = qc.getQueryData<RosterResult>(qk.roster);
      if (prevDetail) qc.setQueryData(qk.veteran(id), { ...prevDetail, trainMode, modeSource: 'override' });
      if (prevRoster) {
        qc.setQueryData<RosterResult>(qk.roster, {
          ...prevRoster,
          roster: prevRoster.roster.map((v): RosterVeteran =>
            v.id === id ? { ...v, trainMode, modeSource: 'override' } : v,
          ),
        });
      }
      return { prevDetail, prevRoster };
    },
    onError: (_e, _v, snap) => {
      if (snap?.prevDetail) qc.setQueryData(qk.veteran(id), snap.prevDetail);
      if (snap?.prevRoster) qc.setQueryData(qk.roster, snap.prevRoster);
    },
    onSuccess: (detail) => qc.setQueryData(qk.veteran(id), detail),
    // Refetch both after every outcome, so a rollback can never leave an out-of-date snapshot in
    // either cache (T13 review r1 S3). The UI also disables the toggle while a PATCH is pending.
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.veteran(id) }),
        qc.invalidateQueries({ queryKey: qk.roster }),
      ]),
  });
}

export function useDeleteVeteran() {
  const { source } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.deleteVeteran(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: qk.veteran(id) });
      void qc.invalidateQueries({ queryKey: qk.roster });
      void qc.invalidateQueries({ queryKey: ['review'] });
    },
  });
}

export function useReviewItems(status: 'open' | 'resolved') {
  const { source } = useServices();
  return useQuery({ queryKey: qk.review(status), queryFn: () => source.reviewItems(status) });
}

export function useResolve() {
  const { source } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: unknown }) => source.resolveReviewItem(id, value),
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: qk.roster });
      void qc.invalidateQueries({ queryKey: ['review'] });
      void qc.invalidateQueries({ queryKey: qk.veteran(item.veteranId) });
    },
    // A 409/404 means the item or veteran changed under us: refresh the queue (60 §3).
    onError: (e) => {
      if (e instanceof HttpError && (e.status === 409 || e.status === 404)) {
        void qc.invalidateQueries({ queryKey: ['review'] });
        void qc.invalidateQueries({ queryKey: qk.roster });
      }
    },
  });
}

export function useOwnedCards() {
  const { source } = useServices();
  return useQuery({ queryKey: qk.ownedCards, queryFn: () => source.ownedCards() });
}

export function useTargets() {
  const { source } = useServices();
  return useQuery<CmTarget[]>({ queryKey: qk.targets, queryFn: () => source.targets() });
}

export function useSaveTarget() {
  const { source } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CmTargetInput }) =>
      id ? source.updateTarget(id, input) : source.createTarget(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.targets }),
  });
}

export function useDeleteTarget() {
  const { source } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.deleteTarget(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.targets }),
  });
}
