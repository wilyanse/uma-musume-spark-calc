import { createContext, useContext } from 'react';
import type { DataSource } from '../api/types.ts';
import type { MasterData } from '../master/load.ts';
import type { EngineClient } from '../workers/client.ts';
import type { KeyValueStore } from '../lib/storage.ts';
import type { GoldenContextInput } from '../../../../packages/engine/scripts/golden-context.ts';
import type { RosterVeteran, TrainMode } from '@uma/schema';

/**
 * What fixture mode reads from golden-truth.json (SYNTHETIC, T08): the inheritance overrides
 * `loadGoldenContext` needs and the planted plan (trainee, deck, mode, scenario, target name).
 */
export interface FixtureGolden extends GoldenContextInput {
  golden: {
    traineeOutfitId: string;
    planDeck: RosterVeteran['deck'];
    trainMode: TrainMode;
    scenarioId: string;
    targetName: string;
  };
}

/** Everything a screen depends on, injected (tests pass fakes; `main.tsx` passes the real ones). */
export interface AppServices {
  source: DataSource;
  /** Loads (and caches) master data. */
  loadMaster: () => Promise<MasterData>;
  engine: EngineClient;
  store: KeyValueStore;
  now: () => Date;
  /**
   * T15c: creates an ISOLATED engine client for a candidate (apply) fit, so the active worker and
   * its context are untouched until the candidate commits. Disposed after every apply attempt.
   */
  candidateEngine?: () => EngineClient;
  /** Monotonic duration clock; distinct from the injected model/record date. */
  monotonicNow?: () => number;
  /**
   * Fixture mode only: golden-truth.json for the clearly labelled golden engine context and the
   * planted plan. Undefined in production, so production can never use synthetic values.
   */
  loadGolden?: () => Promise<FixtureGolden>;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}
