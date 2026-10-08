/**
 * Main-thread side of the engine worker (60 §1, §3).
 *
 * `rankPairs` is synchronous inside the worker, so the only way to cancel it is to terminate the
 * worker. `EngineClient` therefore:
 * - runs one job at a time; starting a job while another runs terminates the worker (the old job
 *   resolves `superseded`), and `cancel()` terminates it too (`cancelled`);
 * - recreates the worker lazily and re-sends the last `configure` input before the next job;
 * - tags every job with a generation number, so a result that completes after it was superseded
 *   or cancelled is dropped and can never overwrite a newer request's result.
 */
import { proxy, wrap, type Remote } from 'comlink';
import type { CmTarget, ModelSnapshot, RosterVeteran } from '@uma/schema';
import type { PlanInput, RankOptions, RankProgress, RankResult } from '@uma/engine';
import type { CalibrateOpts, CalibrationOutput, ConfigureInput, ContextInfo, EngineApi, EngineResult, FitOutput } from './engine.api.ts';

export interface EngineHandle {
  remote: Remote<EngineApi>;
  terminate(): void;
}
export type EngineFactory = () => EngineHandle;

export const browserEngineFactory: EngineFactory = () => {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  return { remote: wrap<EngineApi>(worker), terminate: () => worker.terminate() };
};

export type JobOutcome<T> =
  | { status: 'done'; result: EngineResult<T> }
  | { status: 'cancelled' }
  | { status: 'superseded' }
  | { status: 'crashed'; message: string };

export interface Job<T> {
  generation: number;
  promise: Promise<JobOutcome<T>>;
  cancel(): void;
}

interface Running {
  generation: number;
  settle: (o: JobOutcome<never>) => void;
}

export class EngineClient {
  private handle: EngineHandle | null = null;
  private configuredHandle: EngineHandle | null = null;
  private config: ConfigureInput | null = null;
  private configResult: Promise<EngineResult<ContextInfo>> | null = null;
  private running: Running | null = null;
  private generation = 0;
  /** Number of workers created (exposed for tests and diagnostics). */
  workersCreated = 0;

  constructor(private readonly factory: EngineFactory = browserEngineFactory) {}

  private ensureHandle(): EngineHandle {
    if (!this.handle) {
      this.handle = this.factory();
      this.workersCreated++;
    }
    return this.handle;
  }

  /** Sets the context for every later job (re-sent after a worker is recreated). */
  configure(input: ConfigureInput): Promise<EngineResult<ContextInfo>> {
    this.cancel();
    this.config = input;
    this.configuredHandle = null;
    this.configResult = null;
    return this.ensureConfigured();
  }

  private ensureConfigured(): Promise<EngineResult<ContextInfo>> {
    const h = this.ensureHandle();
    if (!this.config) return Promise.reject(new Error('EngineClient.configure was never called'));
    if (this.configuredHandle !== h || !this.configResult) {
      this.configuredHandle = h;
      this.configResult = h.remote.configure(this.config) as Promise<EngineResult<ContextInfo>>;
    }
    return this.configResult;
  }

  /** The current job's generation, or null when idle. */
  get busy(): number | null {
    return this.running?.generation ?? null;
  }

  private terminate(): void {
    this.handle?.terminate();
    this.handle = null;
    this.configuredHandle = null;
    this.configResult = null;
  }

  /** Cancels the running job (terminates the worker). No-op when idle. */
  cancel(): void {
    if (!this.running) return;
    const r = this.running;
    this.running = null;
    this.terminate();
    r.settle({ status: 'cancelled' });
  }

  private run<T>(call: (remote: Remote<EngineApi>) => Promise<EngineResult<T>>): Job<T> {
    if (this.running) {
      const prev = this.running;
      this.running = null;
      this.terminate();
      prev.settle({ status: 'superseded' });
    }
    const generation = ++this.generation;
    let settle!: (o: JobOutcome<T>) => void;
    const promise = new Promise<JobOutcome<T>>((res) => (settle = res));
    let settled = false;
    const once = (o: JobOutcome<T>) => {
      if (settled) return;
      settled = true;
      settle(o);
    };
    this.running = { generation, settle: once as (o: JobOutcome<never>) => void };
    const isCurrent = () => this.running?.generation === generation;
    void (async () => {
      try {
        const cfg = await this.ensureConfigured();
        if (!isCurrent()) return;
        if (!cfg.ok) {
          this.running = null;
          once({ status: 'done', result: cfg as EngineResult<never> });
          return;
        }
        const result = await call(this.ensureHandle().remote);
        if (!isCurrent()) return; // stale: a newer job or a cancel already settled this one
        this.running = null;
        once({ status: 'done', result });
      } catch (e) {
        if (!isCurrent()) return;
        this.running = null;
        this.terminate();
        once({ status: 'crashed', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return {
      generation,
      promise,
      cancel: () => {
        if (isCurrent()) this.cancel();
      },
    };
  }

  fit(roster: RosterVeteran[], opts: { nowIso: string; id?: string }): Job<FitOutput> {
    return this.run((r) => r.fit(roster, opts) as Promise<EngineResult<FitOutput>>);
  }

  /**
   * T15b: `calibrateRules` in the worker. Shares the single active-job authority with fit/rank, so a
   * later job supersedes it (and vice versa) and its reply can never overwrite a newer result.
   * Arguments are plain data (no callbacks: the engine has no progress hook).
   */
  calibrate(roster: RosterVeteran[], opts: CalibrateOpts): Job<CalibrationOutput> {
    return this.run((r) => r.calibrate(roster, opts) as Promise<EngineResult<CalibrationOutput>>);
  }

  rank(
    snapshot: ModelSnapshot,
    input: PlanInput,
    roster: RosterVeteran[],
    target: CmTarget,
    opts: RankOptions,
    onProgress?: (p: RankProgress) => void,
  ): Job<RankResult> {
    return this.run((r) => {
      const gen = this.generation;
      // Progress from a superseded job is dropped as well.
      const cb = onProgress
        ? proxy((p: RankProgress) => {
            if (this.running?.generation === gen) onProgress(p);
          })
        : undefined;
      return r.rank(snapshot, input, roster, target, opts, cb) as Promise<EngineResult<RankResult>>;
    });
  }

  dispose(): void {
    this.cancel();
    this.terminate();
  }
}
