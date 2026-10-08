/**
 * T15b EngineClient calibration jobs (61 §Worker boundary). A FAKE worker factory (labelled)
 * stands in for the browser Worker so the test can settle each call by hand; the real engine runs
 * in calibration-worker.test.ts and in Playwright (e2e/calibration.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import { EngineClient, type EngineHandle } from '../src/workers/client.ts';
import type { EngineResult } from '../src/workers/engine.api.ts';

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

interface FakeWorker {
  terminated: boolean;
  configures: number;
  calls: { method: string; args: unknown[]; d: Deferred<EngineResult<unknown>> }[];
}
/** FAKE worker: every call is structured-cloned (as Comlink would) and returns a deferred. */
function fakeFactory() {
  const workers: FakeWorker[] = [];
  const factory = (): EngineHandle => {
    const w: FakeWorker = { terminated: false, configures: 0, calls: [] };
    workers.push(w);
    const call = (method: string) => (...args: unknown[]) => {
      // structuredClone throws DataCloneError on functions: nothing callable may cross the boundary.
      structuredClone(args);
      const d = deferred<EngineResult<unknown>>();
      w.calls.push({ method, args, d });
      return d.promise;
    };
    const remote = {
      configure: async () => { w.configures++; return { ok: true, value: { kind: 'production' } }; },
      fit: call('fit'),
      rank: call('rank'),
      calibrate: call('calibrate'),
    } as unknown as EngineHandle['remote'];
    return { remote, terminate: () => void (w.terminated = true) };
  };
  return { workers, factory };
}
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
const cfg = { bundle: {} as never, kind: 'production' as const };
const NOW = { nowIso: '2026-10-08T00:00:00.000Z' };

describe('EngineClient.calibrate', () => {
  it('runs the worker calibrate call with serializable arguments only and returns its result', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const job = c.calibrate([], { nowIso: NOW.nowIso, id: 'R1' });
    await tick();
    const call = f.workers[0]!.calls[0]!;
    expect(call.method).toBe('calibrate');
    expect(call.args).toEqual([[], { nowIso: NOW.nowIso, id: 'R1' }]);
    expect(call.args.some((a) => typeof a === 'function')).toBe(false);
    call.d.resolve({ ok: true, value: 'report' });
    expect(await job.promise).toEqual({ status: 'done', result: { ok: true, value: 'report' } });
    expect(c.busy).toBeNull();
  });

  it('cancel terminates the synchronous calculation; a late reply from the dead worker is dropped; retry reconfigures a fresh worker', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const a = c.calibrate([], NOW);
    await tick();
    a.cancel();
    expect(await a.promise).toEqual({ status: 'cancelled' });
    expect(f.workers[0]!.terminated).toBe(true);
    f.workers[0]!.calls[0]!.d.resolve({ ok: true, value: 'late' });
    const b = c.calibrate([], NOW);
    await tick();
    expect(c.workersCreated).toBe(2);
    expect(f.workers[1]!.configures).toBe(1);
    f.workers[1]!.calls[0]!.d.resolve({ ok: true, value: 'fresh' });
    expect(await b.promise).toEqual({ status: 'done', result: { ok: true, value: 'fresh' } });
  });

  it('a fit started during calibration supersedes it; the calibration reply can never win', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const cal = c.calibrate([], NOW);
    await tick();
    const fit = c.fit([], NOW);
    expect(await cal.promise).toEqual({ status: 'superseded' });
    await tick();
    f.workers[0]!.calls[0]!.d.resolve({ ok: true, value: 'stale-calibration' });
    f.workers[1]!.calls[0]!.d.resolve({ ok: true, value: 'fit' });
    expect(await fit.promise).toEqual({ status: 'done', result: { ok: true, value: 'fit' } });
    expect(cal.generation).toBeLessThan(fit.generation);
  });

  it('a calibration started during a fit supersedes the fit', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const fit = c.fit([], NOW);
    await tick();
    const cal = c.calibrate([], NOW);
    expect(await fit.promise).toEqual({ status: 'superseded' });
    await tick();
    f.workers[1]!.calls[0]!.d.resolve({ ok: true, value: 'cal' });
    expect(await cal.promise).toEqual({ status: 'done', result: { ok: true, value: 'cal' } });
  });

  it("an old job's cancel handle does not cancel a newer job", async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const a = c.calibrate([], NOW);
    await tick();
    const b = c.calibrate([], NOW);
    await a.promise;
    a.cancel();
    await tick();
    expect(c.busy).toBe(b.generation);
    f.workers[1]!.calls[0]!.d.resolve({ ok: true, value: 'B' });
    expect(await b.promise).toEqual({ status: 'done', result: { ok: true, value: 'B' } });
  });

  it('a worker crash settles "crashed"; retry runs on a new worker', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const a = c.calibrate([], NOW);
    await tick();
    f.workers[0]!.calls[0]!.d.reject(new Error('worker died'));
    expect(await a.promise).toEqual({ status: 'crashed', message: 'worker died' });
    expect(f.workers[0]!.terminated).toBe(true);
    const b = c.calibrate([], NOW);
    await tick();
    expect(f.workers[1]!.configures).toBe(1);
    f.workers[1]!.calls[0]!.d.resolve({ ok: true, value: 'ok' });
    expect((await b.promise).status).toBe('done');
  });

  it('reconfiguring (master/context change) cancels a running calibration', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const a = c.calibrate([], NOW);
    await tick();
    await c.configure({ ...cfg, bundle: { version: 'm2' } as never });
    expect(await a.promise).toEqual({ status: 'cancelled' });
    f.workers[0]!.calls[0]!.d.resolve({ ok: true, value: 'stale' });
    expect(c.busy).toBeNull();
  });
});
