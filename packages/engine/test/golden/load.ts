/**
 * Shared loaders for the golden-dataset tests (70 §2). Reads the committed files from disk; the
 * tests never write them (`pnpm --filter @uma/engine golden` does).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CmTarget, RosterVeteran } from '@uma/schema';
import type { StatKey, TrainMode } from '@uma/schema';
import { loadPublishedBundle } from '../../scripts/published-bundle.ts';

export const GOLDEN_DIR = import.meta.dirname;
export const WEB_FIXTURES_DIR = join(import.meta.dirname, '../../../../apps/web/fixtures');

export const readText = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
const readJson = (file: string): unknown => JSON.parse(readText(GOLDEN_DIR, file));

export const master = loadPublishedBundle();
export const roster = RosterVeteran.array().parse(readJson('roster.json'));
export const calibrationRoster = RosterVeteran.array().parse(
  readJson('roster.calibration-x1.3.json'),
);
export const targets = CmTarget.array().parse(readJson('targets.json'));

type PerStat = Record<StatKey, number>;

/** The parts of truth.json the tests read (the file has more documentation fields). */
export interface Truth {
  meta: { seed: number; generatedAt: string; masterVersion: string; rosterSize: number };
  syntheticInheritance: {
    inheritanceTurns: Record<string, { turns: number[]; synthetic: boolean; note: string }>;
    rulesOverrides: {
      blueStatGain: { '1': number; '2': number; '3': number; verified: boolean; source: string };
    };
    rulesUsedVerbatim: string[];
    blueStatGainMultiplier: number;
  };
  trainingModel: {
    baseline: PerStat;
    modeIntercept: Record<TrainMode, PerStat>;
    modeInterceptTotal: Record<TrainMode, number>;
    scenarioIntercept: Record<string, PerStat>;
    growthCoefficient: PerStat;
    plantedCards: { cardId: string; type: string; atLb4: PerStat; perUnit: PerStat }[];
    zeroEffectCards: string[];
    residualNoise: {
      sd: PerStat;
      correlation: number[][];
      covariance: number[][];
      order: StatKey[];
    };
    statCap: Record<string, number>;
  };
  skills: {
    priors: Record<TrainMode, { a: number; b: number }>;
    rates: Record<TrainMode, Record<string, number>>;
  };
  roster: {
    size: number;
    modes: { independent: number; manual: number };
    lowConfidenceIds: string[];
    unreadParentSparks: { id: string; owner: 'parent1' | 'parent2' }[];
    modeOverrideIds: string[];
    trainingEligibleIds: string[];
  };
  golden: {
    skillX: string;
    traineeOutfitId: string;
    traineeCharacterId: string;
    scenarioId: string;
    trainMode: TrainMode;
    targetName: string;
    targetId: string;
    planDeck: RosterVeteran['deck'];
    bestPair: { parents: [string, string]; characters: [string, string] };
    trapPair: { parents: [string, string]; characters: [string, string] };
    roles: Record<'best1' | 'best2' | 'trap1' | 'trap2', string>;
  };
  holdout: { seed: number; fraction: number; holdoutIds: string[]; trainIds: string[] };
  calibration: {
    file: string;
    blueStatGainMultiplier: number;
    sha256: string;
    latent: Record<string, Latent>;
  };
  latent: Record<string, Latent>;
  files: Record<string, string>;
}

export interface Latent {
  inheritance: number[];
  training: number[];
  noise: number[];
  inheritanceHints: string[];
}

export const truth = readJson('truth.json') as Truth;
