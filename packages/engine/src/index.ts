/**
 * @uma/engine public API (50 §1). T05: context, scenarios, inheritance. T06: training model,
 * prediction, target scoring and ranking (`fitTrainingModel`, `predictChild`, `scoreTarget`,
 * `rankPairs`) plus their engine-local types (not shared contracts: they never cross the API).
 * T15: `calibrateRules` and its engine-local `CalibrationReport`.
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
export {
  checkLegality,
  IllegalPairError,
  traineeCharacter,
  UnknownIdError,
} from './inheritance/legality.ts';
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

// T06 (50 §4–§7, ADR-0002).
export {
  choleskyFactor,
  choleskySolve,
  eigenFactor,
  floorPsd,
  jacobiEigen,
  NumericError,
  symmetrize,
} from './linalg.ts';
export type { Eigen, Matrix, NumericErrorCode, PsdFloor } from './linalg.ts';
export {
  InsufficientDataError,
  ModelInputError,
  RefitRequiredError,
  ScoreRequiresSamplesError,
  SkillPosteriorError,
} from './model/errors.ts';
export {
  DEFAULT_CV_SEED,
  DEFAULT_SPLIT_SEED,
  effectiveCardEffect,
  fitTrainingModel,
  fitTrainingModelDetailed,
  MIN_CONFIDENCE,
  MODEL_KIND,
  RECENCY_HALF_LIFE_DAYS,
  TRAINING_ELIGIBILITY_POLICY,
  confidenceExclusion,
} from './model/fit.ts';
export type {
  ExclusionReason,
  FitOptions,
  FitReport,
  RowLineage,
  SkillDiagnostics,
  TrainingFit,
} from './model/fit.ts';
export { estimateNonInheritanceCov, gaussianCoverage, Z80 } from './model/covariance.ts';
export type {
  CovarianceDiagnostics,
  CovarianceFit,
  Coverage,
  HoldoutBias,
  HoldoutCell,
  WeightedResidual,
} from './model/covariance.ts';
export { fitGlobalPrior, skillPosterior, tanhSinhMoments } from './model/skills.ts';
export type { BetaParams, Exposure, PriorFit, SkillPosterior } from './model/skills.ts';
export { LAMBDA_BASE_GRID, LAMBDA_ID_GRID } from './model/ridge.ts';
export { recordedParent } from './model/lineage.ts';
export type { ParentKind, RecordedParent } from './model/lineage.ts';
export { prepareModel } from './model/prepared.ts';
export type { PreparedModel } from './model/prepared.ts';
export type { FeatureWarnings } from './model/features.ts';
export {
  DEFAULT_SAMPLES,
  normalizeTarget,
  predictChild,
  scoreTarget,
  targetKey,
} from './predict/index.ts';
export type {
  ChildPrediction,
  GaussianSummary,
  NormalizedTarget,
  PredictionSamples,
  PredictOptions,
  Requirement,
  SkillPrediction,
  StatSummary,
  TargetScore,
} from './predict/index.ts';
export {
  DEFAULT_RANK_SEED,
  DEFAULT_TOP_K,
  DEFAULT_TOP_N,
  PROGRESS_EVERY,
  rankPairs,
  rankPairsDetailed,
} from './rank/index.ts';
export type { RankedPair, RankOptions, RankProgress, RankResult } from './rank/index.ts';

// T15 (50 §8): rules calibration. Engine-local report type (not a shared contract).
export {
  CALIBRATION_KIND,
  calibrateRules,
  DEFAULT_BOOTSTRAP,
  DEFAULT_BOOTSTRAP_SEED,
  DEFAULT_CALIBRATION_SPLIT_SEED,
  COLLINEAR_REL_TOL,
  MIN_BOOTSTRAP_HOLDOUT,
  MIN_SEARCH_GRID_POINTS,
} from './calibrate/index.ts';
export type {
  BlueIdentification as CalibrationBlueIdentification,
  CalibrationExclusion,
  CalibrationOptions,
  CalibrationReport,
  Candidate as CalibrationCandidate,
  CandidateFit as CalibrationCandidateFit,
  GridPoint as CalibrationGridPoint,
  NotCalibrated,
  PopulationRow as CalibrationPopulationRow,
  Selection as CalibrationSelection,
  SelectionAgreement as CalibrationSelectionAgreement,
  StatCheck as CalibrationStatCheck,
  StatUncertainty as CalibrationStatUncertainty,
  Suggestion as CalibrationSuggestion,
} from './calibrate/index.ts';
export { DEFAULT_CALIBRATION_GRID } from './calibrate/grid.ts';
export type { GridSpec as CalibrationGrid } from './calibrate/grid.ts';
export { withBlueStatGainMultiplier } from './calibrate/context.ts';
export type {
  AptitudeCheck,
  AptitudeStat,
  FullLikelihoodState,
  ImpossibleReason,
  InvalidObservedGrade,
  ReliabilityBin,
} from './calibrate/aptitude.ts';
export type { SkillCellSummary, SkillHoldoutCheck } from './calibrate/skills.ts';
