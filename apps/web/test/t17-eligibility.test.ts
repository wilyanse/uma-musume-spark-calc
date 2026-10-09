/**
 * T17 (63 §Model/cache semantics, ADR-0003): the training-eligibility policy changed (capture
 * status instead of the raw 0.9 score), so fits made under the old policy must be refitted once,
 * without relabelling snapshots or changing training-v2 numerics, and without weakening the T15c
 * rule that browser-local overridden models never touch the snapshot API.
 *
 * Worker calls use the REAL engine in-process (createEngineApi) on the committed, unchanged golden
 * files; in-memory edits of those rows are labelled synthetic test inputs (not a real roster).
 * ensureModel runs against a MOCK DataSource and a FAKE engine client returning real fit output.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ModelSnapshot, RosterVeteran } from '@uma/schema';
import { TRAINING_ELIGIBILITY_POLICY } from '@uma/engine';
import { createEngineApi, type ContextInfo, type EngineResult, type FitOutput, type WorkerOverride } from '../src/workers/engine.api.ts';
import { decideModel, fitRecordKey, loadFitRecord, saveFitRecord, FIT_REASON_TEXT, type FitRecord } from '../src/lib/model.ts';
import {
  LOCAL_MODEL_SCHEMA,
  localModelKey,
  localModelMismatch,
  overrideKey,
  parseLocalModel,
  readLocalModel,
  writeOverrideState,
} from '../src/lib/rulesOverride.ts';
import { ensureModel, type EngineContextState } from '../src/app/engine.ts';
import { rosterIdentity } from '../src/lib/calibration.ts';
import { memoryStore } from '../src/lib/storage.ts';
import { fakeEngine, mockSource, NOW } from './harness.tsx';
import { goldenRoster, goldenTargets, goldenTruth, masterBundle, masterData } from './fixtures.ts';

const ok = <T,>(r: EngineResult<T>): T => {
  if (!r.ok) throw new Error(`${r.error.name}: ${r.error.message}`);
  return r.value;
};
const T = 240_000;
const FP = (c: string) => `sha256:${c.repeat(64)}`;
const roster = goldenRoster();
const truth = goldenTruth() as unknown as { roster: { lowConfidenceIds: string[] }; golden: { traineeOutfitId: string; planDeck: never; trainMode: 'independent'; scenarioId: string; targetName: string } };

let info: ContextInfo;
let fit: FitOutput;
beforeAll(() => {
  const api = createEngineApi();
  info = ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
  fit = ok(api.fit(roster, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T17F01' }));
}, T);

describe('worker reports the eligibility policy with every context and fit', () => {
  it('configure and fit carry the engine policy; the snapshot kind and numerics stay training-v2', () => {
    expect(TRAINING_ELIGIBILITY_POLICY).toBe('capture-status-v1');
    expect(info.eligibilityPolicy).toBe(TRAINING_ELIGIBILITY_POLICY);
    expect(fit.eligibilityPolicy).toBe(TRAINING_ELIGIBILITY_POLICY);
    expect(fit.snapshot.kind).toBe('training-v2');
  });

  it('the status flag reaches the real worker fit (synthetic edit of golden low-confidence rows)', () => {
    const low = new Set(truth.roster.lowConfidenceIds);
    const flagged: RosterVeteran[] = roster.map((v) => (low.has(v.id) ? { ...v, hasLowConfidence: false } : v));
    const api = createEngineApi();
    api.configure({ bundle: masterBundle(), kind: 'production' });
    const again = ok(api.fit(flagged, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T17F02' }));
    expect(fit.summary.excluded['low-confidence']).toBe(low.size);
    expect(again.summary.excluded['low-confidence'] ?? 0).toBe(0);
    expect(again.summary.eligible).toBeGreaterThan(fit.summary.eligible);
  }, T);

  it('rank refuses a snapshot whose provenance lacks or differs in eligibility policy (worker-side)', () => {
    const g = truth.golden;
    const target = goldenTargets().find((t) => t.name === g.targetName)!;
    const input = { traineeOutfitId: g.traineeOutfitId, deck: g.planDeck, trainMode: g.trainMode, scenarioId: g.scenarioId };
    const api = createEngineApi();
    const i = ok(api.configure({ bundle: masterBundle(), kind: 'production' }));
    const f = ok(api.fit(roster, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T17F03' }));
    const opts = { topK: 2, topN: 2 };
    const missing = api.rank(f.snapshot, input, roster, target, opts, { contextFingerprint: i.fingerprint } as never);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatchObject({ name: 'ProvenanceMismatchError', message: expect.stringMatching(/eligibility/) });
    const old = api.rank(f.snapshot, input, roster, target, opts, { contextFingerprint: i.fingerprint, eligibilityPolicy: 'legacy-min-confidence-0.9' });
    expect(old.ok).toBe(false);
    const right = ok(api.rank(f.snapshot, input, roster, target, opts, { contextFingerprint: i.fingerprint, eligibilityPolicy: i.eligibilityPolicy }));
    expect(right.results.length).toBeGreaterThan(0);
  }, T);
});

describe('fit record provenance (base context, server snapshots)', () => {
  const snap = (over: Partial<ModelSnapshot> = {}): ModelSnapshot =>
    ({ id: 'S1', kind: 'training-v2', masterVersion: 'm1', trainedAt: 'x', nSamples: 10, params: {} as never, ...over }) as ModelSnapshot;
  const base = { rosterEtag: '"e1"', rosterIdentity: 'r1', masterVersion: 'm1', context: 'production', contextFingerprint: FP('a'), eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY };
  const rec = (over: Partial<FitRecord> = {}): FitRecord => ({ v: 3, snapshotId: 'S1', rosterEtag: '"e1"', rosterIdentity: 'r1', masterVersion: 'm1', context: 'production', contextFingerprint: FP('a'), eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY, ...over });

  it('reuses only under the same eligibility policy; another policy refits with an explicit reason', () => {
    expect(decideModel({ ...base, v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ action: 'use' });
    expect(decideModel({ ...base, v2: snap(), anyLatest: snap(), record: rec({ eligibilityPolicy: 'other' }) })).toMatchObject({ action: 'fit', reason: 'eligibility-changed' });
    expect(FIT_REASON_TEXT['eligibility-changed']).toMatch(/eligibility/);
  });

  it('a pre-T17 (v2) record with otherwise identical provenance is read as the old policy and refits once', () => {
    const s = memoryStore();
    const old = { v: 2, snapshotId: 'S1', rosterEtag: '"e1"', rosterIdentity: 'r1', masterVersion: 'm1', context: 'production', contextFingerprint: FP('a') };
    s.setItem(fitRecordKey('api'), JSON.stringify(old));
    const r = loadFitRecord(s, 'api');
    expect(r).toMatchObject({ snapshotId: 'S1', eligibilityPolicy: null });
    expect(decideModel({ ...base, v2: snap(), anyLatest: snap(), record: r })).toMatchObject({ action: 'fit', reason: 'eligibility-changed' });
    saveFitRecord(s, 'api', rec());
    expect(loadFitRecord(s, 'api')).toEqual(rec());
    s.setItem(fitRecordKey('api'), JSON.stringify({ ...rec(), eligibilityPolicy: 7 }));
    expect(loadFitRecord(s, 'api')).toBeNull();
  });

  it('ensureModel: an old-policy record forces exactly one refit + POST, then reuses; snapshot kind is never relabelled', async () => {
    const store = memoryStore();
    const stored = { ...fit.snapshot, id: '01KGQZ0000G01DENCM00T17S00' };
    // The pre-T17 browser record: same roster ETag/content, master and context — only the policy is unknown.
    store.setItem(fitRecordKey('api'), JSON.stringify({ v: 2, snapshotId: stored.id, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), masterVersion: masterData().version, context: 'production', contextFingerprint: info.fingerprint }));
    const data = { roster, snapshot: stored as ModelSnapshot | null };
    const posted: ModelSnapshot[] = [];
    const { src } = mockSource(data, { latestSnapshot: async () => data.snapshot, storeSnapshot: async (s) => { posted.push(s); data.snapshot = s; return s; } });
    let fits = 0;
    const engine = fakeEngine({ fit: async () => { fits++; return { ok: true, value: fit }; } });
    await engine.configure({} as never);
    const services = { source: src, engine, store, now: () => NOW, loadMaster: async () => masterData() };
    const ctx: EngineContextState = { ...info, storedRaw: null, storedRevision: 0, storedOverride: null, overrideProblem: null };
    const args = { roster, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), masterVersion: masterData().version, ctx };
    const first = await ensureModel(services, new QueryClient(), args);
    expect(first).toMatchObject({ status: 'ready', local: false, provenance: { contextFingerprint: info.fingerprint, eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY } });
    expect(first.status === 'ready' && first.fitted?.reason).toBe('eligibility-changed');
    expect(fits).toBe(1);
    expect(posted.map((p) => p.id)).toEqual([fit.snapshot.id]);
    expect(loadFitRecord(store, 'api')).toMatchObject({ v: 3, snapshotId: fit.snapshot.id, eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY });
    expect(stored.kind).toBe('training-v2');
    const second = await ensureModel(services, new QueryClient(), args);
    expect(second).toMatchObject({ status: 'ready', fitted: null });
    expect(fits).toBe(1);
    expect(posted).toHaveLength(1);
  }, T);

  it('ensureModel never stores a fit the worker ran under a different eligibility policy', async () => {
    const store = memoryStore();
    const { src, calls } = mockSource({ roster });
    const engine = fakeEngine({ fit: async () => ({ ok: true, value: { ...fit, eligibilityPolicy: 'some-other-policy' } }) });
    await engine.configure({} as never);
    const services = { source: src, engine, store, now: () => NOW, loadMaster: async () => masterData() };
    const ctx: EngineContextState = { ...info, storedRaw: null, storedRevision: 0, storedOverride: null, overrideProblem: null };
    const out = await ensureModel(services, new QueryClient(), { roster, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), masterVersion: masterData().version, ctx });
    expect(out.status).toBe('error');
    expect(calls.some((c) => c.method === 'storeSnapshot')).toBe(false);
    expect(store.getItem(fitRecordKey('api'))).toBeNull();
  });
});

describe('browser-local overridden model envelopes (T15c) under the new policy', () => {
  const OVR = '01KGQZ0000G01DENCM00T17O01';
  const want = { overrideId: OVR, contextFingerprint: FP('b'), baseFingerprint: FP('a'), masterVersion: 'm1', rosterEtag: '"e1"', rosterIdentity: 'r', eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY };

  it('a pre-T17 (v1) envelope parses but never matches: refit, not reuse', () => {
    const snapshot = { ...fit.snapshot, masterVersion: 'm1' };
    const v1 = { schema: LOCAL_MODEL_SCHEMA, v: 1, mode: 'fixture', overrideId: OVR, contextFingerprint: FP('b'), baseFingerprint: FP('a'), masterVersion: 'm1', rosterEtag: '"e1"', rosterIdentity: 'r', snapshot, savedAt: NOW.toISOString() };
    const r = parseLocalModel(JSON.stringify(v1), 'fixture');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.env.eligibilityPolicy).toBeNull();
    expect(localModelMismatch(r.env, want)).toMatch(/eligibility policy/);
    const v2 = parseLocalModel(JSON.stringify({ ...v1, v: 2, eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY }), 'fixture');
    expect(v2.status === 'ok' && localModelMismatch(v2.env, want)).toBeNull();
    expect(parseLocalModel(JSON.stringify({ ...v1, v: 2 }), 'fixture')).toMatchObject({ status: 'invalid' });
  });

  it('ensureModel under an override refits a v1 envelope locally and never reads or writes the snapshot API', async () => {
    const store = memoryStore();
    const o: WorkerOverride = { id: OVR, rule: 'blueStatGain', proposed: [1, 2, 3], baseFingerprint: info.baseFingerprint, sourceReportId: 'r', multiplier: 1.3 };
    const ovInfo: ContextInfo = { ...info, fingerprint: FP('c'), override: { id: o.id, rule: 'blueStatGain', proposed: [1, 2, 3], sourceReportId: 'r', multiplier: 1.3 } };
    expect(writeOverrideState(store, 'fixture', null, null).ok).toBe(true);
    const raw = store.getItem(overrideKey('fixture'));
    const snapshot = fit.snapshot;
    const rid = rosterIdentity(roster);
    store.setItem(localModelKey('fixture'), JSON.stringify({ schema: LOCAL_MODEL_SCHEMA, v: 1, mode: 'fixture', overrideId: OVR, contextFingerprint: FP('c'), baseFingerprint: info.baseFingerprint, masterVersion: masterData().version, rosterEtag: '"e1"', rosterIdentity: rid, snapshot, savedAt: NOW.toISOString() }));
    let fits = 0;
    const engine = fakeEngine({ configure: async () => ({ ok: true, value: ovInfo }), fit: async () => { fits++; return { ok: true, value: { ...fit, contextFingerprint: FP('c'), overridden: true } }; } });
    await engine.configure({} as never);
    const { src, calls } = mockSource({ roster });
    const services = { source: { ...src, kind: 'fixture' as const }, engine, store, now: () => NOW, loadMaster: async () => masterData() };
    const ctx: EngineContextState = { ...ovInfo, storedRaw: raw, storedRevision: 1, storedOverride: null, overrideProblem: null };
    const args = { roster, rosterEtag: '"e1"', rosterIdentity: rid, masterVersion: masterData().version, ctx };
    const first = await ensureModel(services, new QueryClient(), args);
    expect(first).toMatchObject({ status: 'ready', local: true });
    expect(first.status === 'ready' && first.fitted?.reason).toBe('eligibility-changed');
    expect(fits).toBe(1);
    const env = readLocalModel(store, 'fixture');
    expect(env).toMatchObject({ status: 'ok', env: { v: 2, eligibilityPolicy: TRAINING_ELIGIBILITY_POLICY } });
    expect(await ensureModel(services, new QueryClient(), args)).toMatchObject({ status: 'ready', local: true, fitted: null });
    expect(fits).toBe(1);
    expect(calls.filter((c) => c.method === 'latestSnapshot' || c.method === 'storeSnapshot')).toEqual([]);
  });
});
