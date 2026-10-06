/**
 * Production wiring. Fixture mode (`VITE_FIXTURES=1`) swaps the API for the SYNTHETIC golden
 * fixtures and enables the labelled golden engine context; nothing else changes.
 */
import type { AppServices, FixtureGolden } from './services.ts';
import { httpSource } from '../api/http.ts';
import { fixtureSource } from '../api/fixture.ts';
import { FIXTURE_MODE } from '../api/mode.ts';
import { loadMaster, type MasterData } from '../master/load.ts';
import { EngineClient } from '../workers/client.ts';
import { defaultStore } from '../lib/storage.ts';

export function createServices(fixtures = FIXTURE_MODE): AppServices {
  let master: Promise<MasterData> | null = null;
  const getMaster = () => {
    master ??= loadMaster().finally(() => { master = null; });
    return master;
  };
  const now = () => new Date();
  const base = { loadMaster: getMaster, engine: new EngineClient(), store: defaultStore(), now, monotonicNow: () => performance.now() };
  if (!fixtures) return { ...base, source: httpSource() };
  let golden: Promise<FixtureGolden> | null = null;
  return {
    ...base,
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
}
