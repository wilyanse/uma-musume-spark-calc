/**
 * @uma/engine public API (50 §1). T05: context, scenarios, inheritance. T06 adds model/predict/rank
 * (`fitTrainingModel`, `predictChild`, `scoreTarget`, `rankPairs`); they are not exported yet.
 */
export { loadContext, RulesError, STAT_INDEX } from './context.ts';
export type { EngineContext, LoadContextOptions, PerStar, RaceEffectRow } from './context.ts';
export { compileAffinityFormula, FormulaError } from './formula.ts';
export { mulberry32, seedFromString } from './rng.ts';
export type { Rng } from './rng.ts';
export { defaultScenario, pluginFor, SCENARIO_PLUGINS } from './scenarios/index.ts';
export type { ScenarioPlugin, ScenarioPluginFactory } from './scenarios/index.ts';
export { affinity2, affinity3, computeAffinity } from './inheritance/affinity.ts';
export type { AffinityRelation, AffinityResult } from './inheritance/affinity.ts';
export { checkLegality, IllegalPairError, traineeCharacter, UnknownIdError } from './inheritance/legality.ts';
export type { IllegalReason, Legality } from './inheritance/legality.ts';
export {
  expectationFromPlan,
  inheritanceExpectation,
  legacyFromVeteran,
  planInheritance,
  sampleInheritance,
} from './inheritance/inheritance.ts';
export type {
  Activation,
  ActivationKind,
  Contribution,
  InheritancePlan,
  InheritanceProvenance,
  InheritanceResult,
  InheritanceSample,
  SkippedSpark,
} from './inheritance/inheritance.ts';
export { SPARK_SOURCES } from './types.ts';
export type {
  DeckSlot,
  Effect,
  Grandparent,
  Legacy,
  PlanInput,
  SparkRef,
  SparkSource,
  Stars,
  StatVector,
  Veteran,
} from './types.ts';
