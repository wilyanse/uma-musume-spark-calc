import { expose } from 'comlink';
import { createEngineApi } from './engine.api.ts';

expose(createEngineApi());
