import { wrap, type Remote } from 'comlink';
import type { EngineApi } from './engine.api.ts';

let engine: Remote<EngineApi> | undefined;

export function getEngine(): Remote<EngineApi> {
  engine ??= wrap<EngineApi>(
    new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }),
  );
  return engine;
}
