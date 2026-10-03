/**
 * The engine entry point stays pure and browser-safe after T06: no `node:*`, no DOM, no network
 * and no runtime import of docs/reference, scripts or test code (50 intro). Also checks that the
 * 50 §1 functions and the T06 public types are exported from `src/index.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as engine from '../../src/index.ts';

function runtimeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms))
    out.push(m[2]!);
  for (const m of src.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push(m[1]!);
  for (const m of src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push(m[1]!);
  return out;
}

describe('engine entry point (T06)', () => {
  it('runtime import graph: src only, bare deps limited to zod; no node/DOM/network APIs', () => {
    const start = resolve(import.meta.dirname, '../../src/index.ts');
    const workspace: Record<string, string> = {
      '@uma/schema': join(import.meta.dirname, '../../../schema/src/index.ts'),
    };
    const seen = new Set<string>();
    const bare = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of runtimeImports(f)) {
        if (spec.startsWith('.')) stack.push(resolve(dirname(f), spec));
        else if (workspace[spec]) stack.push(workspace[spec]);
        else bare.add(spec);
      }
    }
    const files = [...seen].map((f) => f.replace(/\\/g, '/'));
    for (const name of ['model/fit.ts', 'predict/index.ts', 'rank/index.ts', 'linalg.ts'])
      expect(files.some((f) => f.endsWith(`/engine/src/${name}`))).toBe(true);
    for (const f of files) {
      expect(f).not.toMatch(/\/(test|scripts|bench|docs)\//);
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(
        /from 'node:|\bprocess\.|\bdocument\.|\bwindow\.|\bfetch\(|XMLHttpRequest/,
      );
      expect(src).not.toMatch(/Math\.random|Date\.now\(/);
    }
    expect([...bare].sort()).toEqual(['zod']);
  });

  it('exports the 50 §1 API and the T06 typed errors', () => {
    for (const fn of ['fitTrainingModel', 'predictChild', 'scoreTarget', 'rankPairs'] as const)
      expect(typeof engine[fn]).toBe('function');
    for (const e of [
      'RefitRequiredError',
      'InsufficientDataError',
      'ModelInputError',
      'ScoreRequiresSamplesError',
      'SkillPosteriorError',
      'NumericError',
    ] as const)
      expect(typeof engine[e]).toBe('function');
    expect(engine.MODEL_KIND).toBe('training-v2');
  });
});
