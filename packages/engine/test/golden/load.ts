/**
 * Shared loaders for the golden-dataset tests (70 §2). Reads the committed files from disk; the
 * tests never write them (`pnpm --filter @uma/engine golden` does).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CmTarget, RosterVeteran } from '@uma/schema';
import type { GoldenTruth } from '../../scripts/golden-context.ts';
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

/** truth.json, typed by the shared browser-safe module (one definition for generator and tests). */
export const truth = readJson('truth.json') as GoldenTruth;
export type { GoldenLatent as Latent, GoldenTruth as Truth } from '../../scripts/golden-context.ts';
