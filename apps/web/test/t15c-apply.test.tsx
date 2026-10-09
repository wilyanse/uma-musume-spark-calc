/**
 * T15c S07/S06 apply–refit–reset workflow (62 §Explicit confirmation and transaction, §Reset).
 * MOCK DataSource (fixture-kind, in-memory) and FAKE engine clients drive the UI; every report,
 * snapshot and fit summary they return is REAL engine output computed in `beforeAll` through the
 * worker surface (createEngineApi, in-process) from the committed, unchanged golden files. The
 * fake configure mimics only the identity bookkeeping (base vs override fingerprint) so the tests
 * can hold the candidate fit open; the real worker behaviour is t15c-worker.test.ts and the real
 * browser path is e2e/apply.spec.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterVeteran } from '@uma/schema';
import { createEngineApi, type CalibrationOutput, type ContextInfo, type EngineResult, type FitOutput, type WorkerOverride } from '../src/workers/engine.api.ts';
import { fakeContext, fakeEngine, mockSource, NOW, renderRoute } from './harness.tsx';
import { seededRandom, ulid } from '../src/lib/ulid.ts';
import { calibrationRoster, goldenRoster, goldenTargets, goldenTruth, masterBundle, masterData } from './fixtures.ts';
import { memoryStore, type KeyValueStore } from '../src/lib/storage.ts';
import { localModelKey, overrideKey, readLocalModel, readOverride, writeOverrideState, type ActiveOverride } from '../src/lib/rulesOverride.ts';
import { ensureModel, type EngineContextState } from '../src/app/engine.ts';
import { rosterIdentity } from '../src/lib/calibration.ts';
import { saveDeck } from '../src/lib/deck.ts';
import { QueryClient } from '@tanstack/react-query';
import type { AppServices, FixtureGolden } from '../src/app/services.ts';
import type { EngineClient } from '../src/workers/client.ts';

const roster = calibrationRoster();
const truth = goldenTruth();
let base: ContextInfo;
let report: CalibrationOutput;
let baseFit: FitOutput;
const ok = <T,>(r: EngineResult<T>): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
beforeAll(() => {
  const api = createEngineApi();
  base = ok(api.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: { syntheticInheritance: truth.syntheticInheritance } as never }));
  report = ok(api.calibrate(roster, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15C31' }));
  baseFit = ok(api.fit(roster, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15C32' }));
}, 240_000);

const OVR_FP = (id: string) => `sha256:${(id.toLowerCase().replace(/[^0-9a-f]/g, '0') + '0'.repeat(64)).slice(0, 64)}`;
/** FAKE configure: the REAL base info, or the base info relabelled for an override (identity bookkeeping only). */
function infoFor(o: WorkerOverride | null | undefined): ContextInfo {
  if (!o) return structuredClone(base);
  if (o.baseFingerprint !== base.baseFingerprint) return { ...structuredClone(base), overrideRejected: 'it was created for a different base context' };
  const b = base.effectiveRules.blueStatGain;
  return {
    ...structuredClone(base),
    fingerprint: OVR_FP(o.id),
    rulesVersion: `${base.rulesVersion}+local-${o.id}`,
    override: { id: o.id, rule: 'blueStatGain', proposed: [...o.proposed], sourceReportId: o.sourceReportId, multiplier: o.multiplier },
    effectiveRules: { ...structuredClone(base.effectiveRules), blueStatGain: { ...b, '1': o.proposed[0], '2': o.proposed[1], '3': o.proposed[2], verified: false, source: `BROWSER-LOCAL override from calibration report ${o.sourceReportId}` } },
  };
}
interface D<T> { promise: Promise<T>; resolve: (v: T) => void }
const deferred = <T,>(): D<T> => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => (resolve = r)); return { promise, resolve }; };

/** The ACTIVE fake engine: calibrations resolve with the real report; configure records its inputs. */
function activeEngine() {
  const configures: (WorkerOverride | null)[] = [];
  const fits: unknown[] = [];
  let lastOverride: WorkerOverride | null = null;
  const engine = fakeEngine({
    configure: async (input) => { const o = (input as { override?: WorkerOverride | null }).override ?? null; configures.push(o); lastOverride = o; return { ok: true, value: infoFor(o) }; },
    calibrate: async () => ({ ok: true, value: report }),
    fit: async () => { fits.push(1); const i = infoFor(lastOverride); return { ok: true, value: { ...baseFit, contextFingerprint: i.fingerprint, overridden: !!i.override } }; },
  });
  return { engine, configures, fits };
}
/** The ISOLATED candidate engine(s): fit is held open by the test unless `auto`. */
function candidates(opts: { auto?: boolean; fitError?: string } = {}) {
  const made: { engine: EngineClient; fit: D<unknown> | null; override: WorkerOverride | null; disposed: boolean }[] = [];
  const factory = () => {
    const rec = { engine: null as unknown as EngineClient, fit: null as D<unknown> | null, override: null as WorkerOverride | null, disposed: false };
    rec.engine = fakeEngine({
      configure: async (input) => { rec.override = (input as { override?: WorkerOverride }).override ?? null; return { ok: true, value: infoFor(rec.override) }; },
      fit: () => {
        if (opts.fitError) return Promise.resolve({ ok: false, error: { name: 'Error', message: opts.fitError } });
        const i = infoFor(rec.override);
        const value = { ...baseFit, contextFingerprint: i.fingerprint, overridden: true };
        if (opts.auto) return Promise.resolve({ ok: true, value });
        rec.fit = deferred<unknown>();
        return rec.fit.promise.then(() => ({ ok: true, value }));
      },
    });
    const dispose = rec.engine.dispose.bind(rec.engine);
    rec.engine.dispose = () => { rec.disposed = true; dispose(); };
    made.push(rec);
    return rec.engine;
  };
  return { made, factory };
}
function fixtureSource(over: Parameters<typeof mockSource>[1] = {}) {
  const m = mockSource({ roster, targets: goldenTargets(), snapshot: null }, over);
  return { src: { ...m.src, kind: 'fixture' as const }, calls: m.calls };
}
const loadGolden = async () => truth as unknown as FixtureGolden;
const posted = (calls: { method: string }[]) => calls.filter((c) => c.method === 'storeSnapshot');

async function openReport(extra: Partial<AppServices>, src = fixtureSource()) {
  const store = (extra.store ?? memoryStore()) as KeyValueStore;
  const r = renderRoute('/health', src.src, { loadGolden, store, ...extra });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Run calibration' }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
  await screen.findByTestId('calibration-report');
  return { ...r, store, calls: src.calls };
}
const applyBtn = () => screen.getByRole('button', { name: 'Apply suggested multipliers' }) as HTMLButtonElement;

describe('S07 apply: explicit confirmation, candidate fit, commit', () => {
  it('confirms the exact proposal, fits a candidate in an ISOLATED engine, commits locally, reconfigures, never POSTs', async () => {
    const a = activeEngine();
    const c = candidates();
    const { store, calls } = await openReport({ engine: a.engine, candidateEngine: c.factory });
    expect(applyBtn().disabled).toBe(false);
    await userEvent.click(applyBtn());
    const dlg = screen.getByRole('dialog', { name: 'Apply the suggested blueStatGain?' });
    const s = report.report.suggestions[0]!;
    const cells = (id: string) => [...within(dlg).getByTestId(id).querySelectorAll('td')].map((td) => Number(td.textContent));
    expect(cells('apply-old')).toEqual(s.current.map((x) => Math.round(x * 1e4) / 1e4));
    expect(cells('apply-new')).toEqual(s.proposed.map((x) => Math.round(x * 1e4) / 1e4));
    expect(dlg.textContent).toMatch(/Unverified/);
    expect(dlg.textContent).toMatch(/THIS browser/);
    expect(dlg.textContent).toContain(report.report.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Fit and apply' }));
    expect(await screen.findByTestId('apply-running')).toBeTruthy();
    await waitFor(() => expect(c.made[0]?.fit).toBeTruthy());
    // Nothing committed and the ACTIVE context untouched while the candidate fits.
    expect(store.getItem(overrideKey('fixture'))).toBeNull();
    expect(a.configures.every((o) => o === null)).toBe(true);
    expect(c.made[0]!.override!.proposed).toEqual(s.proposed);
    await act(async () => c.made[0]!.fit!.resolve(null));
    expect((await screen.findByTestId('apply-result')).textContent).toMatch(/Applied in this browser only/);
    const stored = readOverride(store, 'fixture');
    expect(stored.status).toBe('ok');
    if (stored.status === 'ok') {
      expect(stored.active.proposed).toEqual(s.proposed);
      expect(stored.active.sourceReport.id).toBe(report.report.id);
      expect(stored.active.base.fingerprint).toBe(base.baseFingerprint);
      expect(stored.active.verified).toBe(false);
    }
    const lm = readLocalModel(store, 'fixture');
    expect(lm.status).toBe('ok');
    if (lm.status === 'ok') expect(lm.env.contextFingerprint).toBe(OVR_FP(stored.status === 'ok' ? stored.active.id : ''));
    expect(c.made[0]!.disposed).toBe(true);
    // The active worker is reconfigured with the committed override; the UI shows it and its local model.
    await waitFor(() => expect(a.configures.at(-1)?.proposed).toEqual(s.proposed));
    expect((await screen.findByTestId('override-active')).textContent).toMatch(/browser-local override/);
    expect((await screen.findByTestId('model-origin')).textContent).toMatch(/browser-local model/);
    // The source report is now historical (stale), and cannot be applied again.
    expect((await screen.findByTestId('calib-stale')).textContent).toMatch(/rules changed/);
    expect(applyBtn().disabled).toBe(true);
    expect(posted(calls)).toEqual([]);
  });

  it('same-tick double confirm starts ONE candidate; Cancel apply keeps the old context and writes nothing', async () => {
    const a = activeEngine();
    const c = candidates();
    const { store, calls } = await openReport({ engine: a.engine, candidateEngine: c.factory });
    await userEvent.click(applyBtn());
    const go = within(screen.getByRole('dialog')).getByRole('button', { name: 'Fit and apply' });
    act(() => { go.click(); go.click(); });
    await waitFor(() => expect(c.made[0]?.fit).toBeTruthy());
    expect(c.made.length).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel apply' }));
    expect((await screen.findByTestId('apply-result')).textContent).toMatch(/Apply cancelled\. Nothing was applied/);
    await act(async () => c.made[0]!.fit!.resolve(null)); // late candidate result
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getItem(overrideKey('fixture'))).toBeNull();
    expect(store.getItem(localModelKey('fixture'))).toBeNull();
    expect(a.configures.every((o) => o === null)).toBe(true);
    expect(screen.getByTestId('override-none')).toBeTruthy();
    expect(posted(calls)).toEqual([]);
  });

  it('a candidate fit error discloses the failure and commits nothing', async () => {
    const a = activeEngine();
    const c = candidates({ fitError: 'MOCK candidate fit failure' });
    const { store } = await openReport({ engine: a.engine, candidateEngine: c.factory });
    await userEvent.click(applyBtn());
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fit and apply' }));
    expect((await screen.findByTestId('apply-result')).textContent).toMatch(/candidate fit failed: MOCK candidate fit failure\. Nothing was applied/);
    expect(store.getItem(overrideKey('fixture'))).toBeNull();
    expect(store.getItem(localModelKey('fixture'))).toBeNull();
  });

  it('another tab writing the override during the candidate fit refuses the commit (no silent overwrite)', async () => {
    const a = activeEngine();
    const c = candidates();
    const { store } = await openReport({ engine: a.engine, candidateEngine: c.factory });
    await userEvent.click(applyBtn());
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fit and apply' }));
    await waitFor(() => expect(c.made[0]?.fit).toBeTruthy());
    // "Other tab": a different stored revision appears (here: an explicit reset record).
    expect(writeOverrideState(store, 'fixture', null, null).ok).toBe(true);
    const other = store.getItem(overrideKey('fixture'));
    await act(async () => c.made[0]!.fit!.resolve(null));
    expect((await screen.findByTestId('apply-result')).textContent).toMatch(/changed while applying|Nothing was applied/);
    expect(store.getItem(overrideKey('fixture'))).toBe(other);
    expect(store.getItem(localModelKey('fixture'))).toBeNull();
  });

  it('a failing storage commit rolls back the local model and does not claim success', async () => {
    const a = activeEngine();
    const c = candidates({ auto: true });
    const inner = memoryStore();
    const store: KeyValueStore = {
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem: (k, v) => { if (k === overrideKey('fixture')) throw new Error('MOCK QuotaExceededError'); inner.setItem(k, v); },
    };
    await openReport({ engine: a.engine, candidateEngine: c.factory, store });
    await userEvent.click(applyBtn());
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fit and apply' }));
    expect((await screen.findByTestId('apply-result')).textContent).toMatch(/override couldn't be saved.*MOCK QuotaExceededError.*Nothing was applied/);
    expect(inner.getItem(overrideKey('fixture'))).toBeNull();
    expect(inner.getItem(localModelKey('fixture'))).toBeNull();
    expect(screen.getByTestId('override-none')).toBeTruthy();
  });

  it('a roster change while the confirmation is open cancels it (bound to the report provenance)', async () => {
    const a = activeEngine();
    const state = { etag: '"r1"', roster: roster as RosterVeteran[] };
    const src = fixtureSource({ roster: async () => ({ etag: state.etag, roster: state.roster, notModified: false }) });
    const { qc } = await openReport({ engine: a.engine, candidateEngine: candidates().factory }, src);
    await userEvent.click(applyBtn());
    expect(screen.getByRole('dialog')).toBeTruthy();
    state.etag = '"r2"'; state.roster = roster.slice(1);
    await act(async () => { await qc.invalidateQueries({ queryKey: ['roster'] }); });
    expect((await screen.findByTestId('apply-result')).textContent).toMatch(/confirmation was cancelled/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(applyBtn().disabled).toBe(true);
  });
});

describe('S07 reset and stored-state problems', () => {
  async function appliedStore() {
    const store = memoryStore();
    const s = report.report.suggestions[0]!;
    const active: ActiveOverride = {
      id: '01KGQZ0000G01DENCM00T15C41', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [...s.proposed], verified: false, source: 'BROWSER-LOCAL override (test)',
      sourceReport: { id: report.report.id, generatedAt: report.report.generatedAt, multiplier: s.multiplier, contextFingerprint: base.fingerprint, current: [...s.current], rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster) },
      base: { contextKind: 'golden-fixture', masterVersion: masterData().version, rulesVersion: base.rulesVersion, fingerprint: base.baseFingerprint },
    };
    expect(writeOverrideState(store, 'fixture', null, active).ok).toBe(true);
    store.setItem(localModelKey('fixture'), JSON.stringify({ placeholder: 'any local model' }));
    return store;
  }
  it('reload with a stored override reconfigures the worker with it; no server snapshot is fetched; Reset restores the labelled FIXTURE base', async () => {
    const store = await appliedStore();
    const a = activeEngine();
    const src = fixtureSource();
    renderRoute('/health', src.src, { loadGolden, store, engine: a.engine });
    expect((await screen.findByTestId('override-active')).textContent).toMatch(/SYNTHETIC golden fixture base context/);
    expect(a.configures[0]?.id).toBe('01KGQZ0000G01DENCM00T15C41');
    expect((await screen.findByTestId('local-model-missing')).textContent).toMatch(/No browser-local model/);
    expect(src.calls.some((c) => c.method === 'latestSnapshot')).toBe(false);
    expect(screen.getAllByText(/Model: browser-local \(override\)/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to fixture base rules' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg.textContent).toMatch(/SYNTHETIC golden fixture base context.*not the published rules/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reset' }));
    expect((await screen.findByTestId('rules-note')).textContent).toMatch(/Reset done\. The SYNTHETIC golden fixture base context .* is in force again/);
    expect(readOverride(store, 'fixture')).toMatchObject({ status: 'none', revision: 2 });
    expect(store.getItem(localModelKey('fixture'))).toBeNull();
    await waitFor(() => expect(a.configures.at(-1)).toBeNull());
    expect(await screen.findByTestId('override-none')).toBeTruthy();
  });
  it('failed reset storage cleanup retains the previous rules and local model', async () => {
    const underlying = await appliedStore();
    const previous = underlying.getItem(overrideKey('fixture'));
    const model = underlying.getItem(localModelKey('fixture'));
    const store = { ...underlying, removeItem: (key: string) => { if (key === localModelKey('fixture')) throw Error('INJECTED reset cleanup fault'); underlying.removeItem(key); } };
    renderRoute('/health', fixtureSource().src, { loadGolden, store, engine: activeEngine().engine });
    await screen.findByTestId('override-active');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to fixture base rules' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset' }));
    expect((await screen.findByTestId('rules-note')).textContent).toMatch(/Reset could not clear/);
    expect(underlying.getItem(overrideKey('fixture'))).toBe(previous);
    expect(underlying.getItem(localModelKey('fixture'))).toBe(model);
  });
  it('a reset confirmation is cancelled when another tab changes the override first', async () => {
    const store = await appliedStore();
    renderRoute('/health', fixtureSource().src, { loadGolden, store, engine: activeEngine().engine });
    await screen.findByTestId('override-active');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to fixture base rules' }));
    const raw = store.getItem(overrideKey('fixture'));
    expect(writeOverrideState(store, 'fixture', raw, null).ok).toBe(true); // other tab resets
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: overrideKey('fixture') })));
    expect((await screen.findByTestId('rules-note')).textContent).toMatch(/reset confirmation was cancelled/);
  });
  it('a corrupt stored override is shown with its reason, is NOT applied, and can be cleared explicitly', async () => {
    const store = memoryStore();
    store.setItem(overrideKey('fixture'), '{"schema":"uma-browser-rules-override","v":1,"mode":"fixture","revision":3,"active":{"rule":"blueStatGain","proposed":[1,-5,2]}}');
    const a = activeEngine();
    renderRoute('/health', fixtureSource().src, { loadGolden, store, engine: a.engine });
    expect((await screen.findByTestId('override-problem')).textContent).toMatch(/invalid \(proposed values must be three numbers, finite and ≥ 0\)/);
    expect(a.configures[0]).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear the stored override' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear it' }));
    expect(readOverride(store, 'fixture').status).toBe('none');
  });
  it('production: placeholder report offers no Apply; an override stored for the fixture context is never applied to production', async () => {
    const p = createEngineApi();
    const prodInfo = ok(p.configure({ bundle: masterBundle(), kind: 'production' }));
    const prodReport = ok(p.calibrate(goldenRoster(), { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15C51' }));
    const store = memoryStore();
    // A record written under the api key but bound to the fixture context (e.g. copied storage).
    const s = report.report.suggestions[0]!;
    store.setItem(overrideKey('api'), JSON.stringify({ schema: 'uma-browser-rules-override', v: 1, mode: 'api', revision: 1, active: {
      id: '01KGQZ0000G01DENCM00T15C52', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [...s.proposed], verified: false, source: 'x',
      sourceReport: { id: 'r', generatedAt: NOW.toISOString(), multiplier: 1.3, contextFingerprint: base.fingerprint, current: [...s.current], rosterEtag: null, rosterIdentity: 'x' },
      base: { contextKind: 'golden-fixture', masterVersion: masterData().version, rulesVersion: 'rules-1', fingerprint: base.baseFingerprint } } }));
    const configures: unknown[] = [];
    const engine = fakeEngine({ configure: async (i) => { configures.push((i as { override?: unknown }).override ?? null); return { ok: true, value: prodInfo }; }, calibrate: async () => ({ ok: true, value: prodReport }) });
    renderRoute('/health', mockSource({ roster: goldenRoster(), snapshot: null }).src, { store, engine });
    expect((await screen.findByTestId('override-problem')).textContent).toMatch(/golden-fixture context, but this app runs the production context/);
    expect(configures).toEqual([null]);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Run calibration' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Run calibration' }));
    await screen.findByTestId('calibration-report');
    expect(screen.queryByRole('button', { name: 'Apply suggested multipliers' })).toBeNull();
    expect(screen.getByTestId('override-none').textContent).toMatch(/published rules/);
  });
});

describe('ensureModel under an override: browser-local only, never the snapshot API', () => {
  const ctxState = (info: ContextInfo, raw: string | null): EngineContextState => ({ ...info, storedRaw: raw, storedRevision: 1, storedOverride: null, overrideProblem: null });
  it('fits, keeps the model in a local envelope, reuses it only for the exact provenance, and never reads/writes the server', async () => {
    const store = memoryStore();
    const o: WorkerOverride = { id: '01KGQZ0000G01DENCM00T15C61', rule: 'blueStatGain', proposed: [1, 2, 3], baseFingerprint: base.baseFingerprint, sourceReportId: 'r', multiplier: 1.3 };
    const info = infoFor(o);
    expect(writeOverrideState(store, 'fixture', null, null).ok).toBe(true);
    const raw = store.getItem(overrideKey('fixture'));
    let fits = 0;
    const engine = fakeEngine({ configure: async () => ({ ok: true, value: info }), fit: async () => { fits++; return { ok: true, value: { ...baseFit, contextFingerprint: info.fingerprint, overridden: true } }; } });
    await engine.configure({} as never); // the app configures via useEngineContext before any fit
    const { src, calls } = mockSource({ roster });
    const services = { source: { ...src, kind: 'fixture' as const }, engine, store, now: () => NOW, loadMaster: async () => masterData() };
    const qc = new QueryClient();
    const args = { roster, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), masterVersion: masterData().version, ctx: ctxState(info, raw) };
    const first = await ensureModel(services, qc, args);
    expect(first).toMatchObject({ status: 'ready', local: true, provenance: { contextFingerprint: info.fingerprint } });
    const second = await ensureModel(services, qc, args);
    expect(second).toMatchObject({ status: 'ready', local: true, fitted: null });
    expect(fits).toBe(1);
    const changed = await ensureModel(services, qc, { ...args, rosterIdentity: 'other' });
    expect(changed).toMatchObject({ status: 'ready', local: true });
    expect(fits).toBe(2);
    expect(calls.filter((c) => c.method === 'latestSnapshot' || c.method === 'storeSnapshot')).toEqual([]);
    // Stale override state (another tab) refuses before fitting.
    store.setItem(overrideKey('fixture'), 'changed elsewhere');
    expect(await ensureModel(services, qc, args)).toMatchObject({ status: 'error', message: expect.stringMatching(/rules override changed/) });
    expect(fits).toBe(2);
  });
  it('a base-context fit whose worker reports an overridden context is NEVER posted', async () => {
    const store = memoryStore();
    const engine = fakeEngine({ fit: async () => ({ ok: true, value: { ...baseFit, contextFingerprint: OVR_FP('X'), overridden: true } }) });
    await engine.configure({} as never);
    const { src, calls } = mockSource({ roster });
    const services = { source: src, engine, store, now: () => NOW, loadMaster: async () => masterData() };
    const out = await ensureModel(services, new QueryClient(), { roster, rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster), masterVersion: masterData().version, ctx: ctxState(base, null) });
    expect(out.status).toBe('error');
    expect(calls.some((c) => c.method === 'storeSnapshot')).toBe(false);
  });
});

describe('carried T15b findings', () => {
  it('S1: a boundary selection is labelled as a boundary minimum, not a suggestion; S2: uninformative conditional likelihood is qualified inline', async () => {
    const b = structuredClone(report); // FAKE variant of the real report: boundary branch
    b.report.stats.status = 'boundary';
    b.report.stats.selected!.atBoundary = true;
    b.report.suggestions = [];
    b.report.aptitude.status = 'uninformative';
    const engine = fakeEngine({ configure: async () => ({ ok: true, value: base }), calibrate: async () => ({ ok: true, value: b }) });
    await openReport({ engine });
    const sel = screen.getByTestId('calib-selection').textContent!;
    expect(sel).toMatch(/Boundary minimum ×\d\.\d\d \(not a suggestion; widen the grid\)/);
    expect(sel).not.toMatch(/Selected multiplier/);
    expect(screen.getByTestId('apt-conditional').textContent).toMatch(/\(uninformative: every cell is degenerate\)/);
  });
  it('N3: Planner unmount cancels only the job it owns, not another screen\'s', async () => {
    const store = memoryStore();
    saveDeck(store, 'api', truth.golden.planDeck);
    const engine = fakeEngine();
    const a = renderRoute('/planner', mockSource({ roster: goldenRoster(), targets: goldenTargets() }).src, { engine, store });
    await screen.findByText('Plan');
    const other = engine.fit(roster, { nowIso: NOW.toISOString() });
    a.unmount();
    expect(engine.busy).toBe(other.generation);
    other.cancel();
  });
});

/*
 * T15c review round 1 (docs/reviews/T15c-review-1.md): B1 footer truth, B2 reset guard, S1
 * injected ids, N1 recoverable revision, N3 source text after reapply. Written before the fixes.
 */
describe('review r1 B1: the footer reports the WORKER-CONFIRMED context, never an unvalidated stored record', () => {
  const footer = () => document.querySelector('.rail .foot')!.textContent ?? '';
  const prodActive = (over: { masterVersion?: string; mode?: string; contextKind?: string } = {}) => JSON.stringify({ schema: 'uma-browser-rules-override', v: 1, mode: over.mode ?? 'api', revision: 4, active: {
    id: '01KGQZ0000G01DENCM00T15CR1', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [13, 26, 39], verified: false, source: 'TEST record',
    sourceReport: { id: '01KGQZ0000G01DENCM00T15CR2', generatedAt: NOW.toISOString(), multiplier: 1.3, contextFingerprint: `sha256:${'f'.repeat(64)}`, current: [10, 20, 30], rosterEtag: null, rosterIdentity: 'x' },
    base: { contextKind: over.contextKind ?? 'production', masterVersion: over.masterVersion ?? masterData().version, rulesVersion: 'rules-1', fingerprint: `sha256:${'f'.repeat(64)}` } } });
  function prodEngine(info: (o: WorkerOverride | null) => ContextInfo = () => fakeContext() as ContextInfo) {
    const configures: (WorkerOverride | null)[] = [];
    const engine = fakeEngine({ configure: async (i) => { const o = (i as { override?: WorkerOverride | null }).override ?? null; configures.push(o); return { ok: true, value: info(o) }; } });
    return { engine, configures };
  }
  it('an override refused for a wrong master (API mode) is labelled baseline and the server snapshot is queried and shown', async () => {
    const store = memoryStore();
    store.setItem(overrideKey('api'), prodActive({ masterVersion: 'OLD-MASTER' }));
    const e = prodEngine();
    const m = mockSource({ roster: goldenRoster(), snapshot: null });
    renderRoute('/health', m.src, { store, engine: e.engine });
    expect((await screen.findByTestId('override-problem')).textContent).toMatch(/applied with master OLD-MASTER/);
    expect(e.configures).toEqual([null]);
    await waitFor(() => expect(footer()).toMatch(/Model: none yet/));
    expect(footer()).not.toMatch(/browser-local/);
    expect(m.calls.some((c) => c.method === 'latestSnapshot')).toBe(true);
  });
  it('an override the WORKER rejected (base context differs) is labelled baseline, not browser-local', async () => {
    const store = memoryStore();
    const s = report.report.suggestions[0]!;
    expect(writeOverrideState(store, 'fixture', null, {
      id: '01KGQZ0000G01DENCM00T15CR3', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [...s.proposed], verified: false, source: 'TEST',
      sourceReport: { id: report.report.id, generatedAt: report.report.generatedAt, multiplier: s.multiplier, contextFingerprint: base.fingerprint, current: [...s.current], rosterEtag: '"e1"', rosterIdentity: 'x' },
      base: { contextKind: 'golden-fixture', masterVersion: masterData().version, rulesVersion: base.rulesVersion, fingerprint: `sha256:${'a'.repeat(64)}` },
    }).ok).toBe(true);
    const a = activeEngine();
    const src = fixtureSource();
    renderRoute('/health', src.src, { loadGolden, store, engine: a.engine });
    expect((await screen.findByTestId('override-problem')).textContent).toMatch(/different base context/);
    await waitFor(() => expect(footer()).toMatch(/Model: none yet/));
    expect(footer()).not.toMatch(/browser-local/);
    expect(src.calls.some((c) => c.method === 'latestSnapshot')).toBe(true);
  });
  it.each([
    ['corrupt JSON', '{not json'],
    ['another data mode', prodActive({ mode: 'fixture' })],
    ['another context kind', prodActive({ contextKind: 'golden-fixture' })],
  ])('a stored record for %s is labelled baseline with the snapshot shown', async (_n, raw) => {
    const store = memoryStore();
    store.setItem(overrideKey('api'), raw);
    const e = prodEngine();
    const m = mockSource({ roster: goldenRoster(), snapshot: null });
    renderRoute('/health', m.src, { store, engine: e.engine });
    await screen.findByTestId('override-problem');
    await waitFor(() => expect(footer()).toMatch(/Model: none yet/));
    expect(m.calls.some((c) => c.method === 'latestSnapshot')).toBe(true);
  });
  it('on a route without an engine screen: no stored override → no worker configure; a valid one → ONE shared configure, confirmed browser-local', async () => {
    const none = prodEngine();
    const m1 = mockSource({ roster: goldenRoster(), snapshot: null });
    const r1 = renderRoute('/roster', m1.src, { engine: none.engine });
    await waitFor(() => expect(footer()).toMatch(/Model: none yet/));
    expect(none.configures).toEqual([]);
    r1.unmount();
    const store = memoryStore();
    store.setItem(overrideKey('api'), prodActive());
    const e = prodEngine((o) => fakeContext(o ? { override: { id: o.id, rule: 'blueStatGain', proposed: o.proposed, sourceReportId: o.sourceReportId, multiplier: o.multiplier }, fingerprint: `sha256:${'b'.repeat(64)}` } : {}) as ContextInfo);
    const m2 = mockSource({ roster: goldenRoster(), snapshot: null });
    const r2 = renderRoute('/roster', m2.src, { store, engine: e.engine });
    await waitFor(() => expect(footer()).toMatch(/Model: browser-local \(override\)/));
    expect(e.configures.map((o) => o?.id)).toEqual(['01KGQZ0000G01DENCM00T15CR1']);
    // Navigating to Health shares the SAME context query: no second configure.
    await act(async () => { await r2.router.navigate('/health'); });
    await screen.findByTestId('override-active');
    expect(e.configures.length).toBe(1);
    expect(m2.calls.some((c) => c.method === 'latestSnapshot')).toBe(false);
  });
});

describe('review r1 B2: reset confirmation is guarded synchronously and released in finally', () => {
  async function appliedFixtureStore() {
    const store = memoryStore();
    const s = report.report.suggestions[0]!;
    expect(writeOverrideState(store, 'fixture', null, {
      id: '01KGQZ0000G01DENCM00T15CR4', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [...s.proposed], verified: false, source: 'TEST',
      sourceReport: { id: report.report.id, generatedAt: report.report.generatedAt, multiplier: s.multiplier, contextFingerprint: base.fingerprint, current: [...s.current], rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster) },
      base: { contextKind: 'golden-fixture', masterVersion: masterData().version, rulesVersion: base.rulesVersion, fingerprint: base.baseFingerprint },
    }).ok).toBe(true);
    return store;
  }
  const resetBtn = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset' });
  it('a same-tick double click on Reset resets ONCE and reports success (no "nothing was reset" overwrite)', async () => {
    const store = await appliedFixtureStore();
    renderRoute('/health', fixtureSource().src, { loadGolden, store, engine: activeEngine().engine });
    await screen.findByTestId('override-active');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to fixture base rules' }));
    const btn = resetBtn();
    await act(async () => { btn.click(); btn.click(); });
    await new Promise((r) => setTimeout(r, 20));
    expect((await screen.findByTestId('rules-note')).textContent).toMatch(/^Reset done\./);
    expect(screen.getByTestId('rules-note').textContent).not.toMatch(/Nothing was reset/);
    expect(readOverride(store, 'fixture')).toMatchObject({ status: 'none', revision: 2 });
  });
  it('the guard holds across the awaited cross-tab lock (deferred), then releases: failure, then a retry succeeds', async () => {
    const store = await appliedFixtureStore();
    let failOnce = true;
    const faulty: KeyValueStore = { ...store, getItem: (k) => store.getItem(k), setItem: (k, v) => store.setItem(k, v), removeItem: (k) => { if (failOnce && k === localModelKey('fixture')) { failOnce = false; throw new Error('INJECTED one-shot cleanup fault'); } store.removeItem(k); } };
    store.setItem(localModelKey('fixture'), '{"placeholder":1}');
    const pending: (() => void)[] = [];
    let requests = 0;
    const locks = { request: (_n: string, _o: unknown, action: () => unknown) => { requests++; return new Promise((res) => pending.push(() => res(action()))); } };
    const had = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
    try {
      renderRoute('/health', fixtureSource().src, { loadGolden, store: faulty, engine: activeEngine().engine });
      await screen.findByTestId('override-active');
      await userEvent.click(screen.getByRole('button', { name: 'Reset to fixture base rules' }));
      const btn = resetBtn();
      await act(async () => { btn.click(); });
      await act(async () => { btn.click(); }); // a later click while the first waits for the lock
      expect(requests).toBe(1);
      await act(async () => { pending.shift()!(); });
      expect((await screen.findByTestId('rules-note')).textContent).toMatch(/Reset could not clear/);
      // Retry: the guard was released in finally.
      await userEvent.click(screen.getByRole('button', { name: 'Reset to fixture base rules' }));
      await act(async () => { resetBtn().click(); });
      expect(requests).toBe(2);
      await act(async () => { pending.shift()!(); });
      await waitFor(() => expect(screen.getByTestId('rules-note').textContent).toMatch(/^Reset done\./));
      expect(readOverride(store, 'fixture')).toMatchObject({ status: 'none', revision: 2 });
    } finally {
      if (had) Object.defineProperty(navigator, 'locks', had);
      else delete (navigator as { locks?: unknown }).locks;
    }
  });
});

describe('review r1 S1: override and report ids come from the INJECTED AppServices.random', () => {
  async function applyOnce(seed: number) {
    const a = activeEngine();
    const calIds: string[] = [];
    const calibrate = a.engine.calibrate.bind(a.engine);
    a.engine.calibrate = (r, o) => { calIds.push(o.id!); return calibrate(r, o); };
    const c = candidates({ auto: true });
    const r = await openReport({ engine: a.engine, candidateEngine: c.factory, random: seededRandom(seed) } as Partial<AppServices>);
    await userEvent.click(applyBtn());
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fit and apply' }));
    await screen.findByText(/Applied in this browser only/);
    const st = readOverride(r.store, 'fixture');
    if (st.status !== 'ok') throw new Error('not applied');
    const fp = c.made[0]!.override ? infoFor(c.made[0]!.override).fingerprint : '';
    r.unmount();
    return { overrideId: st.active.id, reportId: calIds[0]!, fp };
  }
  it('the same seed gives the same report id, override id and (identity-bookkeeping) fingerprint; ids follow the seeded sequence', async () => {
    const one = await applyOnce(0x15c);
    const two = await applyOnce(0x15c);
    expect(two).toEqual(one);
    const rnd = seededRandom(0x15c);
    expect(one.reportId).toBe(ulid(NOW.getTime(), rnd));
    expect(one.overrideId).toBe(ulid(NOW.getTime(), rnd));
    const other = await applyOnce(7);
    expect(other.overrideId).not.toBe(one.overrideId);
  });
  it('REAL worker: the same override id gives the same effective fingerprint across fresh engines; a different id differs', () => {
    const o = (id: string): WorkerOverride => ({ id, rule: 'blueStatGain', proposed: [13.2, 26.4, 39.6], baseFingerprint: base.baseFingerprint, sourceReportId: report.report.id, multiplier: 1.32 });
    const cfg = (id: string) => ok(createEngineApi().configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: { syntheticInheritance: truth.syntheticInheritance } as never, override: o(id) })).fingerprint;
    const id = ulid(NOW.getTime(), seededRandom(0x15c));
    expect(cfg(id)).toBe(cfg(id));
    expect(cfg(id)).not.toBe(cfg(ulid(NOW.getTime(), seededRandom(7))));
    console.info(`[T15c r1 S1] seeded override id ${id} → REAL effective fingerprint ${cfg(id)}`);
  });
});

describe('review r1 N1/N3', () => {
  it('N1: overwriting an invalid record keeps its recoverable revision monotonic; an unreadable one restarts at 1', () => {
    const store = memoryStore();
    store.setItem(overrideKey('fixture'), '{"schema":"uma-browser-rules-override","v":1,"mode":"fixture","revision":50,"active":{"rule":"blueStatGain","proposed":[1,-5,2]}}');
    const w = writeOverrideState(store, 'fixture', store.getItem(overrideKey('fixture')), null);
    expect(w).toMatchObject({ ok: true, revision: 51 });
    store.setItem(overrideKey('fixture'), '{garbage');
    expect(writeOverrideState(store, 'fixture', '{garbage', null)).toMatchObject({ ok: true, revision: 1 });
  });
  it('N3: after a reapply on top of an override, the text names the PREVIOUS override values, not the base values', async () => {
    const store = memoryStore();
    const s = report.report.suggestions[0]!;
    const prevFp = OVR_FP('01KGQZ0000G01DENCM00T15CP0');
    expect(writeOverrideState(store, 'fixture', null, {
      id: '01KGQZ0000G01DENCM00T15CR5', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [14, 28, 42], verified: false, source: 'TEST',
      sourceReport: { id: report.report.id, generatedAt: report.report.generatedAt, multiplier: 1.06, contextFingerprint: prevFp, current: [...s.proposed], rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster) },
      base: { contextKind: 'golden-fixture', masterVersion: masterData().version, rulesVersion: base.rulesVersion, fingerprint: base.baseFingerprint },
    }).ok).toBe(true);
    renderRoute('/health', fixtureSource().src, { loadGolden, store, engine: activeEngine().engine });
    const t = (await screen.findByTestId('override-active')).textContent!;
    expect(t).toMatch(/replaces the previous browser-local override/);
    expect(t).toMatch(/base context remains the SYNTHETIC golden fixture base context/);
    expect(t).not.toMatch(/replaces [\d. /]+ of the SYNTHETIC/);
  });
  it('N3: a first apply (report ran on the base) still says it replaces the base values', async () => {
    const store = memoryStore();
    const s = report.report.suggestions[0]!;
    expect(writeOverrideState(store, 'fixture', null, {
      id: '01KGQZ0000G01DENCM00T15CR6', appliedAt: NOW.toISOString(), rule: 'blueStatGain', proposed: [...s.proposed], verified: false, source: 'TEST',
      sourceReport: { id: report.report.id, generatedAt: report.report.generatedAt, multiplier: s.multiplier, contextFingerprint: base.baseFingerprint, current: [...s.current], rosterEtag: '"e1"', rosterIdentity: rosterIdentity(roster) },
      base: { contextKind: 'golden-fixture', masterVersion: masterData().version, rulesVersion: base.rulesVersion, fingerprint: base.baseFingerprint },
    }).ok).toBe(true);
    renderRoute('/health', fixtureSource().src, { loadGolden, store, engine: activeEngine().engine });
    expect((await screen.findByTestId('override-active')).textContent).toMatch(/replaces [\d. /]+ of the SYNTHETIC golden fixture base context/);
  });
});
