/**
 * Browser-safe consumer entry point for the T08 golden dataset (70 §2): the typed shape of
 * `truth.json` and `loadGoldenContext`, which rebuilds the generator's exact engine context.
 *
 * Side-effect free. Runtime imports: `../src/index.ts` only (plus type-only imports from
 * `@uma/schema` / `@uma/master-data`). No `node:*`, prettier, published-bundle or generator I/O,
 * so a web worker / fixture-mode planner (T13) can import it as well as the T06/T15 Node tests.
 * A test (files.test.ts) walks this file's import graph to keep it that way.
 */
import type { Rules, RosterVeteran, Scenario, StatKey, TrainMode } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import { defaultScenario, loadContext } from '../src/index.ts';
import type { EngineContext } from '../src/index.ts';

type PerStat = Record<StatKey, number>;
export type GoldenRole = 'best1' | 'best2' | 'trap1' | 'trap2';

export interface PlantedCard {
  cardId: string;
  type: string;
  /** Per-stat effect at LB4 (= 2 × perUnit). */
  atLb4: PerStat;
  /** Per-stat effect per unit of the 50 §4 card feature `1 + lb/4` (LB0 = 1 unit, LB4 = 2). */
  perUnit: PerStat;
}

export interface GoldenLatent {
  /** Sampled inheritance stat gain (stat order). Truth only: T06 must use the expectation. */
  inheritance: number[];
  training: number[];
  noise: number[];
  /** Skills hinted by the sparks that actually activated in the sampled inheritance. */
  inheritanceHints: string[];
}

export interface GoldenMeta {
  dataset: string;
  synthetic: true;
  notice: string;
  seed: number;
  generatedAt: string;
  generator: string;
  command: string;
  masterVersion: string;
  rulesVersion: string;
  rosterSize: number;
}

export interface GoldenSyntheticInheritance {
  note: string;
  inheritanceTurns: Record<string, { turns: number[]; synthetic: true; note: string }>;
  rulesOverrides: {
    blueStatGain: { '1': number; '2': number; '3': number; verified: false; source: string };
  };
  rulesUsedVerbatim: string[];
  /** Multiplier applied to blueStatGain for roster.json (1.0). */
  blueStatGainMultiplier: number;
  guestsHaveNoLineage: string;
}

export interface GoldenTrainingModel {
  formula: string;
  baseline: PerStat;
  modeIntercept: Record<TrainMode, PerStat>;
  modeInterceptTotal: Record<TrainMode, number>;
  scenarioIntercept: Record<string, PerStat>;
  growthCoefficient: PerStat;
  growthNote: string;
  cardFeature: string;
  plantedCards: PlantedCard[];
  zeroEffectCards: string[];
  residualNoise: {
    distribution: string;
    sd: PerStat;
    correlation: number[][];
    covariance: number[][];
    order: readonly StatKey[];
  };
  rounding: string;
  /** N2: whether the clip to [1, statCap] is ever active in the generated rosters. */
  clipping: { exercised: boolean; observedStatRange: [number, number]; note: string };
  statCap: Record<string, number>;
  timeTrend: string;
  /** B1 / Q-122: what "recovers the planted card effects" means under id + type pooling. */
  cardEffectEstimand: string;
  /** Synthetic tuning choices that make the 50 §4 estimator recover the effects (B1). */
  synthetic: Record<string, string>;
}

export interface GoldenSkills {
  hintedDefinition: string;
  acquisition: string;
  /** S2: the estimand a 50 §4 Beta fit observes, which is not `rates` for spark-only hints. */
  observableEstimand: string;
  priors: Record<TrainMode, { a: number; b: number }>;
  rates: Record<TrainMode, Record<string, number>>;
  uniqueSkill: string;
}

export interface GoldenSparksInfo {
  selfSparks: string;
  guestSparks: string;
  gradeRule: string;
  xSparkId: string;
}

export interface GoldenDeckModel {
  pool: string;
  borrowed: string;
  ownedLb: Record<string, { lbAtStart: number; upgradeDays: number[]; dayZero: string }>;
  ownedLbRule: string;
  level: string;
}

export interface GoldenRosterInfo {
  size: number;
  modes: { independent: number; manual: number; rule: string };
  scenarios: Record<string, number>;
  dateAcquiredRange: [string, string];
  dateAcquiredRule: string;
  capturedAt: string;
  ids: string;
  minConfidence: string;
  lowConfidenceIds: string[];
  unreadParentSparks: { id: string; owner: 'parent1' | 'parent2' }[];
  modeOverrideIds: string[];
  trainingEligibleIds: string[];
  trainingEligibleRule: string;
  parents: { matched: number; guest: number; unmatchedNonGuest: number; note: string };
  hinted: string;
}

export interface GoldenPairInfo {
  parents: [string, string];
  characters: [string, string];
  why: string;
}

export interface GoldenInfo {
  skillX: string;
  traineeOutfitId: string;
  traineeCharacterId: string;
  scenarioId: string;
  trainMode: TrainMode;
  targetName: string;
  targetId: string;
  target: string;
  planDeck: RosterVeteran['deck'];
  skillXWhy: string;
  bestPair: GoldenPairInfo;
  trapPair: GoldenPairInfo;
  roles: Record<GoldenRole, string>;
}

export interface GoldenHoldout {
  seed: number;
  fraction: number;
  method: string;
  holdoutIds: string[];
  trainIds: string[];
  /** S3: the measured coverage of a 50 §4-style diagnostic fit on this split, and its limits. */
  coverageDiagnostic: {
    definition: string;
    pooled: number;
    perStat: PerStat;
    cells: number;
    band: [number, number];
    margin: string;
    limitations: string;
  };
}

export interface GoldenCalibration {
  file: string;
  blueStatGainMultiplier: number;
  effectiveBlueStatGain: { '1': number; '2': number; '3': number };
  note: string;
  sha256: string;
  latent: Record<string, GoldenLatent>;
}

/** The whole of truth.json. */
export interface GoldenTruth {
  meta: GoldenMeta;
  syntheticInheritance: GoldenSyntheticInheritance;
  trainingModel: GoldenTrainingModel;
  skills: GoldenSkills;
  sparks: GoldenSparksInfo;
  deckModel: GoldenDeckModel;
  roster: GoldenRosterInfo;
  golden: GoldenInfo;
  holdout: GoldenHoldout;
  calibration: GoldenCalibration;
  latent: Record<string, GoldenLatent>;
  files: Record<string, string>;
  /** S4 / N3: what the apps/web/fixtures copies are for. */
  webFixtures: { note: string };
}

/** The part of truth.json `loadGoldenContext` needs. */
export interface GoldenContextInput {
  syntheticInheritance: {
    inheritanceTurns: Readonly<Record<string, { turns: readonly number[] }>>;
    rulesOverrides: {
      blueStatGain: { '1': number; '2': number; '3': number; source: string };
    };
  };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The engine context for the golden data: `rules.json` verbatim except the documented synthetic
 * `blueStatGain` (× `multiplier`), and a scenario plugin per scenario that returns the synthetic
 * inheritance turns from truth.json. Consumers rebuild the generator's exact context from
 * truth.json with this function. Fixture-mode planners must use it too: the published rules
 * (blueStatGain 0, turns `[]`) do not reproduce the golden best pair.
 */
export function loadGoldenContext(
  master: MasterBundle,
  truth: GoldenContextInput,
  multiplier = 1,
): EngineContext {
  const si = truth.syntheticInheritance;
  const g = si.rulesOverrides.blueStatGain;
  const rules: Rules = {
    ...master.rules,
    blueStatGain: {
      ...master.rules.blueStatGain,
      '1': r6(g['1'] * multiplier),
      '2': r6(g['2'] * multiplier),
      '3': r6(g['3'] * multiplier),
      verified: false,
      source: g.source,
    },
  };
  const plugins: Record<string, (row: Scenario) => ReturnType<typeof defaultScenario>> = {};
  for (const [id, t] of Object.entries(si.inheritanceTurns)) {
    plugins[id] = (row) => ({ ...defaultScenario(row), inheritanceTurns: () => [...t.turns] });
  }
  return loadContext(master, rules, { plugins });
}
