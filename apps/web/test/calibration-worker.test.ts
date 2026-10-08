/**
 * T15b (61 §Worker boundary): the REAL `calibrateRules` behind the worker surface, run in-process
 * (Comlink only adds structured clone; the browser path is exercised in e2e/calibration.spec.ts).
 * Inputs: the committed, unchanged T08 golden rosters and published master. The planted ×1.3 is
 * never passed in: the golden context is built from `syntheticInheritance` alone.
 */
import { describe, expect, it } from 'vitest';
import { createEngineApi, type CalibrationOutput, type EngineResult } from '../src/workers/engine.api.ts';
import { calibrationRoster, goldenRoster, goldenTruth, masterBundle } from './fixtures.ts';

const ok = <T,>(r: EngineResult<T>): T => {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r.value;
};
const NOW = '2026-10-08T00:00:00.000Z';
const ID = '01KGQZ0000G01DENCM00T15B01';
const T = 120_000;
/** Only the documented synthetic inheritance inputs: no `latent`, no `calibration` multiplier. */
const syntheticOnly = () => ({ syntheticInheritance: goldenTruth().syntheticInheritance });
const strip = (o: CalibrationOutput) => ({ ...o, report: { ...o.report, runtime: null } });

describe('worker calibrate (real @uma/engine calibrateRules)', () => {
  it('is a typed NotConfiguredError before configure', () => {
    const r = createEngineApi().calibrate([], { nowIso: NOW });
    expect(r.ok ? 'ok' : r.error.name).toBe('NotConfiguredError');
  });

  it('synthetic golden context: planted ×1.3 roster yields an unapplied suggestion in [1.2, 1.4]', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: syntheticOnly() as never }));
    const roster = calibrationRoster();
    const before = JSON.stringify(roster);
    const out = ok(api.calibrate(roster, { nowIso: NOW, id: ID }));
    const r = out.report;
    expect(r.kind).toBe('calibration-v1');
    expect(r.id).toBe(ID);
    expect(r.generatedAt).toBe(NOW);
    expect(out.context.kind).toBe('golden-fixture');
    expect(out.context.synthetic).toBe(true);
    expect(out.context.overrides.map((o) => o.rule)).toContain('blueStatGain');
    expect(r.stats.status).toBe('suggested');
    const m = r.stats.selected!.multiplier;
    expect(m).toBeGreaterThanOrEqual(1.2);
    expect(m).toBeLessThanOrEqual(1.4);
    const s = r.suggestions.find((x) => x.rule === 'blueStatGain')!;
    expect(s.multiplier).toBe(m);
    expect(s.applied).toBe(false);
    // Seeded default split (no stored split from truth is passed).
    expect(r.split.source).toBe('seeded');
    expect(JSON.stringify(roster)).toBe(before);
    console.info(`[T15b worker] x1.3 seeded: ${r.status}/${r.stats.status} m=${m} trainCv=${r.stats.trainCvSelected?.multiplier} boot=${r.stats.bootstrap?.p05}/${r.stats.bootstrap?.p50}/${r.stats.bootstrap?.p95} split=${r.split.trainIds.length}/${r.split.holdoutIds.length}`);
  }, T);

  it('the worker never forwards truth fields: a full truth object gives the same report as syntheticInheritance only', () => {
    const a = createEngineApi();
    ok(a.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: syntheticOnly() as never }));
    const b = createEngineApi();
    // Poison the planted calibration metadata: the estimator must not read it.
    const poisoned = { ...goldenTruth(), calibration: { blueStatGainMultiplier: 9 }, latent: null };
    ok(b.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: poisoned as never }));
    const ra = ok(a.calibrate(calibrationRoster(), { nowIso: NOW, id: ID }));
    const rb = ok(b.calibrate(calibrationRoster(), { nowIso: NOW, id: ID }));
    expect(strip(rb)).toEqual(strip(ra));
  }, T);

  it('production placeholder rules: nonidentifiable, no suggestion, full aptitude likelihood null', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    const out = ok(api.calibrate(calibrationRoster(), { nowIso: NOW, id: ID }));
    const r = out.report;
    expect(out.context.kind).toBe('production');
    expect(out.context.synthetic).toBe(false);
    expect(out.context.overrides).toEqual([]);
    expect(r.status).not.toBe('complete');
    expect(r.stats.status).toBe('nonidentifiable');
    expect(r.stats.selected).toBeNull();
    expect(r.suggestions).toEqual([]);
    expect(r.aptitude.fullLikelihood).toBe('zero-probability-observed');
    expect(r.aptitude.logLik).toBeNull();
    expect(r.aptitude.impossible).toBeGreaterThan(0);
    expect(r.notCalibrated.some((n) => n.rule === 'blueStatGain' && n.placeholder)).toBe(true);
    console.info(`[T15b worker] production: ${r.status}/${r.stats.status} apt=${r.aptitude.status}/${r.aptitude.fullLikelihood} impossible=${r.aptitude.impossible} reasons=${r.stats.nonidentifiable?.reasons.length}`);
  }, T);

  it('calibration is read-only: the active context and a later fit are unchanged', () => {
    const api = createEngineApi();
    const info = ok(api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: syntheticOnly() as never }));
    const roster = goldenRoster();
    const fitA = ok(api.fit(roster, { nowIso: NOW, id: ID }));
    ok(api.calibrate(roster, { nowIso: NOW, id: ID }));
    const fitB = ok(api.fit(roster, { nowIso: NOW, id: ID }));
    expect(fitB.snapshot).toEqual(fitA.snapshot);
    const again = ok(api.calibrate(roster, { nowIso: NOW, id: ID }));
    expect(again.context.rulesVersion).toBe(info.rulesVersion);
    expect(again.context.masterVersion).toBe(info.masterVersion);
  }, T);

  it('rejects a report id that is not a ULID and an invalid clock (candidate snapshots need a valid ULID)', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    const a = api.calibrate([], { nowIso: NOW, id: 'not-a-ulid' });
    expect(a.ok ? 'ok' : `${a.error.name}:${'code' in a.error ? a.error.code : ''}`).toBe('ModelInputError:bad-id');
    const b = api.calibrate([], { nowIso: 'yesterday' });
    expect(b.ok ? 'ok' : `${b.error.name}:${'code' in b.error ? b.error.code : ''}`).toBe('ModelInputError:bad-now');
  });

  it('a bad roster is a typed engine error, not a throw', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    const v = goldenRoster()[0]!;
    const r = api.calibrate([v, v], { nowIso: NOW });
    expect(r.ok ? 'ok' : r.error.name).toBe('ModelInputError');
  });

  it('an empty roster is a successful (unavailable/insufficient) diagnostic outcome', () => {
    const api = createEngineApi();
    ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    const r = ok(api.calibrate([], { nowIso: NOW, id: ID })).report;
    expect(r.population.used).toBe(0);
    expect(r.stats.status).toBe('insufficient-data');
    expect(r.suggestions).toEqual([]);
  });
});
