/**
 * T15c (62 §Provenance contract): canonical identity/digest, the versioned browser-local override
 * state, the local overridden-model envelope and the fit-or-reuse decision with the effective
 * context fingerprint. Pure logic: in-memory stores, fixed ids and times.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ModelSnapshot } from '@uma/schema';
import { canonicalJson, digestOf, sha256Hex } from '../src/lib/digest.ts';
import {
  LOCAL_MODEL_SCHEMA,
  OVERRIDE_SCHEMA,
  checkOverrideFor,
  localModelKey,
  localModelMismatch,
  overrideKey,
  parseLocalModel,
  parseOverride,
  readOverride,
  removeLocalModel,
  saveLocalModel,
  writeOverrideState,
  type ActiveOverride,
  type LocalModelEnvelope,
} from '../src/lib/rulesOverride.ts';
import { decideModel, loadFitRecord, saveFitRecord, type FitRecord } from '../src/lib/model.ts';
import { rosterIdentity } from '../src/lib/calibration.ts';
import { memoryStore, type KeyValueStore } from '../src/lib/storage.ts';
import { goldenRoster } from './fixtures.ts';

const FP = (c: string) => `sha256:${c.repeat(64)}`;
const active = (over: Partial<ActiveOverride> = {}): ActiveOverride => ({
  id: '01KGQZ0000G01DENCM00T15C01',
  appliedAt: '2026-10-08T00:00:00.000Z',
  rule: 'blueStatGain',
  proposed: [13.2, 26.4, 39.6],
  verified: false,
  source: 'BROWSER-LOCAL override',
  sourceReport: { id: '01KGQZ0000G01DENCM00T15CR1', generatedAt: '2026-10-08T00:00:00.000Z', multiplier: 1.32, contextFingerprint: FP('a'), current: [10, 20, 30], rosterEtag: '"e1"', rosterIdentity: 'r' },
  base: { contextKind: 'golden-fixture', masterVersion: 'm1', rulesVersion: 'rules-1', fingerprint: FP('a') },
  ...over,
});
const state = (a: ActiveOverride | null, revision = 1, mode: 'api' | 'fixture' = 'fixture') => JSON.stringify({ schema: OVERRIDE_SCHEMA, v: 1, mode, revision, active: a });

describe('canonical identity and SHA-256 digest', () => {
  it('matches FIPS 180-4 / node:crypto on known and long inputs', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const s of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'ü★'.repeat(1000), JSON.stringify(goldenRoster().slice(0, 5))]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });
  it('canonical JSON sorts keys recursively, keeps arrays ordered and refuses non-finite numbers', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
    expect(digestOf({ x: 1, y: 2 })).toBe(digestOf({ y: 2, x: 1 }));
    expect(digestOf({ x: [1, 2] })).not.toBe(digestOf({ x: [2, 1] }));
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ x: Infinity })).toThrow(/non-finite/);
  });
  it('roster identity is a full SHA-256 content digest (not a 32-bit hash): same ETag, one changed stat → different identity', () => {
    const r = goldenRoster();
    const a = rosterIdentity(r);
    expect(a).toMatch(/^260:sha256:[0-9a-f]{64}$/);
    expect(rosterIdentity(structuredClone(r))).toBe(a);
    const changed = structuredClone(r);
    changed[7]!.stats.spd += 1;
    expect(rosterIdentity(changed)).not.toBe(a);
  });
});

describe('browser-local override state (versioned, mode-namespaced, validated)', () => {
  it('keys are separate per data mode', () => {
    expect(overrideKey('api')).toBe('uma:api:rules-override');
    expect(overrideKey('fixture')).toBe('uma:fixture:rules-override');
    expect(localModelKey('api')).not.toBe(localModelKey('fixture'));
  });
  it('missing state is none at revision 0; a valid active record parses', () => {
    expect(parseOverride(null, 'fixture')).toEqual({ status: 'none', revision: 0, raw: null });
    const raw = state(active(), 3);
    const r = parseOverride(raw, 'fixture');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.revision).toBe(3);
      expect(r.active.proposed).toEqual([13.2, 26.4, 39.6]);
      expect(r.raw).toBe(raw);
    }
    expect(parseOverride(state(null, 4), 'fixture')).toMatchObject({ status: 'none', revision: 4 });
  });
  it.each([
    ['corrupt JSON', 'not json', /unreadable/],
    ['old/unknown envelope version', JSON.stringify({ schema: OVERRIDE_SCHEMA, v: 0, mode: 'fixture', revision: 1, active: active() }), /version/],
    ['wrong schema', JSON.stringify({ schema: 'other', v: 1, mode: 'fixture', revision: 1, active: active() }), /schema/],
    ['wrong mode (an api record under the fixture key)', state(active(), 1, 'api'), /mode/],
    ['unsupported rule', state(active({ rule: 'activation.blue' as never })), /unsupported rule/],
    ['negative value', state(active({ proposed: [1, -2, 3] })), /finite and ≥ 0/],
    ['non-finite value', state(active({ proposed: [1, 'x' as never, 3] })), /finite and ≥ 0/],
    ['claims verified', state(active({ verified: true as never })), /verified:false/],
    ['missing base fingerprint', state(active({ base: { ...active().base, fingerprint: 'h32:1234' } })), /fingerprint/],
    ['bad revision', JSON.stringify({ schema: OVERRIDE_SCHEMA, v: 1, mode: 'fixture', revision: -1, active: null }), /revision/],
  ])('rejects %s with a visible reason', (_n, raw, why) => {
    const r = parseOverride(raw, 'fixture');
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') expect(r.reason).toMatch(why);
  });
  it('a stored override for another context kind or master is refused (no synthetic override configures production)', () => {
    const a = active();
    expect(checkOverrideFor(a, { kind: 'golden-fixture', masterVersion: 'm1' })).toBeNull();
    expect(checkOverrideFor(a, { kind: 'production', masterVersion: 'm1' })).toMatch(/golden-fixture.*production/);
    expect(checkOverrideFor(a, { kind: 'golden-fixture', masterVersion: 'm2' })).toMatch(/master/);
  });
  it('writes are compare-and-swap on the exact stored value: a newer revision from another tab is never overwritten', () => {
    const s = memoryStore();
    const w1 = writeOverrideState(s, 'fixture', null, active(), );
    expect(w1).toMatchObject({ ok: true, revision: 1 });
    const seen = s.getItem(overrideKey('fixture'));
    // Another tab resets meanwhile.
    expect(writeOverrideState(s, 'fixture', seen, null)).toMatchObject({ ok: true, revision: 2 });
    const stale = writeOverrideState(s, 'fixture', seen, active({ id: '01KGQZ0000G01DENCM00T15C02' }));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toMatch(/changed in another tab/);
    expect(readOverride(s, 'fixture')).toMatchObject({ status: 'none', revision: 2 });
    // A corrupt stored value can still be replaced by an explicit reset bound to that exact value.
    s.setItem(overrideKey('fixture'), 'garbage');
    expect(writeOverrideState(s, 'fixture', 'garbage', null)).toMatchObject({ ok: true, revision: 1 });
  });
  it('a failing or silently dropping storage write never claims durability', () => {
    const throwing: KeyValueStore = { ...memoryStore(), setItem: () => { throw new Error('QuotaExceededError'); } };
    const r = writeOverrideState(throwing, 'fixture', null, active());
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/QuotaExceededError/);
    const dropping: KeyValueStore = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    const d = writeOverrideState(dropping, 'fixture', null, active());
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/did not persist/);
  });
});

describe('local overridden-model envelope', () => {
  const snapshot = { id: '01KGQZ0000G01DENCM00T15CS1', kind: 'training-v2', masterVersion: 'm1', trainedAt: '2026-10-08T00:00:00.000Z', nSamples: 10, params: {} } as unknown as ModelSnapshot;
  const env = (over: Partial<LocalModelEnvelope> = {}): LocalModelEnvelope => ({
    schema: LOCAL_MODEL_SCHEMA, v: 1, mode: 'fixture', overrideId: active().id, contextFingerprint: FP('b'), baseFingerprint: FP('a'),
    masterVersion: 'm1', rosterEtag: '"e1"', rosterIdentity: 'r', snapshot, savedAt: '2026-10-08T00:00:00.000Z', ...over,
  });
  const expectFor = { overrideId: active().id, contextFingerprint: FP('b'), baseFingerprint: FP('a'), masterVersion: 'm1', rosterEtag: '"e1"', rosterIdentity: 'r' };
  it('round-trips and matches only its exact provenance', () => {
    const s = memoryStore();
    expect(saveLocalModel(s, 'fixture', env())).toEqual({ ok: true });
    const r = parseLocalModel(s.getItem(localModelKey('fixture')), 'fixture');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(localModelMismatch(r.env, expectFor)).toBeNull();
    expect(localModelMismatch(r.env, { ...expectFor, contextFingerprint: FP('c') })).toMatch(/rules context/);
    expect(localModelMismatch(r.env, { ...expectFor, baseFingerprint: FP('c') })).toMatch(/base/);
    expect(localModelMismatch(r.env, { ...expectFor, overrideId: 'other' })).toMatch(/override/);
    expect(localModelMismatch(r.env, { ...expectFor, masterVersion: 'm2' })).toMatch(/master/);
    expect(localModelMismatch(r.env, { ...expectFor, rosterEtag: '"e2"' })).toMatch(/roster/);
    expect(localModelMismatch(r.env, { ...expectFor, rosterIdentity: 'r2' })).toMatch(/roster/);
    removeLocalModel(s, 'fixture');
    expect(parseLocalModel(s.getItem(localModelKey('fixture')), 'fixture')).toEqual({ status: 'none' });
  });
  it('rejects corrupt / wrong-mode / wrong-version / v1 snapshot envelopes', () => {
    expect(parseLocalModel('nope', 'fixture')).toMatchObject({ status: 'invalid' });
    expect(parseLocalModel(JSON.stringify(env({ mode: 'api' })), 'fixture')).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/mode/) });
    expect(parseLocalModel(JSON.stringify({ ...env(), v: 2 }), 'fixture')).toMatchObject({ status: 'invalid' });
    expect(parseLocalModel(JSON.stringify(env({ snapshot: { ...snapshot, kind: 'training-v1' } })), 'fixture')).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/training-v2/) });
    expect(parseLocalModel(JSON.stringify(env({ contextFingerprint: 'deadbeef' })), 'fixture')).toMatchObject({ status: 'invalid' });
  });
  it('a failed model write is reported, not claimed', () => {
    const throwing: KeyValueStore = { ...memoryStore(), setItem: () => { throw new Error('quota'); } };
    expect(saveLocalModel(throwing, 'fixture', env())).toMatchObject({ ok: false, reason: expect.stringMatching(/quota/) });
  });
});

describe('decideModel with the effective context identity (T15c)', () => {
  const snap = (over: Partial<ModelSnapshot> = {}): ModelSnapshot =>
    ({ id: 'S1', kind: 'training-v2', masterVersion: 'm1', trainedAt: 'x', nSamples: 10, params: {} as never, ...over }) as ModelSnapshot;
  const rec = (over: Partial<FitRecord> = {}): FitRecord => ({ v: 2, snapshotId: 'S1', rosterEtag: '"e1"', rosterIdentity: 'r1', masterVersion: 'm1', context: 'production', contextFingerprint: FP('a'), ...over });
  const base = { rosterEtag: '"e1"', rosterIdentity: 'r1', masterVersion: 'm1', context: 'production', contextFingerprint: FP('a') };
  it('reuses only when fingerprint, master, roster ETag and content all match', () => {
    expect(decideModel({ ...base, v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ action: 'use' });
    expect(decideModel({ ...base, contextFingerprint: FP('b'), v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ action: 'fit', reason: 'context-changed' });
    expect(decideModel({ ...base, rosterIdentity: 'r2', v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ action: 'fit', reason: 'roster-changed' });
  });
  it('an old (pre-T15c) fit record without a context fingerprint is unknown provenance and forces a refit', () => {
    const s = memoryStore();
    s.setItem('uma:api:model-fit', JSON.stringify({ snapshotId: 'S1', rosterEtag: '"e1"', masterVersion: 'm1', context: 'production' }));
    expect(loadFitRecord(s, 'api')).toBeNull();
    expect(decideModel({ ...base, v2: snap(), anyLatest: snap(), record: loadFitRecord(s, 'api') })).toMatchObject({ action: 'fit', reason: 'unknown-provenance' });
    saveFitRecord(s, 'api', rec());
    expect(loadFitRecord(s, 'api')).toEqual(rec());
  });
});
