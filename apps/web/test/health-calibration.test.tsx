/**
 * T15b S07 calibration (61 §S07 states, §Report display). MOCK DataSource and a FAKE worker
 * (`fakeEngine`) drive the UI states. The base reports are REAL `calibrateRules` output computed in
 * `beforeAll` through the worker surface (createEngineApi, in-process); the `fake*` variants below
 * are clearly labelled edits of that real output that reach specific render branches. Completion
 * evidence for the real worker path is calibration-worker.test.ts and e2e/calibration.spec.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterVeteran } from '@uma/schema';
import { createEngineApi, type CalibrationOutput, type EngineResult, type FitOutput } from '../src/workers/engine.api.ts';
import { fakeEngine, mockSource, NOW, renderRoute } from './harness.tsx';
import { calibrationRoster, goldenRoster, goldenTruth, masterBundle, masterData } from './fixtures.ts';
import { memoryStore } from '../src/lib/storage.ts';

const roster = goldenRoster();
let synthetic: CalibrationOutput;
let production: CalibrationOutput;
let empty: CalibrationOutput;
let fit: FitOutput;
const ok = <T,>(r: EngineResult<T>): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
beforeAll(() => {
  const g = createEngineApi();
  ok(g.configure({ bundle: masterBundle(), kind: 'golden-fixture', golden: { syntheticInheritance: goldenTruth().syntheticInheritance } as never }));
  synthetic = ok(g.calibrate(calibrationRoster(), { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15B11' }));
  fit = ok(g.fit(roster, { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15BFT' }));
  const p = createEngineApi();
  ok(p.configure({ bundle: masterBundle(), kind: 'production' }));
  production = ok(p.calibrate(calibrationRoster(), { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15B12' }));
  empty = ok(p.calibrate([], { nowIso: NOW.toISOString(), id: '01KGQZ0000G01DENCM00T15B13' }));
}, 180_000);

/** The fake worker's configure must report the same versions the report carries. */
const ctxValue = (o: CalibrationOutput) => ({
  ok: true,
  value: { kind: o.context.kind, masterVersion: o.report.masterVersion, rulesVersion: o.report.rulesVersion, unverifiedRules: o.context.unverifiedRules, placeholderRules: o.context.placeholderRules, warnings: [], overrides: o.context.overrides,
    fingerprint: o.context.fingerprint, baseFingerprint: o.context.baseFingerprint, baseRulesVersion: o.report.rulesVersion, override: null, overrideRejected: null, effectiveRules: masterBundle().rules },
});
interface D<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
const deferred = <T,>(): D<T> => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
/** FAKE worker whose calibrate calls are settled by the test. */
function scripted(base: () => CalibrationOutput) {
  const calls: D<unknown>[] = [];
  const fits: unknown[] = [];
  const engine = fakeEngine({
    configure: async () => ctxValue(base()),
    calibrate: () => { const d = deferred<unknown>(); calls.push(d); return d.promise; },
    fit: async (...a) => { fits.push(a); return { ok: true, value: fit }; },
  });
  return { engine, calls, fits };
}
const run = () => screen.getByRole('button', { name: 'Run calibration' }) as HTMLButtonElement;
const ready = () => waitFor(() => expect(run().disabled).toBe(false));
const clone = <T,>(x: T): T => structuredClone(x);

describe('S07 calibration: run, states and read-only behaviour', () => {
  it('runs without a model snapshot and shows the REAL synthetic report as an unverified, unapplied proposal', async () => {
    const { engine, calls } = scripted(() => synthetic);
    const store = memoryStore();
    const { src, calls: http } = mockSource({ roster, snapshot: null });
    renderRoute('/health', src, { engine, store });
    expect(await screen.findByText(/No model yet/)).toBeTruthy();
    await ready();
    await userEvent.click(run());
    const running = await screen.findByTestId('calib-running');
    expect(running.textContent).toMatch(/Calibrating…/);
    expect(running.textContent).not.toMatch(/\d\s?%/); // no fake progress percentage
    expect(within(running).queryByRole('progressbar')).toBeNull();
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic }));
    const panel = await screen.findByTestId('calibration-report');
    const m = synthetic.report.stats.selected!.multiplier;
    expect(within(panel).getByTestId('calib-selection').textContent).toMatch(new RegExp(`×${m.toFixed(2)}`));
    expect(within(panel).getByText(/SYNTHETIC golden fixture context/)).toBeTruthy();
    const apply = within(panel).getByRole('button', { name: 'Apply suggested multipliers' }) as HTMLButtonElement;
    // T15c: a current, suggested report offers the explicit (confirmed, fit-before-commit) Apply.
    expect(apply.disabled).toBe(false);
    expect(within(panel).getByText(/Apply \(only for a suggested proposal of a current report\) asks for confirmation/)).toBeTruthy();
    expect(within(panel).getByText(/checks available.*not verified/i)).toBeTruthy();
    // Read-only: no snapshot stored, no fit record, no backend write.
    expect(http.map((c) => c.method).filter((x) => !['roster', 'latestSnapshot', 'health', 'reviewItems'].includes(x))).toEqual([]);
    expect(store.getItem('uma:api:model-fit')).toBeNull();
    expect(screen.getByText(/No model yet/)).toBeTruthy();
  });

  it('production placeholder: nonidentifiable reasons, full likelihood unavailable (never 0), conditional with its denominator, impossible/invalid counts', async () => {
    const { engine, calls } = scripted(() => production);
    renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    await act(async () => calls[0]!.resolve({ ok: true, value: production }));
    const panel = await screen.findByTestId('calibration-report');
    const r = production.report;
    expect(within(panel).getByText(/Production context/)).toBeTruthy();
    expect(within(panel).getByTestId('calib-selection').textContent).toMatch(/No multiplier selected.*nonidentifiable/);
    for (const reason of r.stats.nonidentifiable!.reasons) expect(within(panel).getAllByText(reason).length).toBeGreaterThan(0);
    const apt = within(panel).getByTestId('calib-aptitude');
    expect(within(apt).getByTestId('apt-full').textContent).toMatch(/unavailable/);
    expect(within(apt).getByTestId('apt-full').textContent).toMatch(/zero-probability-observed/);
    expect(within(apt).getByTestId('apt-full').textContent).not.toMatch(/\b0\.00\b/);
    expect(within(apt).getByTestId('apt-conditional').textContent).toContain(`${r.aptitude.possibleCells} possible cells`);
    expect(within(apt).getByTestId('apt-conditional').textContent).toMatch(/conditional/i);
    expect(within(apt).getByTestId('apt-impossible').textContent).toContain(String(r.aptitude.impossible));
    expect(within(apt).getByTestId('apt-impossible').textContent).toContain(`above max ${r.aptitude.aboveMax}`);
    expect(within(apt).getByTestId('apt-invalid').textContent).toContain(`${r.aptitude.invalidObserved}`);
    expect(within(apt).getByTestId('apt-status').textContent).toMatch(/uninformative/);
    expect(within(panel).getAllByText(/placeholder/i).length).toBeGreaterThan(0);
    expect(within(panel).queryByText(/Suggested blueStatGain/)).toBeNull();
    expect(within(panel).getByTestId('calib-status').textContent).toMatch(/partial/);
    expect(within(panel).getByTestId('calib-not-calibrated').textContent).toContain('blueStatGain');
  });

  it('an empty roster report is a diagnostic outcome, not an error', async () => {
    const { engine, calls } = scripted(() => empty);
    renderRoute('/health', mockSource({ roster: [], snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    await act(async () => calls[0]!.resolve({ ok: true, value: empty }));
    const panel = await screen.findByTestId('calibration-report');
    expect(within(panel).getByTestId('calib-selection').textContent).toMatch(/insufficient-data/);
    expect(within(panel).getByTestId('calib-population').textContent).toMatch(/0 used/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cancel shows accessible text and Retry calls the worker again; crash and typed errors also offer Retry', async () => {
    const { engine, calls } = scripted(() => synthetic);
    renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel calibration' }));
    expect(await screen.findByText('Calibration cancelled.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry calibration' }));
    await waitFor(() => expect(calls.length).toBe(2));
    await act(async () => calls[1]!.reject(new Error('worker died')));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Calibration failed: the engine worker stopped: worker died/);
    await userEvent.click(screen.getByRole('button', { name: 'Retry calibration' }));
    await waitFor(() => expect(calls.length).toBe(3));
    await act(async () => calls[2]!.resolve({ ok: false, error: { name: 'ModelInputError', message: 'duplicate-id: x', code: 'duplicate-id' } }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Calibration failed:.*duplicate-id/);
    await userEvent.click(screen.getByRole('button', { name: 'Retry calibration' }));
    await waitFor(() => expect(calls.length).toBe(4));
    await act(async () => calls[3]!.resolve({ ok: true, value: synthetic }));
    expect(await screen.findByTestId('calibration-report')).toBeTruthy();
  });

  it('Dismiss clears the report only; Refit still works and stores a snapshot', async () => {
    const { engine, calls, fits } = scripted(() => synthetic);
    const data = { snapshot: null as FitOutput['snapshot'] | null };
    const { src } = mockSource({ roster }, { latestSnapshot: async () => data.snapshot, storeSnapshot: async (s) => { data.snapshot = s; return s; } });
    renderRoute('/health', src, { engine });
    await ready();
    await userEvent.click(run());
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic }));
    await screen.findByTestId('calibration-report');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('calibration-report')).toBeNull();
    expect(screen.getByText("Calibration hasn't been run.")).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Refit model' }));
    expect(await screen.findByText(/From the fit run in this tab/)).toBeTruthy();
    expect(fits.length).toBe(1);
  });

  it('same-tick double click starts ONE calibration; refit is refused while it runs (and vice versa)', async () => {
    const { engine, calls, fits } = scripted(() => synthetic);
    renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    const b = run();
    act(() => { b.click(); b.click(); });
    const refit = screen.getByRole('button', { name: 'Refit model' }) as HTMLButtonElement;
    act(() => refit.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await waitFor(() => expect(calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(1);
    expect(fits.length).toBe(0);
    expect(engine.busy).not.toBeNull();
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic }));
    await screen.findByTestId('calibration-report');
  });

  it('route unmount cancels only the owned calibration job', async () => {
    const { engine } = scripted(() => synthetic);
    const a = renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    await waitFor(() => expect(engine.busy).not.toBeNull());
    a.unmount();
    expect(engine.busy).toBeNull();
    // A job owned by another screen survives a Health mount/unmount that owns nothing.
    const b = renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Run calibration' }) as HTMLButtonElement).disabled).toBe(false));
    const other = engine.fit(roster, { nowIso: NOW.toISOString() });
    b.unmount();
    expect(engine.busy).toBe(other.generation);
    other.cancel();
  });
});

describe('S07 calibration: provenance and stale authority', () => {
  function changingRoster() {
    const state = { etag: '"r1"', roster: roster as RosterVeteran[] };
    const { src } = mockSource({ roster, snapshot: null }, { roster: async () => ({ etag: state.etag, roster: state.roster, notModified: false }) });
    return { state, src };
  }
  it('a finished report becomes STALE (never relabelled current) when the roster changes', async () => {
    const { engine, calls } = scripted(() => synthetic);
    const { state, src } = changingRoster();
    const { qc } = renderRoute('/health', src, { engine });
    await ready();
    await userEvent.click(run());
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic }));
    await screen.findByTestId('calibration-report');
    expect(screen.queryByTestId('calib-stale')).toBeNull();
    state.etag = '"r2"'; state.roster = roster.slice(1);
    await act(async () => { await qc.invalidateQueries({ queryKey: ['roster'] }); });
    expect((await screen.findByTestId('calib-stale')).textContent).toMatch(/Stale report.*roster changed/);
    expect(screen.getByTestId('calibration-report').getAttribute('data-stale')).toBe('true');
  });

  it('a late reply for an older roster is refused while running; the user is told why', async () => {
    const { engine, calls } = scripted(() => synthetic);
    const { state, src } = changingRoster();
    const { qc } = renderRoute('/health', src, { engine });
    await ready();
    await userEvent.click(run());
    await waitFor(() => expect(calls.length).toBe(1));
    state.etag = '"r2"'; state.roster = roster.slice(1);
    await act(async () => { await qc.invalidateQueries({ queryKey: ['roster'] }); });
    expect(await screen.findByText(/inputs changed while it ran.*roster changed/)).toBeTruthy();
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('calibration-report')).toBeNull();
    expect(engine.busy).toBeNull();
  });

  it('a context/rules reconfigure terminates a running calibration (refused, with reason) and marks a finished report stale', async () => {
    let rules = synthetic.report.rulesVersion;
    const calls: D<unknown>[] = [];
    const engine = fakeEngine({
      configure: async () => { const v = ctxValue(synthetic); v.value.rulesVersion = rules; return v; },
      calibrate: () => { const d = deferred<unknown>(); calls.push(d); return d.promise; },
    });
    const { qc } = renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    await waitFor(() => expect(calls.length).toBe(1));
    rules = 'rules-next';
    await act(async () => { await qc.invalidateQueries({ queryKey: ['engine-context'] }); });
    expect(await screen.findByText(/Calibration stopped: the engine was reconfigured/)).toBeTruthy();
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic })); // late reply from the terminated job
    expect(screen.queryByTestId('calibration-report')).toBeNull();
    // Finished report, then the rules change again: stale, not current.
    await userEvent.click(screen.getByRole('button', { name: 'Retry calibration' }));
    await waitFor(() => expect(calls.length).toBe(2));
    const next = clone(synthetic); next.report.rulesVersion = 'rules-next';
    await act(async () => calls[1]!.resolve({ ok: true, value: next }));
    await screen.findByTestId('calibration-report');
    rules = 'rules-third';
    await act(async () => { await qc.invalidateQueries({ queryKey: ['engine-context'] }); });
    expect((await screen.findByTestId('calib-stale')).textContent).toMatch(/rules changed/);
  });

  it('a reply whose master/rules versions differ from the run provenance is refused', async () => {
    const { engine, calls } = scripted(() => synthetic);
    renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    const wrong = clone(synthetic); wrong.report.rulesVersion = 'other-rules';
    await act(async () => calls[0]!.resolve({ ok: true, value: wrong }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/does not match/);
    expect(screen.queryByTestId('calibration-report')).toBeNull();
  });

  it('the report survives navigation within the tab session but is never persisted to storage', async () => {
    const { engine, calls } = scripted(() => synthetic);
    const inner = memoryStore();
    const writes: string[] = [];
    const store = { ...inner, setItem: (k: string, v: string) => { writes.push(k); inner.setItem(k, v); } };
    const { router } = renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine, store });
    await ready();
    await userEvent.click(run());
    await act(async () => calls[0]!.resolve({ ok: true, value: synthetic }));
    await screen.findByTestId('calibration-report');
    await act(async () => { await router.navigate('/targets'); });
    await act(async () => { await router.navigate('/health'); });
    expect(await screen.findByTestId('calibration-report')).toBeTruthy();
    expect(writes.filter((k) => /calib|model-fit/i.test(k))).toEqual([]);
    expect(sessionStorage.length).toBe(0);
    expect(Object.keys(localStorage).filter((k) => /calib/i.test(k))).toEqual([]);
  });
});

describe('S07 calibration: truthful report fields (FAKE variants of the real report)', () => {
  async function show(out: CalibrationOutput) {
    const { engine, calls } = scripted(() => out);
    renderRoute('/health', mockSource({ roster, snapshot: null }).src, { engine });
    await ready();
    await userEvent.click(run());
    await act(async () => calls[0]!.resolve({ ok: true, value: out }));
    return screen.findByTestId('calibration-report');
  }

  it('FAKE: fold gate blocks selection although the raw rank diagnostic says identified', async () => {
    const o = clone(synthetic);
    o.report.stats.status = 'nonidentifiable';
    o.report.stats.selected = null;
    o.report.stats.trainCvSelected = null;
    o.report.stats.nonidentifiable = { reasons: ['the multiplier is not identified on CV fold(s) 0 (design-confounded)'] };
    o.report.stats.identification!.status = 'identified';
    o.report.suggestions = [];
    o.report.status = 'partial';
    const panel = await show(o);
    expect(within(panel).getByTestId('calib-selection').textContent).toMatch(/No multiplier selected/);
    expect(within(panel).getByTestId('calib-gate-conflict').textContent).toMatch(/rank diagnostic says identified.*selection is blocked/i);
    expect(within(panel).queryByText(/Suggested blueStatGain/)).toBeNull();
    expect(within(panel).getByText(/numerically non-collinear, not well-determined/)).toBeTruthy();
  });

  it('FAKE: unavailable confidence interval and unknown agreement are shown as such, not as numbers', async () => {
    const o = clone(synthetic);
    o.report.stats.bootstrap = null;
    o.report.stats.uncertainty = { ...o.report.stats.uncertainty, status: 'insufficient-holdout', reason: 'only 12 holdout rows (need ≥ 20)' };
    o.report.stats.selectionAgreement = { ...o.report.stats.selectionAgreement!, withinInterval: null };
    o.report.suggestions = o.report.suggestions.map((s) => ({ ...s, consistentWithCurrent: null }));
    const panel = await show(o);
    const conf = within(panel).getByTestId('calib-confidence');
    expect(conf.textContent).toMatch(/insufficient-holdout/);
    expect(conf.textContent).toMatch(/only 12 holdout rows/);
    expect(conf.textContent).toMatch(/Interval: unavailable/);
    expect(conf.textContent).toMatch(/agreement: unknown/i);
    expect(within(panel).getByTestId('calib-suggestions').textContent).toMatch(/consistent with current: unknown/i);
  });

  it('REAL: the available interval is labelled conditional, not full uncertainty; MAE fields present', async () => {
    const panel = await show(synthetic);
    const s = synthetic.report.stats;
    const conf = within(panel).getByTestId('calib-confidence');
    expect(conf.textContent).toMatch(/conditional/i);
    expect(conf.textContent).toMatch(/not full uncertainty/i);
    expect(conf.textContent).toContain(`${s.bootstrap!.p05.toFixed(2)}–${s.bootstrap!.p95.toFixed(2)}`);
    const mae = within(panel).getByTestId('calib-mae');
    expect(mae.textContent).toContain(s.evaluation.currentHoldoutMae!.toFixed(2));
    expect(mae.textContent).toContain(s.withoutInheritance!.holdoutMae.toFixed(2));
    expect(mae.textContent).toContain(s.evaluation.holdoutMaeOfTrainCvSelection!.toFixed(2));
    expect(mae.textContent).toMatch(/post-selection/i);
    expect(within(panel).getByTestId('calib-population').textContent).toContain(`train ${synthetic.report.split.trainIds.length}`);
    expect(within(panel).getByTestId('calib-population').textContent).toContain(`holdout ${synthetic.report.split.holdoutIds.length}`);
  });

  it('FAKE: skills with no scored cells show unavailable metrics, never a perfect 0', async () => {
    const o = clone(synthetic);
    o.report.skills.status = 'insufficient-data';
    o.report.skills.candidates = o.report.skills.candidates.map((c) => ({ ...c, holdout: { ...c.holdout, status: 'insufficient-data', cells: 0, logLik: null, meanLogLik: null, brier: null, z: null } }));
    const panel = await show(o);
    const sk = within(panel).getByTestId('calib-skills');
    expect(sk.textContent).toMatch(/insufficient-data/);
    expect(sk.textContent).toMatch(/0 scored cells/);
    expect(sk.textContent).toMatch(/unavailable/);
    expect(sk.textContent).not.toMatch(/\b0\.000\b/);
  });

  it('FAKE: invalid observed grades and an all-degenerate uninformative aptitude check with finite likelihood', async () => {
    const o = clone(synthetic);
    o.report.aptitude.status = 'uninformative';
    o.report.aptitude.uninformative = 'every cell is degenerate';
    o.report.aptitude.invalidObserved = 3;
    const panel = await show(o);
    const apt = within(panel).getByTestId('calib-aptitude');
    expect(within(apt).getByTestId('apt-status').textContent).toMatch(/uninformative.*every cell is degenerate/);
    expect(within(apt).getByTestId('apt-full').textContent).toContain(Math.abs(o.report.aptitude.logLik!).toFixed(2));
    expect(within(apt).getByTestId('apt-invalid').textContent).toMatch(/3 invalid/);
  });

  it('REAL: complete status is explained as checks available, not verified', async () => {
    expect(synthetic.report.status).toBe('complete');
    const panel = await show(synthetic);
    expect(within(panel).getByTestId('calib-status').textContent).toMatch(/complete/);
    expect(within(panel).getByText(/checks available.*not verified/i)).toBeTruthy();
  });

  it('master version is from the loaded master (sanity for the fake configure)', () => {
    expect(synthetic.report.masterVersion).toBe(masterData().version);
  });
});
