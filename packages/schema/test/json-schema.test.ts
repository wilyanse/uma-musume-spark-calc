import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  APT_KEYS,
  CONTRACTS,
  contractJsonSchema,
  MODEL_SNAPSHOT_KINDS,
  ModelSnapshot,
  type ContractName,
} from '../src/index.ts';
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

  it('ModelSnapshot kind: JSON Schema enum equals the zod enum; Ajv agrees with zod (ADR-0002)', () => {
    const s = contractJsonSchema('ModelSnapshot') as {
      properties: { kind: { enum?: string[]; type?: string } };
    };
    expect(s.properties.kind).toEqual({ type: 'string', enum: [...MODEL_SNAPSHOT_KINDS] });
    const validate = new Ajv2020({ strict: true, validateFormats: false }).compile(s);
    const per = { coef: [0.1], intercept: 1, sigma: 2 };
    const base = {
      id: '01J8Z3K4M5N6P7Q8R9S0T1V2W3',
      masterVersion: 'v1',
      trainedAt: '2026-09-29T08:00:00Z',
      nSamples: 10,
      params: {
        features: ['f'],
        perStat: { spd: per, sta: per, pow: per, gut: per, wit: per },
        residualCov: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
        skillAcquire: { independent: { '*': { a: 1, b: 1 } }, manual: {} },
        holdout: { mae: { spd: 1, sta: 1, pow: 1, gut: 1, wit: 1 }, coverage80: 0.8 },
      },
    };
    for (const kind of [...MODEL_SNAPSHOT_KINDS, 'training-v3', 'other']) {
      const v = { ...base, kind };
      expect(validate(v), kind).toBe(ModelSnapshot.safeParse(v).success);
    }
    expect(validate({ ...base, kind: 'training-v1' })).toBe(true);
    expect(validate({ ...base, kind: 'training-v2' })).toBe(true);
    expect(validate({ ...base, kind: 'training-v3' })).toBe(false);
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

  describe('captures validate against the exported JSON Schema (ajv, draft 2020-12)', () => {
    // Formats (date-time, date) are checked by zod; ajv-formats is not a dependency.
    const ajv = new Ajv2020({ strict: true, validateFormats: false });
    const validate = ajv.compile(contractJsonSchema('VeteranCapture'));
    const vectors = vectorFile.vectors;

    it('has at least 5 vectors', () => expect(vectors.length).toBeGreaterThanOrEqual(5));
    it.each(vectors.map((v) => [v.name, v] as const))('%s: accepted', (_n, v) => {
      const cap = { ...baseCapture(), veteran: v.input, fingerprint: v.sha256 };
      expect(validate(cap), JSON.stringify(validate.errors)).toBe(true);
    });
    it('rejects structural violations (missing aptitude, stat 0, 5 deck slots, extra key)', () => {
      const bad = (mutate: (c: ReturnType<typeof baseCapture>) => void) => {
        const c = baseCapture();
        mutate(c);
        return validate(c);
      };
      expect(
        bad((c) => delete (c.veteran.aptitudes as Partial<typeof c.veteran.aptitudes>).end),
      ).toBe(false);
      expect(bad((c) => (c.veteran.stats.spd = 0))).toBe(false);
      expect(bad((c) => c.veteran.deck.pop())).toBe(false);
      expect(bad((c) => ((c as Record<string, unknown>).extra = 1))).toBe(false);
      expect(bad(() => {})).toBe(true);
    });
  });
});
