/**
 * Shared test fixtures: the committed T08 golden copies (SYNTHETIC, read-only) and the published
 * master bundle (read-only), loaded from disk. Nothing here writes to either.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CmTarget, MasterLatest, RosterVeteran } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import { indexMaster, MASTER_FILES, type MasterData } from '../src/master/load.ts';

const WEB = join(import.meta.dirname, '..');
const MASTER_DIR = join(WEB, 'public/master');
const json = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

export const latest = json(join(MASTER_DIR, 'latest.json')) as MasterLatest;

let bundle: MasterBundle | null = null;
export function masterBundle(): MasterBundle {
  if (bundle) return bundle;
  const dir = join(MASTER_DIR, latest.version);
  const f = (name: (typeof MASTER_FILES)[number]) => json(join(dir, name));
  bundle = {
    version: latest.version,
    characters: f('characters.json'),
    outfits: f('outfits.json'),
    skills: f('skills.json'),
    sparks: f('sparks.json'),
    cards: f('cards.json'),
    affinity: f('affinity.json'),
    scenarios: f('scenarios.json'),
    ranks: f('ranks.json'),
    vocab: f('vocab.json'),
    rules: f('rules.json'),
  } as MasterBundle;
  return bundle;
}

let master: MasterData | null = null;
export function masterData(): MasterData {
  master ??= indexMaster(latest, masterBundle());
  return master;
}

export const goldenRoster = (): RosterVeteran[] =>
  json(join(WEB, 'fixtures/roster.json')) as RosterVeteran[];
/**
 * The committed T08 planted ×1.3 roster (SYNTHETIC, read-only, unchanged; 70 §2 F12). Only the
 * roster rows are read: the planted multiplier itself lives in truth.json and is never an input.
 */
export const calibrationRoster = (): RosterVeteran[] =>
  json(join(WEB, '../../packages/engine/test/golden/roster.calibration-x1.3.json')) as RosterVeteran[];
export const goldenTargets = (): CmTarget[] => json(join(WEB, 'fixtures/cm-targets.json')) as CmTarget[];
export const goldenTruth = (): Record<string, unknown> & {
  golden: {
    traineeOutfitId: string;
    scenarioId: string;
    trainMode: 'independent' | 'manual';
    planDeck: RosterVeteran['deck'];
    targetName: string;
    bestPair: { parents: [string, string] };
    trapPair: { parents: [string, string] };
  };
  syntheticInheritance: {
    inheritanceTurns: Record<string, { turns: number[] }>;
    rulesOverrides: { blueStatGain: { '1': number; '2': number; '3': number; source: string } };
  };
} => json(join(WEB, 'fixtures/golden-truth.json')) as never;

export const masterFileBytes = (file: string): Buffer =>
  readFileSync(join(MASTER_DIR, latest.version, file));
export const latestBytes = (): Buffer => readFileSync(join(MASTER_DIR, 'latest.json'));
