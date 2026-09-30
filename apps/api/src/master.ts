import type { MasterIndex } from '@uma/schema';
import type { MasterLoader } from './deps.ts';

const FILES = {
  characters: 'characters.json',
  outfits: 'outfits.json',
  skills: 'skills.json',
  sparks: 'sparks.json',
  cards: 'cards.json',
  ranks: 'ranks.json',
  scenarios: 'scenarios.json',
} as const;

/** The version is used in a URL path, so accept only a conservative charset (no traversal). */
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type Entry = { id?: unknown };

/** Build a MasterIndex from parsed master files (01 §11 shapes). Only `id` is read. */
export function buildMasterIndex(files: Record<keyof typeof FILES, unknown>): MasterIndex {
  const ids = (name: keyof typeof FILES): Set<string> => {
    const list = files[name];
    if (!Array.isArray(list)) throw new Error(`master file ${FILES[name]} is not an array`);
    const out = new Set<string>();
    for (const e of list as Entry[]) {
      if (typeof e?.id === 'string') out.add(e.id);
    }
    return out;
  };
  return {
    characters: ids('characters'),
    outfits: ids('outfits'),
    skills: ids('skills'),
    sparks: ids('sparks'),
    cards: ids('cards'),
    ranks: ids('ranks'),
    scenarios: ids('scenarios'),
  };
}

/**
 * Default loader: reads `/master/<version>/*.json` through the ASSETS binding (T01b hand-off),
 * caching each version's index in memory for the life of the isolate. Failures aren't cached.
 */
export function assetsMasterLoader(): MasterLoader {
  const cache = new Map<string, MasterIndex>();
  return async (version, env) => {
    if (!VERSION_RE.test(version)) return null;
    const hit = cache.get(version);
    if (hit) return hit;
    const entries = await Promise.all(
      (Object.entries(FILES) as [keyof typeof FILES, string][]).map(async ([key, file]) => {
        const res = await env.ASSETS.fetch(`https://assets.invalid/master/${version}/${file}`);
        if (!res.ok) return [key, null] as const;
        // A missing file makes the SPA fallback answer with index.html; that isn't JSON.
        if (!(res.headers.get('content-type') ?? '').includes('json')) return [key, null] as const;
        return [key, (await res.json()) as unknown] as const;
      }),
    );
    if (entries.some(([, v]) => v === null)) return null;
    const index = buildMasterIndex(
      Object.fromEntries(entries) as Record<keyof typeof FILES, unknown>,
    );
    cache.set(version, index);
    return index;
  };
}
