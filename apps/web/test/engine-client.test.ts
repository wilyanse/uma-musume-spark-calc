/**
 * EngineClient boundary (60 §3): cancellation by terminate/recreate, superseding, stale-result
 * suppression, crash handling and configure replay. A FAKE worker factory (labelled) stands in
 * for the browser Worker; the real engine runs in the worker-api test and in Playwright.
 */
import { describe, expect, it } from 'vitest';
import { EngineClient, type EngineHandle } from '../src/workers/client.ts';
import type { EngineApi, EngineResult } from '../src/workers/engine.api.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

/** FAKE worker: each call returns a deferred the test settles by hand. */
function fakeFactory() {
  const workers: { terminated: boolean; configures: number; fits: Deferred<EngineResult<unknown>>[] }[] = [];
  const factory = (): EngineHandle => {
    const w = { terminated: false, configures: 0, fits: [] as Deferred<EngineResult<unknown>>[] };
    workers.push(w);
    const remote = {
      configure: async () => {
        w.configures++;
        return { ok: true, value: { kind: 'production' } };
      },
      fit: () => {
        const d = deferred<EngineResult<unknown>>();
        w.fits.push(d);
        return d.promise;
      },
      rank: () => {
        const d = deferred<EngineResult<unknown>>();
        w.fits.push(d);
        return d.promise;
      },
    } as unknown as EngineHandle['remote'];
    return { remote, terminate: () => void (w.terminated = true) };
  };
  return { workers, factory };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const cfg = { bundle: {} as never, kind: 'production' as const };
type Api = EngineApi;
void (null as unknown as Api);

describe('EngineClient', () => {
  it('changing master/context cancels the running worker before reconfiguration', async () => {
    const f = fakeFactory(); const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const a = c.rank({} as never, {} as never, [], {} as never, {}, { contextFingerprint: 'x' });
    await tick();
    await c.configure({ ...cfg, bundle: { version: 'new-master' } as never });
    expect(await a.promise).toEqual({ status: 'cancelled' });
    expect(f.workers[0]!.terminated).toBe(true);
    expect(c.workersCreated).toBe(2);
  });
  it('runs a job and returns its result', async () => {
    const f = fakeFactory();
    const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const job = c.fit([], { nowIso: '2026-10-01T00:00:00.000Z' });
    await tick();
    f.workers[0]!.fits[0]!.resolve({ ok: true, value: 42 });
    expect(await job.promise).toEqual({ status: 'done', result: { ok: true, value: 42 } });
    expect(c.busy).toBeNull();
  });

  it('cancel terminates the worker, settles "cancelled", and the next job uses a fresh configured worker', async () => {
    const f = fakeFactory();
    const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const job = c.fit([], { nowIso: '2026-10-01T00:00:00.000Z' });
    await tick();
    job.cancel();
    expect(await job.promise).toEqual({ status: 'cancelled' });
    expect(f.workers[0]!.terminated).toBe(true);
    // A late completion from the dead worker is ignored.
    f.workers[0]!.fits[0]!.resolve({ ok: true, value: 'stale' });
    const job2 = c.fit([], { nowIso: '2026-10-01T00:00:00.000Z' });
    await tick();
    await tick();
    expect(c.workersCreated).toBe(2);
    expect(f.workers[1]!.configures).toBe(1); // configure replayed on the new worker
    f.workers[1]!.fits[0]!.resolve({ ok: true, value: 'fresh' });
    expect(await job2.promise).toEqual({ status: 'done', result: { ok: true, value: 'fresh' } });
  });

  it('a new job supersedes the running one; the old result can never overwrite the new one', async () => {
    const f = fakeFactory();
    const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const a = c.rank({} as never, {} as never, [], {} as never, {}, { contextFingerprint: 'x' });
    await tick();
    const b = c.rank({} as never, {} as never, [], {} as never, {}, { contextFingerprint: 'x' });
    expect(await a.promise).toEqual({ status: 'superseded' });
    expect(f.workers[0]!.terminated).toBe(true);
    await tick();
    await tick();
    f.workers[0]!.fits[0]!.resolve({ ok: true, value: 'A' }); // stale
    f.workers[1]!.fits[0]!.resolve({ ok: true, value: 'B' });
    expect(await b.promise).toEqual({ status: 'done', result: { ok: true, value: 'B' } });
    expect(a.generation).toBeLessThan(b.generation);
  });

  it('a crash (rejected call) settles "crashed" and drops the worker', async () => {
    const f = fakeFactory();
    const c = new EngineClient(f.factory);
    await c.configure(cfg);
    const job = c.fit([], { nowIso: '2026-10-01T00:00:00.000Z' });
    await tick();
    f.workers[0]!.fits[0]!.reject(new Error('worker died'));
    expect(await job.promise).toEqual({ status: 'crashed', message: 'worker died' });
    expect(f.workers[0]!.terminated).toBe(true);
  });

  it('cancel on an idle client is a no-op and an old job handle cannot cancel a newer job', async () => {
    const f = fakeFactory();
    const c = new EngineClient(f.factory);
    await c.configure(cfg);
    c.cancel();
    const a = c.fit([], { nowIso: 'x' });
    await tick();
    f.workers[0]!.fits[0]!.resolve({ ok: true, value: 1 });
    await a.promise;
    const b = c.fit([], { nowIso: 'x' });
    a.cancel(); // stale handle
    await tick();
    expect(c.busy).toBe(b.generation);
    f.workers[0]!.fits[1]!.resolve({ ok: true, value: 2 });
    expect((await b.promise).status).toBe('done');
  });
});
