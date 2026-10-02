/**
 * T08 golden dataset: schema validity, determinism, byte-identical web fixture copies, sizes.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMasterIds, fingerprint, RosterVeteran } from '@uma/schema';
import { FILES, FIXTURE_FILES, generateGolden } from '../../scripts/golden.ts';
import {
  calibrationRoster,
  GOLDEN_DIR,
  master,
  readText,
  roster,
  targets,
  truth,
  WEB_FIXTURES_DIR,
} from './load.ts';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const masterIndex = {
  characters: master.characters.map((c) => c.id),
  outfits: master.outfits.map((o) => o.id),
  skills: master.skills.map((s) => s.id),
  sparks: master.sparks.map((s) => s.id),
  cards: master.cards.map((c) => c.id),
  ranks: master.ranks.map((r) => r.id),
  scenarios: master.scenarios.map((s) => s.id),
};

describe('golden roster: schema and master data', () => {
  it.each([
    ['roster.json', roster],
    ['roster.calibration-x1.3.json', calibrationRoster],
  ])('%s has 260 schema-valid RosterVeterans with real master IDs', (_name, rows) => {
    expect(rows).toHaveLength(260);
    expect(truth.meta.rosterSize).toBe(260);
    for (const v of rows) {
      expect(RosterVeteran.safeParse(v).success).toBe(true);
      expect(v.id).toMatch(ULID);
      expect(checkMasterIds(v, masterIndex)).toEqual([]);
    }
    expect(new Set(rows.map((v) => v.id)).size).toBe(260);
    expect(new Set(rows.map((v) => v.fingerprint)).size).toBe(260);
  });

  it('every fingerprint equals the shared @uma/schema fingerprint function', async () => {
    for (const rows of [roster, calibrationRoster]) {
      for (const v of rows) expect(await fingerprint(v)).toBe(v.fingerprint);
    }
  });

  it('rank is the highest master rank whose minRating the rating reaches', () => {
    const ranks = [...master.ranks].sort((a, b) => b.minRating - a.minRating);
    for (const v of roster) expect(v.rank).toBe(ranks.find((r) => r.minRating <= v.rating)!.id);
  });

  it('truth.json names the master version and seed it was generated with', () => {
    expect(truth.meta.masterVersion).toBe(master.version);
    expect(truth.meta.seed).toBe(20260929);
    expect(truth.meta.generatedAt).toBe('2026-09-29T00:00:00.000Z');
  });
});

describe('golden target golden-cm-1', () => {
  it('targets.json is a valid CmTarget[] with the 70 §2 requirements', () => {
    expect(targets).toHaveLength(1);
    const t = targets[0]!;
    expect(t.id).toMatch(ULID);
    expect(t.name).toBe('golden-cm-1');
    expect(truth.golden.targetName).toBe('golden-cm-1');
    expect(truth.golden.targetId).toBe(t.id);
    expect(t.course).toMatchObject({ surface: 'turf', distance: 'medium' });
    expect(t.style).toBe('pace');
    expect(t.minStats).toEqual({ spd: 1100, sta: 800 });
    expect(t.minAptitudes).toEqual({ turf: 'A', medium: 'A', pace: 'A' });
    expect(t.requiredSkills).toEqual([truth.golden.skillX]);
    expect(master.skills.some((s) => s.id === truth.golden.skillX)).toBe(true);
  });
});

describe('determinism', () => {
  it('generating twice in-process gives byte-identical output equal to the committed files', async () => {
    const a = await generateGolden(master);
    const b = await generateGolden(master);
    expect(Object.keys(a).sort()).toEqual(Object.values(FILES).sort());
    for (const name of Object.keys(a)) {
      expect(sha(a[name]!)).toBe(sha(b[name]!));
      expect(a[name]).toBe(readText(GOLDEN_DIR, name));
    }
  }, 60_000);

  it('truth.json records the sha256 of the files it describes', () => {
    expect(truth.files['roster.json']).toBe(sha(readText(GOLDEN_DIR, 'roster.json')));
    expect(truth.files['targets.json']).toBe(sha(readText(GOLDEN_DIR, 'targets.json')));
    expect(truth.calibration.sha256).toBe(sha(readText(GOLDEN_DIR, truth.calibration.file)));
  });
});

describe('apps/web/fixtures copies', () => {
  it('are regular files (not symlinks), byte-identical to the golden files', () => {
    for (const [name, copy] of Object.entries(FIXTURE_FILES)) {
      const path = join(WEB_FIXTURES_DIR, copy);
      expect(lstatSync(path).isSymbolicLink()).toBe(false);
      expect(readText(WEB_FIXTURES_DIR, copy)).toBe(readText(GOLDEN_DIR, name));
    }
    // The web client maps /api/v1/<x> to /fixtures/<x>.json (apps/web/src/api/client.ts).
    expect(FIXTURE_FILES['roster.json']).toBe('roster.json');
    expect(FIXTURE_FILES['targets.json']).toBe('cm-targets.json');
  });

  it('file sizes stay reasonable for the repo and fixture mode', () => {
    let total = 0;
    for (const name of Object.values(FILES)) {
      const bytes = statSync(join(GOLDEN_DIR, name)).size;
      expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
      total += bytes;
    }
    for (const copy of Object.values(FIXTURE_FILES))
      total += statSync(join(WEB_FIXTURES_DIR, copy)).size;
    expect(total).toBeLessThan(5 * 1024 * 1024);
  });
});

describe('golden-context.ts is browser-safe (S1)', () => {
  /** Runtime (non-type) import specifiers of a TS file; `import type` / `export type` are erased. */
  function runtimeImports(file: string): string[] {
    const src = readFileSync(file, 'utf8');
    const out: string[] = [];
    const re = /^\s*(import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms;
    for (const m of src.matchAll(re)) out.push(m[2]!);
    for (const m of src.matchAll(/^\s*import\s+'([^']+)'/gm)) out.push(m[1]!);
    for (const m of src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push(m[1]!);
    return out;
  }
  const workspace: Record<string, string> = {
    '@uma/schema': join(import.meta.dirname, '../../../schema/src/index.ts'),
  };

  it('its runtime import graph has no node:*, prettier, published-bundle or generator I/O', () => {
    const start = resolve(import.meta.dirname, '../../scripts/golden-context.ts');
    const seen = new Set<string>();
    const bare = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
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
    expect(files.some((f) => f.endsWith('/engine/src/index.ts'))).toBe(true);
    for (const f of files) {
      expect(f).not.toMatch(/scripts\/(golden|published-bundle|smoke)\.ts$/);
      expect(f).not.toMatch(/\/test\//);
    }
    expect([...bare].sort()).toEqual(['zod']);
    for (const f of seen)
      expect(readFileSync(f, 'utf8')).not.toMatch(/from 'node:|from 'prettier'/);
    // Review round 2 S2: the diagnostic lives in scripts/ but is not part of the browser graph.
    for (const f of files) expect(f).not.toMatch(/golden-diagnostic\.ts$/);
  });

  it('review round 2 S2: no scripts/ file imports test code; golden-diagnostic.ts imports src only', () => {
    const scriptsDir = resolve(import.meta.dirname, '../../scripts');
    for (const name of ['golden.ts', 'golden-context.ts', 'golden-diagnostic.ts']) {
      const all = [...readFileSync(join(scriptsDir, name), 'utf8').matchAll(/from\s+'([^']+)'/g)];
      for (const m of all) expect(m[1]).not.toMatch(/(^|\/)test\//);
    }
    const diag = runtimeImports(join(scriptsDir, 'golden-diagnostic.ts'));
    expect(diag.filter((s) => s.startsWith('.'))).toEqual(['../src/index.ts']);
    expect(diag.filter((s) => !s.startsWith('.')).sort()).toEqual(['@uma/schema']);
  });
});
