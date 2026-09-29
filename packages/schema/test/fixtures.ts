import vectors from './fingerprint.vectors.json' with { type: 'json' };
import type { VeteranCapture } from '../src/index.ts';

export const baseVeteran = (): VeteranCapture['veteran'] =>
  structuredClone(vectors.vectors[0]!.input) as VeteranCapture['veteran'];

export const baseCapture = (): VeteranCapture => ({
  schemaVersion: 1,
  captureId: '01J8Z3K4M5N6P7Q8R9S0T1V2W3',
  capturedAt: '2026-09-29T08:00:00Z',
  agentVersion: '0.1.0',
  layoutVersion: 'global-2026-09',
  masterVersion: 'test-1',
  fingerprint: vectors.vectors[0]!.sha256,
  veteran: baseVeteran(),
  fields: [
    {
      path: '/stats/spd',
      rawText: '1100',
      value: 1100,
      confidence: 0.99,
      status: 'ok',
      candidates: [],
      cropKey: null,
    },
  ],
});
