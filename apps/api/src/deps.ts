import type { MasterIndex } from '@uma/schema';
import { ulid } from './ulid.ts';
import { assetsMasterLoader } from './master.ts';

/** Loads the ID index of one master-data version; `null` when that version doesn't exist. */
export type MasterLoader = (version: string, env: Env) => Promise<MasterIndex | null>;

/** Injectable seams: time, ID generation, master data, and the Access JWKS fetch (tests swap these). */
export interface Deps {
  now: () => Date;
  newId: (nowMs: number) => string;
  master: MasterLoader;
  fetchJson: (url: string) => Promise<unknown>;
}

export const defaultDeps: Deps = {
  now: () => new Date(),
  newId: ulid,
  master: assetsMasterLoader(),
  fetchJson: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
  },
};
