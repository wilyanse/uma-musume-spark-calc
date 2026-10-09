/** S06/S07: labelled MOCK HTTP/worker; real engine-shaped output, seeded and time-injected. */
import { beforeAll, describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createEngineApi, type FitOutput } from '../src/workers/engine.api.ts';
import type { RankResult } from '@uma/engine';
import { fakeContext, fakeEngine, HARNESS_FP, mockSource, never, NOW, renderRoute } from './harness.tsx';
import { goldenRoster, goldenTargets, goldenTruth, masterBundle, masterData } from './fixtures.ts';
import { memoryStore } from '../src/lib/storage.ts';
import { saveDeck } from '../src/lib/deck.ts';
import { saveFitRecord } from '../src/lib/model.ts';
import { HttpError } from '../src/api/errors.ts';
import { QueryClient } from '@tanstack/react-query';
import { ensureModel } from '../src/app/engine.ts';
import { rosterIdentity } from '../src/lib/calibration.ts';
const roster = goldenRoster();
const targets = goldenTargets();
const truth = goldenTruth();
let fit: FitOutput;
let ranked: RankResult;
beforeAll(() => {
  const api = createEngineApi();
  api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: truth });
  const f = api.fit(roster, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM0000T131' });
  if (!f.ok) throw Error(f.error.message);
  // The FAKE engines below report the harness context identity; the REAL fit output is re-labelled
  // to that identity so the base-context provenance checks pass (identity checks: t15c-*.test.ts).
  fit = { ...f.value, contextFingerprint: HARNESS_FP };
  const g = truth.golden;
  const r = api.rank(fit.snapshot, { traineeOutfitId: g.traineeOutfitId, deck: g.planDeck, trainMode: g.trainMode, scenarioId: g.scenarioId }, roster, targets[0]!, { topK: 1, topN: 1, seed: 160 }, { contextFingerprint: f.value.contextFingerprint, eligibilityPolicy: f.value.eligibilityPolicy });
  if (!r.ok) throw Error(r.error.message);
  ranked = r.value;
}, 120_000);
function planStore() {
  const store = memoryStore();
  saveDeck(store, 'api', truth.golden.planDeck);
  store.setItem('uma:api:planner', JSON.stringify({ ...truth.golden, targetId: targets[0]!.id, lockParent1: '' }));
  return store;
}
const failure = () => { throw new HttpError(500, null, 'MOCK'); };
describe('S06 Planner', () => {
  it('does not start a worker or store a snapshot after cancellation during snapshot loading', async () => {
    let release!: (s: null) => void;
    let live = true;
    const engine = fakeEngine({ fit: async () => { throw Error('must not start'); } });
    const pending = new Promise<null>((r) => { release = r; });
    const { src, calls } = mockSource({}, { latestSnapshot: () => pending });
    const qc = new QueryClient();
    const job = ensureModel({ source: src, engine, store: memoryStore(), now: () => NOW, loadMaster: async () => masterData() }, qc, {
      roster, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), masterVersion: masterData().version, ctx: { ...fakeContext(), storedRaw: null, storedRevision: 0, storedOverride: null, overrideProblem: null } as never, isCurrent: () => live,
    });
    live = false;
    release(null);
    expect(await job).toEqual({ status: 'cancelled' });
    expect(engine.workersCreated).toBe(0);
    expect(calls.some((c) => c.method === 'storeSnapshot')).toBe(false);
  });
  it('loading, empty roster, no target/deck and fetch error', async () => {
    const a = renderRoute('/planner', mockSource({}, { roster: never }).src);
    expect(screen.getAllByText('Loading planner…').length).toBeGreaterThan(0); a.unmount();
    const b = renderRoute('/planner', mockSource().src);
    expect(await screen.findByText('Import at least 2 veterans to plan parents.')).toBeTruthy(); b.unmount();
    const c = renderRoute('/planner', mockSource({ roster }).src);
    expect(await screen.findByText(/Choose a full deck in Cards first/)).toBeTruthy();
    expect(screen.getByText('Create a CM target first.')).toBeTruthy(); c.unmount();
    renderRoute('/planner', mockSource({}, { roster: failure }).src);
    expect(await screen.findByText("Couldn't fit or load the model.")).toBeTruthy();
  });
  it('fits/stores v2, shows progress, ranks and expands actual engine output', async () => {
    let finish!: (v: unknown) => void;
    const engine = fakeEngine({ fit: async () => ({ ok: true, value: fit }), rank: async (...args) => {
      (args[6] as (p: unknown) => void)?.({ phase: 'fast', done: 1000, total: 32667 });
      return new Promise((resolve) => { finish = resolve; });
    } });
    const { src, calls } = mockSource({ roster, targets });
    renderRoute('/planner', src, { engine, store: planStore() });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Rank pairs' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Rank pairs' }));
    expect(await screen.findByTestId('rank-progress')).toBeTruthy();
    expect(calls.find((c) => c.method === 'storeSnapshot')?.args[0]).toEqual(fit.snapshot);
    await act(async () => finish({ ok: true, value: ranked }));
    expect(await screen.findByTestId('rank-done')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Expand details for pair 1' }));
    expect(screen.getByText(/Predicted stats · mean and p10–p90/)).toBeTruthy();
    expect(screen.getByText(/Per-skill sample counts aren't stored/)).toBeTruthy();
  });
  it('reuses proven v2; cancel/restart drops a late result', async () => {
    const store = planStore();
    saveFitRecord(store, 'api', { v: 3, eligibilityPolicy: fit.eligibilityPolicy, snapshotId: fit.snapshot.id, masterVersion: masterData().version, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), context: 'production', contextFingerprint: HARNESS_FP });
    const pending: ((r: unknown) => void)[] = [];
    const engine = fakeEngine({ rank: () => new Promise((r) => pending.push(r)) });
    renderRoute('/planner', mockSource({ roster, targets, snapshot: fit.snapshot }).src, { engine, store });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Rank pairs' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Rank pairs' }));
    await screen.findByTestId('rank-progress');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Ranking cancelled/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Rank pairs' }));
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => pending[0]!({ ok: true, value: ranked }));
    expect(screen.queryByTestId('rank-done')).toBeNull();
    await act(async () => pending[1]!({ ok: true, value: ranked }));
    expect(await screen.findByTestId('rank-done')).toBeTruthy();
    expect(engine.workersCreated).toBe(2);
  });
  it('shows true insufficient-data engine error, not a UI fitting threshold', async () => {
    renderRoute('/planner', mockSource({ roster: roster.slice(0, 3), targets }).src, { store: planStore(), engine: fakeEngine({ fit: async () => ({ ok: false, error: { name: 'InsufficientDataError', message: 'MOCK', eligible: 3, train: 2, holdout: 1, requirement: 'MOCK need more rows' } }) }) });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Rank pairs' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Rank pairs' }));
    expect(await screen.findByText(/3 eligible veterans \(train 2, holdout 1\)\. The engine says: MOCK need more rows\./)).toBeTruthy();
  });
  it('validates own-unique/unknown skills per selected trainee; removal is run-only', async () => {
    const own = masterData().outfits.get(truth.golden.traineeOutfitId)!.uniqueSkillId;
    const t = { ...targets[0]!, requiredSkills: [own, 'skill:not-known'] };
    const { calls, src } = mockSource({ roster, targets: [t] });
    renderRoute('/planner', src, { store: planStore() });
    expect(await screen.findByText(/not modelled for this trainee/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Rank pairs' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Rank without them (this run only)' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Rank pairs' }) as HTMLButtonElement).disabled).toBe(false));
    expect(t.requiredSkills).toEqual([own, 'skill:not-known']);
    expect(calls.some((c) => c.method === 'updateTarget')).toBe(false);
  });
});
describe('S07 Model health', () => {
  it('shows malformed snapshot as an actionable error rather than crashing health', async () => {
    renderRoute('/health', mockSource({ roster, snapshot: { ...fit.snapshot, params: null } as unknown as FitOutput['snapshot'] }).src);
    expect(await screen.findByText(/stored snapshot is malformed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refit model' })).toBeTruthy();
  });
  it('loading / empty / error', async () => {
    const a = renderRoute('/health', mockSource({}, { latestSnapshot: never }).src);
    expect(screen.getAllByText('Loading model health…').length).toBeGreaterThan(0); a.unmount();
    const b = renderRoute('/health', mockSource().src);
    expect(await screen.findByText(/No model yet/)).toBeTruthy(); b.unmount();
    renderRoute('/health', mockSource({}, { latestSnapshot: failure }).src);
    expect(await screen.findByText(/Couldn't load model health/)).toBeTruthy();
  });
  it('renders real metrics, unavailable scatter honestly, published unverified rules and (T15b) enabled calibration', async () => {
    renderRoute('/health', mockSource({ roster, snapshot: fit.snapshot }).src);
    expect(await screen.findByText(String(fit.snapshot.nSamples))).toBeTruthy();
    expect(screen.getByText(fit.snapshot.params.holdout.mae.spd.toFixed(1))).toBeTruthy();
    expect(screen.getByText(/No points are drawn/)).toBeTruthy();
    expect(screen.getAllByText('⚠ unverified').length).toBeGreaterThan(0);
    // T15b: calibration is enabled once roster and context are ready (no snapshot needed).
    await waitFor(() => expect((screen.getByRole('button', { name: 'Run calibration' }) as HTMLButtonElement).disabled).toBe(false));
    // N1: the threshold shown is the one the (fake) engine context reports, the band is labelled F08
    expect(screen.getByText('high-confidence rows only')).toBeTruthy();
    expect(screen.getByText(/F08 acceptance band 0.72–0.88/)).toBeTruthy();
  });
  it('shows the training-row threshold the engine context reports (MIN_CONFIDENCE)', async () => {
    const engine = fakeEngine({ configure: async () => ({ ok: true, value: fakeContext({ unverifiedRules: [], minConfidence: 0.42 }) }) });
    renderRoute('/health', mockSource({ roster, snapshot: fit.snapshot }).src, { engine });
    // T17 (ADR-0003): status-aware rows need no remaining low-confidence field; the numeric
    // threshold applies only to legacy rows without the status flag.
    expect(await screen.findByText('no low-confidence field left (legacy rows: min confidence ≥ 0.42)')).toBeTruthy();
  });
  it('legacy remains readable and never relabelled', async () => {
    const legacy = { ...fit.snapshot, kind: 'training-v1' as const };
    renderRoute('/health', mockSource({ roster, snapshot: legacy }).src);
    expect(await screen.findByText(/This is a legacy training-v1 snapshot/)).toBeTruthy();
    expect(legacy.kind).toBe('training-v1');
  });
  it('refit stores v2 and shows transient diagnostics', async () => {
    const data = { roster, snapshot: null as FitOutput['snapshot'] | null };
    const { src, calls } = mockSource(data, { latestSnapshot: async () => data.snapshot, storeSnapshot: async (s) => { data.snapshot = s; return s; } });
    renderRoute('/health', src, { engine: fakeEngine({ fit: async () => ({ ok: true, value: fit }) }) });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refit model' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Refit model' }));
    expect(await screen.findByText(/From the fit run in this tab/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'updateTarget')).toBe(false);
  });
});
