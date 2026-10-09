/**
 * Fixture-mode-only wiring (`VITE_FIXTURES=1`): the SYNTHETIC golden fixture source and the
 * golden-truth.json loader. A production build (no `VITE_FIXTURES=1`) resolves this module to
 * `services.disabled.ts` instead (vite.config.ts `fixtureOnly`), so neither the fixture source nor
 * the loader is in the production bundle (T13 review r1 N3).
 */
import type { AppServices, FixtureGolden } from '../app/services.ts';
import { fixtureSource } from '../api/fixture.ts';
import type { MasterData } from '../master/load.ts';
import { seededRandom } from '../lib/ulid.ts';

export type FixtureServices = (deps: {
  now: () => Date;
  random: () => number;
  getMaster: () => Promise<MasterData>;
}) => Pick<AppServices, 'source' | 'loadGolden' | 'random'>;

export const fixtureServices: FixtureServices | null = ({ now, random: realRandom, getMaster }) => {
  let golden: Promise<FixtureGolden> | null = null;
  // Fixture builds only: a test may seed the injected id randomness before the app boots (e2e
  // `addInitScript`), so report/override ULIDs repeat run to run. Absent a seed, real randomness.
  const seed = (globalThis as { __umaTestRandomSeed?: unknown }).__umaTestRandomSeed;
  const random = typeof seed === 'number' && Number.isInteger(seed) ? seededRandom(seed) : realRandom;
  const source = fixtureSource({
    now,
    random,
    masterVersion: async () => (await getMaster()).version,
  });
  // T15c browser evidence (fixture builds only): the ids the MOCK snapshot store received, so e2e can
  // prove no model fitted under a browser-local override ever reaches the snapshot store.
  const stored: string[] = [];
  (globalThis as { __umaFixtureStoredSnapshots?: string[] }).__umaFixtureStoredSnapshots = stored;
  const storeSnapshot = source.storeSnapshot.bind(source);
  return {
    random,
    source: { ...source, storeSnapshot: async (snap) => { stored.push(snap.id); return storeSnapshot(snap); } },
    loadGolden: () => {
      golden ??= fetch('/fixtures/golden-truth.json').then(async (r) => {
        if (!r.ok) throw new Error(`golden-truth.json: HTTP ${r.status}`);
        return (await r.json()) as FixtureGolden;
      });
      return golden;
    },
  };
};
