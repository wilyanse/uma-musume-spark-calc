/**
 * Fixture-mode-only wiring (`VITE_FIXTURES=1`): the SYNTHETIC golden fixture source and the
 * golden-truth.json loader. A production build (no `VITE_FIXTURES=1`) resolves this module to
 * `services.disabled.ts` instead (vite.config.ts `fixtureOnly`), so neither the fixture source nor
 * the loader is in the production bundle (T13 review r1 N3).
 */
import type { AppServices, FixtureGolden } from '../app/services.ts';
import { fixtureSource } from '../api/fixture.ts';
import type { MasterData } from '../master/load.ts';

export type FixtureServices = (deps: {
  now: () => Date;
  getMaster: () => Promise<MasterData>;
}) => Pick<AppServices, 'source' | 'loadGolden'>;

export const fixtureServices: FixtureServices | null = ({ now, getMaster }) => {
  let golden: Promise<FixtureGolden> | null = null;
  return {
    source: fixtureSource({
      now,
      random: Math.random,
      masterVersion: async () => (await getMaster()).version,
    }),
    loadGolden: () => {
      golden ??= fetch('/fixtures/golden-truth.json').then(async (r) => {
        if (!r.ok) throw new Error(`golden-truth.json: HTTP ${r.status}`);
        return (await r.json()) as FixtureGolden;
      });
      return golden;
    },
  };
};
