/**
 * T15c (62): the REAL engine behind the worker surface (in-process; Comlink only adds structured
 * clone). Effective-context identity, the browser-local override applied in the worker, atomic
 * configure (T15b N1), rank provenance refusal, and the real ×1.3 calibration → apply → recalibrate
 * workflow on the committed, unchanged golden files (no planted truth passed in).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withBlueStatGainMultiplier, loadContext } from '@uma/engine';
import { createEngineApi, withBlueStatGainTable, type CalibrationOutput, type ContextInfo, type EngineResult, type WorkerOverride } from '../src/workers/engine.api.ts';
import { calibrationRoster, goldenRoster, goldenTargets, goldenTruth, masterBundle } from './fixtures.ts';

const ok = <T,>(r: EngineResult<T>): T => {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r.value;
};
const NOW = '2026-10-08T00:00:00.000Z';
const T = 240_000;
const syntheticOnly = () => ({ syntheticInheritance: goldenTruth().syntheticInheritance }) as never;
const golden = () => ({ bundle: masterBundle(), kind: 'golden-fixture' as const, golden: syntheticOnly() });
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

let base: ContextInfo;
let cal: CalibrationOutput;
beforeAll(() => {
  const api = createEngineApi();
  base = ok(api.configure(golden()));
  cal = ok(api.calibrate(calibrationRoster(), { nowIso: NOW, id: '01KGQZ0000G01DENCM00T15C11' }));
}, T);

const overrideFrom = (c: CalibrationOutput, id = '01KGQZ0000G01DENCM00T15C21'): WorkerOverride => {
  const s = c.report.suggestions.find((x) => x.rule === 'blueStatGain')!;
  return { id, rule: 'blueStatGain', proposed: [...s.proposed], baseFingerprint: base.baseFingerprint, sourceReportId: c.report.id, multiplier: s.multiplier };
};

describe('effective context identity', () => {
  it('is a SHA-256 digest over the exact effective inputs, deterministic, and distinct per context kind', () => {
    expect(base.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(base.baseFingerprint).toBe(base.fingerprint);
    expect(base.override).toBeNull();
    expect(ok(createEngineApi().configure(golden())).fingerprint).toBe(base.fingerprint);
    const prod = ok(createEngineApi().configure({ bundle: masterBundle(), kind: 'production' }));
    expect(prod.fingerprint).not.toBe(base.fingerprint);
    expect(prod.rulesVersion).toBe(base.rulesVersion); // same rules.version, different identity
  });
  it('same rules.version but different synthetic values or turns gives a different identity', () => {
    const t = goldenTruth().syntheticInheritance as { rulesOverrides: { blueStatGain: Record<string, unknown> }; inheritanceTurns: Record<string, { turns: number[] }> };
    const values = structuredClone(t); (values.rulesOverrides.blueStatGain as { '1': number })['1'] += 0.5;
    const turns = structuredClone(t); const k = Object.keys(turns.inheritanceTurns)[0]!; turns.inheritanceTurns[k]!.turns = [...turns.inheritanceTurns[k]!.turns, 60];
    const a = ok(createEngineApi().configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: { syntheticInheritance: values } as never }));
    const b = ok(createEngineApi().configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: { syntheticInheritance: turns } as never }));
    expect(a.rulesVersion).toBe(base.rulesVersion);
    expect(new Set([a.fingerprint, b.fingerprint, base.fingerprint]).size).toBe(3);
    const m2 = structuredClone(masterBundle()); m2.skills[0]!.name += ' (edited)';
    expect(ok(createEngineApi().configure({ bundle: m2, kind: 'golden-fixture', golden: syntheticOnly() })).fingerprint).not.toBe(base.fingerprint);
  });
  it('withBlueStatGainTable equals the engine withBlueStatGainMultiplier helper on the same values (no compounding helper of its own)', () => {
    const ctx = loadContext(masterBundle(), masterBundle().rules);
    const scaledRules = { ...masterBundle().rules, blueStatGain: { ...masterBundle().rules.blueStatGain, '1': 10, '2': 20, '3': 30 } };
    const c10 = loadContext(masterBundle(), scaledRules);
    const viaHelper = withBlueStatGainMultiplier(c10, 1.32);
    const viaTable = withBlueStatGainTable(c10, [10 * 1.32, 20 * 1.32, 30 * 1.32], 'S', 'rules-1+x');
    expect(viaTable.tables).toEqual(viaHelper.tables);
    expect(viaTable.unverifiedRules).toEqual(viaHelper.unverifiedRules);
    expect(viaTable.rules.blueStatGain.verified).toBe(false);
    expect(() => withBlueStatGainTable(ctx, [1, -1, 1], 'S', 'v')).toThrow(/finite and ≥ 0/);
    expect(() => withBlueStatGainTable(ctx, [1, Number.NaN, 1], 'S', 'v')).toThrow(/finite and ≥ 0/);
  });
});

describe('browser-local override in the worker', () => {
  it('REAL calibration of the unchanged ×1.3 roster proposes ~×1.32; applying it gives absolute proposed values, a new identity and verified:false', () => {
    expect(cal.report.stats.status).toBe('suggested');
    const s = cal.report.suggestions[0]!;
    expect(s.multiplier).toBeGreaterThanOrEqual(1.2);
    expect(s.multiplier).toBeLessThanOrEqual(1.4);
    expect(cal.context.fingerprint).toBe(base.fingerprint);
    const api = createEngineApi();
    const info = ok(api.configure({ ...golden(), override: overrideFrom(cal) }));
    expect(info.override).toMatchObject({ id: '01KGQZ0000G01DENCM00T15C21', proposed: s.proposed });
    expect(info.baseFingerprint).toBe(base.fingerprint);
    expect(info.fingerprint).not.toBe(base.fingerprint);
    expect(info.rulesVersion).not.toBe(base.rulesVersion);
    const b = info.effectiveRules.blueStatGain;
    expect([b['1'], b['2'], b['3']]).toEqual(s.proposed);
    expect(b.verified).toBe(false);
    expect(b.source).toMatch(/BROWSER-LOCAL override/);
    expect(b.source).toContain(cal.report.id);
    console.info(`[T15c worker] x1.3 roster: suggested ×${s.multiplier}; current ${s.current.map(r6).join('/')} → proposed ${s.proposed.map(r6).join('/')}`);
  }, T);
  it('recalibrating on the applied context does not compound: the next suggestion is relative to the applied table and near ×1', () => {
    const api = createEngineApi();
    const info = ok(api.configure({ ...golden(), override: overrideFrom(cal) }));
    const again = ok(api.calibrate(calibrationRoster(), { nowIso: NOW, id: '01KGQZ0000G01DENCM00T15C12' }));
    expect(again.context.fingerprint).toBe(info.fingerprint);
    expect(again.report.stats.selected).not.toBeNull();
    const m2 = again.report.stats.selected!.multiplier;
    expect(Math.abs(m2 - 1)).toBeLessThanOrEqual(0.05);
    const cur = again.report.stats.selected && again.report.suggestions[0] ? again.report.suggestions[0].current : null;
    if (cur) expect(cur).toEqual(cal.report.suggestions[0]!.proposed);
    // Configuring the SAME override twice yields the same identity and the same table (absolute values, not ×m again).
    const twice = ok(api.configure({ ...golden(), override: overrideFrom(cal) }));
    expect(twice.fingerprint).toBe(info.fingerprint);
    expect(twice.effectiveRules.blueStatGain).toEqual(info.effectiveRules.blueStatGain);
    console.info(`[T15c worker] recalibration on applied context: status ${again.report.stats.status}, selected ×${m2}`);
  }, T);
  it('an override bound to another base fingerprint is refused visibly and the base context stays in force', () => {
    const api = createEngineApi();
    const info = ok(api.configure({ ...golden(), override: { ...overrideFrom(cal), baseFingerprint: `sha256:${'0'.repeat(64)}` } }));
    expect(info.override).toBeNull();
    expect(info.overrideRejected).toMatch(/base context/);
    expect(info.fingerprint).toBe(base.fingerprint);
  });
  it('a synthetic-base override cannot configure production (its base fingerprint is the fixture context)', () => {
    const info = ok(createEngineApi().configure({ bundle: masterBundle(), kind: 'production', override: overrideFrom(cal) }));
    expect(info.override).toBeNull();
    expect(info.overrideRejected).toMatch(/base context/);
    expect(info.effectiveRules.blueStatGain['1']).toBe(0);
  });
  it('invalid override values are refused (negative / non-finite / unsupported rule)', () => {
    for (const bad of [{ proposed: [1, -1, 1] }, { proposed: [1, Number.NaN, 1] }, { rule: 'activation.blue' }]) {
      const info = ok(createEngineApi().configure({ ...golden(), override: { ...overrideFrom(cal), ...bad } as never }));
      expect(info.override).toBeNull();
      expect(info.overrideRejected).toBeTruthy();
    }
  });
  it('configure is atomic (T15b N1): a failing configure keeps the previous ctx/info pair', () => {
    const api = createEngineApi();
    const first = ok(api.configure({ ...golden(), override: overrideFrom(cal) }));
    const bad = api.configure({ bundle: { ...masterBundle(), skills: [{ id: 42 }] } as never, kind: 'production' });
    expect(bad.ok).toBe(false);
    const again = ok(api.calibrate([], { nowIso: NOW, id: '01KGQZ0000G01DENCM00T15C13' }));
    expect(again.context.fingerprint).toBe(first.fingerprint);
    const noGolden = api.configure({ bundle: masterBundle(), kind: 'golden-fixture' });
    expect(noGolden.ok).toBe(false);
    expect(ok(api.calibrate([], { nowIso: NOW, id: '01KGQZ0000G01DENCM00T15C14' })).context.fingerprint).toBe(first.fingerprint);
  });
});

describe('fit and rank carry the effective identity', () => {
  it('fit reports the identity it ran under; rank refuses a snapshot provenance for another identity (worker-side, not UI)', () => {
    const roster = goldenRoster();
    const g = goldenTruth().golden;
    const target = goldenTargets().find((t) => t.name === g.targetName)!;
    const input = { traineeOutfitId: g.traineeOutfitId, deck: g.planDeck, trainMode: g.trainMode, scenarioId: g.scenarioId };
    const api = createEngineApi();
    const info = ok(api.configure({ ...golden(), override: overrideFrom(cal) }));
    const fit = ok(api.fit(roster, { nowIso: NOW, id: '01KGQZ0000G01DENCM00T15CF1' }));
    expect(fit.contextFingerprint).toBe(info.fingerprint);
    // Same snapshot, provenance from the base context: refused.
    const wrong = api.rank(fit.snapshot, input, roster, target, { topK: 3, topN: 3 }, { contextFingerprint: base.fingerprint, eligibilityPolicy: info.eligibilityPolicy });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.name).toBe('ProvenanceMismatchError');
    const missing = api.rank(fit.snapshot, input, roster, target, { topK: 3, topN: 3 }, undefined as never);
    expect(missing.ok).toBe(false);
    const right = ok(api.rank(fit.snapshot, input, roster, target, { topK: 3, topN: 3 }, { contextFingerprint: info.fingerprint, eligibilityPolicy: info.eligibilityPolicy }));
    expect(right.results.length).toBeGreaterThan(0);
  }, T);
});
