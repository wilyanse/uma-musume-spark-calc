import type { Scenario, Spark } from '@uma/schema';
import type { DeckSlot, Effect, Stars } from '../types.ts';
import type { EngineContext } from '../context.ts';

/** 50 §2: a scenario plugin. */
export interface ScenarioPlugin {
  id: string;
  /** From scenarios.json. */
  statCap(ctx: EngineContext): number;
  /** From scenarios.json. May be empty when the turns are unknown (then no event rolls happen). */
  inheritanceTurns(ctx: EngineContext): number[];
  /** Extra model features for T06; may be `{}`. */
  deckFeatures(deck: DeckSlot[], ctx: EngineContext): Record<string, number>;
  /**
   * Scenario-specific effect of a white spark. Deviation from 50 §2 (`sparkEffects?(spark, ctx)`):
   * the first argument is `{spark, stars}` because an effect depends on the star count, and the
   * result may be `undefined`. Returning `undefined` keeps the rules-driven default effect;
   * returning an object replaces it (missing fields mean "no effect"). Duplicate hint skill ids in
   * the result are merged (see `Effect.hints`).
   */
  sparkEffects?(spark: { spark: Spark; stars: Stars }, ctx: EngineContext): Partial<Effect> | undefined;
}

/** `DefaultScenario`: reads everything from the master-data row. */
export function defaultScenario(row: Scenario): ScenarioPlugin {
  return {
    id: row.id,
    statCap: () => row.statCap,
    inheritanceTurns: () => [...row.inheritanceTurns],
    deckFeatures: () => ({}),
  };
}

/** Builds a plugin from its master-data row. */
export type ScenarioPluginFactory = (row: Scenario) => ScenarioPlugin;

/**
 * Registered plugins keyed by scenario id. Empty: every Global scenario currently uses
 * `DefaultScenario` (adding a scenario = a master-data row, plus an optional file here).
 */
export const SCENARIO_PLUGINS: Readonly<Record<string, ScenarioPluginFactory>> = {};

/** The plugin for a scenario row: `extra[id]`, else the registered one, else `DefaultScenario`. */
export function pluginFor(row: Scenario, extra?: Readonly<Record<string, ScenarioPluginFactory>>): ScenarioPlugin {
  const make = extra?.[row.id] ?? SCENARIO_PLUGINS[row.id];
  return make ? make(row) : defaultScenario(row);
}
