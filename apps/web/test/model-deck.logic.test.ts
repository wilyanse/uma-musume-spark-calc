import { describe, expect, it } from 'vitest';
import type { ModelSnapshot } from '@uma/schema';
import { decideModel, loadFitRecord, saveFitRecord, type FitRecord } from '../src/lib/model.ts';
import { memoryStore } from '../src/lib/storage.ts';
import {
  addOwned,
  duplicateCards,
  emptyDeck,
  isComplete,
  loadDeck,
  missing,
  saveDeck,
  setFriend,
} from '../src/lib/deck.ts';

const snap = (over: Partial<ModelSnapshot> = {}): ModelSnapshot =>
  ({ id: 'S1', kind: 'training-v2', masterVersion: 'm1', trainedAt: 'x', nSamples: 10, params: {} as never, ...over }) as ModelSnapshot;
const rec = (over: Partial<FitRecord> = {}): FitRecord => ({
  snapshotId: 'S1',
  rosterEtag: '"e1"',
  masterVersion: 'm1',
  context: 'production',
  ...over,
});
const base = { rosterEtag: '"e1"', masterVersion: 'm1', context: 'production' };

describe('decideModel (60 §3, ADR-0002)', () => {
  it('reuses a v2 snapshot fitted on the same roster ETag, master and context', () => {
    expect(decideModel({ ...base, v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ action: 'use' });
  });
  it('fits when there is no snapshot', () => {
    expect(decideModel({ ...base, v2: null, anyLatest: null, record: null })).toEqual({
      action: 'fit',
      reason: 'no-snapshot',
      legacy: null,
    });
  });
  it('reports a legacy v1 (never reused, never relabelled) and fits v2', () => {
    const v1 = snap({ kind: 'training-v1', id: 'L1' });
    const d = decideModel({ ...base, v2: null, anyLatest: v1, record: null });
    expect(d).toEqual({ action: 'fit', reason: 'legacy-only', legacy: v1 });
    expect(v1.kind).toBe('training-v1');
  });
  it('fits on roster ETag change, master change, context change, unknown provenance', () => {
    const r = (o: Parameters<typeof decideModel>[0]) => decideModel(o);
    expect(r({ ...base, rosterEtag: '"e2"', v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ reason: 'roster-changed' });
    expect(r({ ...base, masterVersion: 'm2', v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ reason: 'master-changed' });
    expect(r({ ...base, context: 'golden-fixture', v2: snap(), anyLatest: snap(), record: rec() })).toMatchObject({ reason: 'context-changed' });
    expect(r({ ...base, v2: snap(), anyLatest: snap(), record: null })).toMatchObject({ reason: 'unknown-provenance' });
    expect(r({ ...base, v2: snap({ id: 'S2' }), anyLatest: snap(), record: rec() })).toMatchObject({ reason: 'unknown-provenance' });
  });
  it('fit record round-trips and a corrupt record reads as null', () => {
    const s = memoryStore();
    expect(loadFitRecord(s, 'api')).toBeNull();
    saveFitRecord(s, 'api', rec());
    expect(loadFitRecord(s, 'api')).toEqual(rec());
    expect(loadFitRecord(s, 'fixture')).toBeNull();
    s.setItem('uma:api:model-fit', '{"snapshotId":1}');
    expect(loadFitRecord(s, 'api')).toBeNull();
    s.setItem('uma:api:model-fit', 'not json');
    expect(loadFitRecord(s, 'api')).toBeNull();
  });
});

describe('deck draft (S04, Q-77)', () => {
  const card = (id: string) => ({ cardId: `card:${id}`, lb: 4, level: 50 });
  it('fills owned slots 1-5, refuses a sixth owned card, and slot 6 is the borrowed Friend', () => {
    let d = emptyDeck();
    for (const id of ['a', 'b', 'c', 'd', 'e']) d = addOwned(d, card(id))!;
    expect(addOwned(d, card('f'))).toBeNull();
    expect(missing(d)).toBe(1);
    d = setFriend(d, card('z'));
    expect(isComplete(d)).toBe(true);
    expect(d[5]).toMatchObject({ slot: 6, borrowed: true });
    expect(d.slice(0, 5).every((s) => s?.borrowed === false)).toBe(true);
  });
  it('flags a card used twice (owned + friend)', () => {
    const d = setFriend(addOwned(emptyDeck(), card('a'))!, card('a'));
    expect(duplicateCards(d)).toEqual(['card:a']);
  });
  it('persists per data mode and rejects a malformed stored deck', () => {
    const s = memoryStore();
    const d = setFriend(emptyDeck(), card('z'));
    saveDeck(s, 'fixture', d);
    expect(loadDeck(s, 'fixture')).toEqual(d);
    expect(loadDeck(s, 'api')).toEqual(emptyDeck());
    s.setItem('uma:api:deck', JSON.stringify([{ slot: 1, cardId: 'x', lb: 9, level: 1, borrowed: false }]));
    expect(loadDeck(s, 'api')).toEqual(emptyDeck());
    const two = emptyDeck().map((_, i) => ({ slot: i + 1, cardId: `card:${i}`, lb: 4, level: 50, borrowed: i < 2 }));
    s.setItem('uma:api:deck', JSON.stringify(two));
    expect(loadDeck(s, 'api')).toEqual(emptyDeck());
    const allOwned = two.map((x) => ({ ...x, borrowed: false }));
    s.setItem('uma:api:deck', JSON.stringify(allOwned));
    expect(loadDeck(s, 'api')).toEqual(allOwned);
  });
});
