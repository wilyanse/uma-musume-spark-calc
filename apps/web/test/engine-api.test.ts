/**
 * The REAL engine behind the worker surface (run in-process here; Comlink only adds structured
 * clone). Production vs golden-fixture context, typed errors, immutability, and the planted golden
 * best pair under the clearly labelled synthetic golden context.
 */
import { describe, expect, it } from 'vitest';
import type { ModelSnapshot } from '@uma/schema';
import { createEngineApi, type EngineResult } from '../src/workers/engine.api.ts';
import { goldenRoster, goldenTargets, goldenTruth, masterBundle } from './fixtures.ts';

const ok = <T,>(r: EngineResult<T>): T => {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r.value;
};
const NOW = '2026-10-01T00:00:00.000Z';
const ID = '01KGQZ0000G01DENCM0000T13A';

describe('engine worker api (real @uma/engine)', () => {
  const truth = goldenTruth();

  it('production context uses the published rules verbatim and reports them unverified', () => {
    const api = createEngineApi();
    const info = ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    expect(info.kind).toBe('production');
    expect(info.overrides).toEqual([]);
    expect(info.unverifiedRules.length).toBeGreaterThan(0);
    expect(info.unverifiedRules).toContain('blueStatGain');
    expect(info.masterVersion).toBe(masterBundle().version);
  });

  it('golden-fixture context is labelled with its synthetic overrides', () => {
    const api = createEngineApi();
    const info = ok(api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: truth }));
    expect(info.kind).toBe('golden-fixture');
    expect(info.overrides[0]!.rule).toBe('blueStatGain');
    expect(info.overrides[0]!.source).toMatch(/SYNTHETIC/);
    expect(info.overrides.some((o) => o.rule.startsWith('inheritanceTurns('))).toBe(true);
  });

  it('a corrupt master file is a MasterSchemaError, not a crash', () => {
    const api = createEngineApi();
    const r = api.configure({ bundle: { ...masterBundle(), skills: [{ id: 42 }] } as never, kind: 'production' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.name).toBe('MasterSchemaError');
  });

  it('fit before configure is a typed NotConfiguredError', () => {
    const r = createEngineApi().fit([], { nowIso: NOW });
    expect(r.ok ? 'ok' : r.error.name).toBe('NotConfiguredError');
  });

  it('insufficient data is the engine InsufficientDataError (no UI threshold)', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    const r = api.fit(goldenRoster().slice(0, 3), { nowIso: NOW, id: ID });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.name === 'InsufficientDataError') {
      expect(r.error.train).toBeLessThan(5);
    } else throw new Error('expected InsufficientDataError');
  });

  it('legacy training-v1 is refused with reason legacy-kind and is not relabelled', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: truth }));
    const roster = goldenRoster();
    const fit = ok(api.fit(roster, { nowIso: NOW, id: ID }));
    const legacy = { ...fit.snapshot, kind: 'training-v1' } as ModelSnapshot;
    const g = truth.golden;
    const target = goldenTargets()[0]!;
    const r = api.rank(legacy, { traineeOutfitId: g.traineeOutfitId, deck: g.planDeck, trainMode: g.trainMode, scenarioId: g.scenarioId }, roster, target, { topK: 5, topN: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.name === 'RefitRequiredError') {
      expect(r.error.reason).toBe('legacy-kind');
      expect(r.error.kind).toBe('training-v1');
    } else throw new Error('expected RefitRequiredError');
    expect(legacy.kind).toBe('training-v1');
  });

  it('fits training-v2 deterministically and ranks the planted golden best pair #1 without mutating inputs', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: truth }));
    const roster = goldenRoster();
    const before = JSON.stringify(roster);
    const fit = ok(api.fit(roster, { nowIso: NOW, id: ID }));
    expect(fit.snapshot.kind).toBe('training-v2');
    expect(fit.snapshot.trainedAt).toBe(NOW);
    expect(fit.summary.holdout.coverage.cells).toBeGreaterThan(0);
    const again = ok(api.fit(roster, { nowIso: NOW, id: ID }));
    expect(again.snapshot).toEqual(fit.snapshot);

    const g = truth.golden;
    const target = goldenTargets().find((t) => t.name === g.targetName)!;
    const progress: { phase: string; done: number; total: number }[] = [];
    const res = ok(
      api.rank(
        fit.snapshot,
        { traineeOutfitId: g.traineeOutfitId, deck: g.planDeck, trainMode: g.trainMode, scenarioId: g.scenarioId },
        roster,
        target,
        {},
        (p) => progress.push(p),
      ),
    );
    expect([...res.results[0]!.parents].sort()).toEqual([...g.bestPair.parents].sort());
    const top10 = res.results.slice(0, 10).map((r) => [...r.parents].sort().join('|'));
    expect(top10).not.toContain([...g.trapPair.parents].sort().join('|'));
    expect(res.evaluatedPairs).toBeGreaterThan(30000);
    expect(progress.at(-1)).toMatchObject({ phase: 'precise' });
    expect(progress.some((p) => p.phase === 'fast' && p.done === p.total)).toBe(true);
    expect(JSON.stringify(roster)).toBe(before);
  }, 120_000);
});
