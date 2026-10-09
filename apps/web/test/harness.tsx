/**
 * Screen test harness: renders a route with a fake `DataSource` (MOCK, in-memory; labelled), the
 * real master data from disk, a fake engine client, an in-memory store and a fixed clock.
 */
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { CmTarget, ModelSnapshot, ReviewItem, RosterVeteran, RosterVeteranDetail } from '@uma/schema';
import { routes } from '../src/router.tsx';
import { ServicesContext, type AppServices } from '../src/app/services.ts';
import type { DataSource, OwnedCardRow } from '../src/api/types.ts';
import { memoryStore } from '../src/lib/storage.ts';
import { HttpError } from '../src/api/errors.ts';
import { EngineClient, type EngineHandle } from '../src/workers/client.ts';
import { masterData } from './fixtures.ts';
import { seededRandom } from '../src/lib/ulid.ts';
import { TRAINING_ELIGIBILITY_POLICY } from '@uma/engine';

export const NOW = new Date('2026-10-04T00:00:00.000Z');

export interface MockData {
  roster?: RosterVeteran[];
  detail?: Record<string, RosterVeteranDetail>;
  open?: ReviewItem[];
  resolved?: ReviewItem[];
  owned?: OwnedCardRow[];
  targets?: CmTarget[];
  snapshot?: ModelSnapshot | null;
}

/** A MOCK DataSource whose every method can be overridden; calls are recorded. */
export function mockSource(data: MockData = {}, over: Partial<DataSource> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec =
    <A extends unknown[], R>(method: string, fn: (...a: A) => Promise<R>) =>
    (...a: A) => {
      calls.push({ method, args: a });
      return fn(...a);
    };
  const roster = data.roster ?? [];
  const src: DataSource = {
    kind: 'api',
    health: rec('health', async () => ({ ok: true, masterVersion: masterData().version, dbSchemaVersion: 3 })),
    roster: rec('roster', async () => ({ etag: '"e1"', roster, notModified: false })),
    veteran: rec('veteran', async (id: string) => {
      const d = data.detail?.[id];
      if (!d) throw new HttpError(404, null, 'GET /veterans');
      return d;
    }),
    patchVeteran: rec('patchVeteran', async (id: string, body: { trainMode: 'independent' | 'manual' }) => ({
      ...data.detail![id]!,
      ...body,
      modeSource: 'override' as const,
    })),
    deleteVeteran: rec('deleteVeteran', async () => undefined),
    reviewItems: rec('reviewItems', async (s: 'open' | 'resolved') => (s === 'open' ? (data.open ?? []) : (data.resolved ?? []))),
    resolveReviewItem: rec('resolveReviewItem', async (id: string) => ({ ...data.open!.find((i) => i.id === id)!, status: 'resolved' as const })),
    cropUrl: (k: string) => `/api/v1/crops/${k}`,
    ownedCards: rec('ownedCards', async () => data.owned ?? []),
    targets: rec('targets', async () => data.targets ?? []),
    createTarget: rec('createTarget', async (i) => ({ ...i, id: '01KGQZ0000G01DENCM0000NEW1' }) as CmTarget),
    updateTarget: rec('updateTarget', async (id, i) => ({ ...i, id }) as CmTarget),
    deleteTarget: rec('deleteTarget', async () => undefined),
    latestSnapshot: rec('latestSnapshot', async () => data.snapshot ?? null),
    storeSnapshot: rec('storeSnapshot', async (s: ModelSnapshot) => s),
    ...over,
  };
  return { src, calls };
}

/** T15c: the context identity the FAKE engine's default configure reports (not a real digest of anything). */
export const HARNESS_FP = `sha256:${'f'.repeat(64)}`;
/** A full FAKE `ContextInfo` (production, no override) for fake engines. */
export function fakeContext(over: Record<string, unknown> = {}) {
  return {
    kind: 'production', masterVersion: masterData().version, rulesVersion: 'rules-1', unverifiedRules: ['blueStatGain'], placeholderRules: [], warnings: [], overrides: [],
    eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY, fingerprint: HARNESS_FP, baseFingerprint: HARNESS_FP, baseRulesVersion: 'rules-1', override: null, overrideRejected: null, effectiveRules: masterData().bundle.rules,
    ...over,
  };
}

/** FAKE engine: no worker; configure succeeds, fit/rank/calibrate are scripted by the test. */
export function fakeEngine(remote: Partial<Record<'configure' | 'fit' | 'rank' | 'calibrate', (...a: unknown[]) => Promise<unknown>>> = {}) {
  const handle = (): EngineHandle => ({
    remote: {
      configure: remote.configure ?? (async () => ({ ok: true, value: fakeContext() })),
      fit: remote.fit ?? (async () => ({ ok: false, error: { name: 'Error', message: 'fit not scripted' } })),
      rank: remote.rank ?? (async () => ({ ok: false, error: { name: 'Error', message: 'rank not scripted' } })),
      calibrate: remote.calibrate ?? (async () => ({ ok: false, error: { name: 'Error', message: 'calibrate not scripted' } })),
    } as unknown as EngineHandle['remote'],
    terminate: () => undefined,
  });
  return new EngineClient(handle);
}

export function renderRoute(path: string, source: DataSource, extra: Partial<AppServices> = {}, wrap?: (n: ReactNode) => ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const services: AppServices = {
    source,
    loadMaster: async () => masterData(),
    engine: fakeEngine(),
    store: memoryStore(),
    now: () => NOW,
    // Deterministic ids (01 §1 ULIDs): the injected id randomness is seeded in every screen test.
    random: seededRandom(0x15c),
    ...extra,
  };
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const tree = (
    <ServicesContext.Provider value={services}>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ServicesContext.Provider>
  );
  return { ...render(wrap ? wrap(tree) : tree), qc, router, services };
}

export const never = <T,>() => new Promise<T>(() => undefined);
