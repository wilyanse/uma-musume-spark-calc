import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APT_KEYS, CONTRACTS, contractJsonSchema, type ContractName } from '../src/index.ts';
import vectorFile from './fingerprint.vectors.json' with { type: 'json' };
import { baseCapture } from './fixtures.ts';

const names = Object.keys(CONTRACTS) as ContractName[];

describe('JSON Schema export', () => {
  it('covers every top-level contract in 01', () => {
    for (const n of [
      'VeteranCapture',
      'OwnedCardsSync',
      'RosterVeteran',
      'ReviewItem',
      'CmTarget',
      'ModelSnapshot',
      'Rules',
      'MasterLatest',
    ])
      expect(names).toContain(n);
    for (const f of [
      'characters',
      'outfits',
      'skills',
      'sparks',
      'cards',
      'affinity',
      'scenarios',
      'ranks',
      'vocab',
    ])
      expect(names).toContain(`master.${f}`);
  });

  it.each(names)('%s: committed json/ file equals the export (run `pnpm build`)', (n) => {
    const path = fileURLToPath(new URL(`../json/${n}.schema.json`, import.meta.url));
    expect(existsSync(path), `${path} missing, run pnpm --filter @uma/schema build`).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(contractJsonSchema(n));
  });

  it('VeteranCapture schema snapshot (structure only)', () => {
    const s = contractJsonSchema('VeteranCapture') as {
      $schema: string;
      required: string[];
      properties: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
    };
    expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(s.required).toEqual([
      'schemaVersion',
      'captureId',
      'capturedAt',
      'agentVersion',
      'layoutVersion',
      'masterVersion',
      'fingerprint',
      'veteran',
      'fields',
    ]);
    expect(s.properties.veteran!.required).toEqual([
      'characterId',
      'outfitId',
      'rank',
      'rating',
      'epithet',
      'trainMode',
      'stats',
      'aptitudes',
      'skills',
      'sparks',
      'deck',
      'parents',
      'scenarioId',
      'career',
    ]);
    const apts = s.properties.veteran!.properties!.aptitudes as {
      properties: object;
      required: string[];
    };
    expect(Object.keys(apts.properties)).toEqual([...APT_KEYS]);
    expect(apts.required).toEqual([...APT_KEYS]);
  });

  it('vector inputs still validate against the exported schema shape (required keys present)', () => {
    const s = contractJsonSchema('VeteranCapture') as { required: string[] };
    const cap = baseCapture();
    for (const k of s.required) expect(cap).toHaveProperty(k);
    expect(vectorFile.vectors.length).toBeGreaterThanOrEqual(5);
  });
});
