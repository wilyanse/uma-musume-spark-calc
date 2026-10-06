/**
 * Production wiring. Fixture mode (`VITE_FIXTURES=1`) swaps the API for the SYNTHETIC golden
 * fixtures and enables the labelled golden engine context; nothing else changes. The fixture
 * wiring lives in `fixture-only/services.ts`, which a production build replaces with a null stub.
 */
import type { AppServices } from './services.ts';
import { httpSource } from '../api/http.ts';
import { FIXTURE_MODE } from '../api/mode.ts';
import { loadMaster, type MasterData } from '../master/load.ts';
import { EngineClient } from '../workers/client.ts';
import { defaultStore } from '../lib/storage.ts';
import { fixtureServices } from '../fixture-only/services.ts';

export function createServices(fixtures = FIXTURE_MODE): AppServices {
  let master: Promise<MasterData> | null = null;
  const getMaster = () => {
    master ??= loadMaster().finally(() => { master = null; });
    return master;
  };
  const now = () => new Date();
  const base = { loadMaster: getMaster, engine: new EngineClient(), store: defaultStore(), now, monotonicNow: () => performance.now() };
  if (!fixtures || !fixtureServices) return { ...base, source: httpSource() };
  return { ...base, ...fixtureServices({ now, getMaster }) };
}
