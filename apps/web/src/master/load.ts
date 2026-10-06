/**
 * Master data on the main thread (60 §1, 01 §11): `/master/latest.json` (always revalidated) →
 * the versioned files, each checked against its published sha256 and cached with the Cache API
 * under its versioned URL. Entries of other versions are pruned. Full schema validation happens in
 * the engine worker (zod stays out of the main bundle); the sha256 check guarantees these are the
 * published bytes.
 */
import type {
  Affinity,
  Character,
  MasterLatest,
  Outfit,
  Rank,
  Rules,
  Scenario,
  Skill,
  Spark,
  SupportCard,
  VocabEntry,
} from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';

export const MASTER_FILES = [
  'characters.json',
  'outfits.json',
  'skills.json',
  'sparks.json',
  'cards.json',
  'affinity.json',
  'scenarios.json',
  'ranks.json',
  'vocab.json',
  'rules.json',
] as const;

export const MASTER_CACHE = 'uma-master';

export interface MasterData {
  version: string;
  latest: MasterLatest;
  bundle: MasterBundle;
  characters: ReadonlyMap<string, Character>;
  outfits: ReadonlyMap<string, Outfit>;
  skills: ReadonlyMap<string, Skill>;
  sparks: ReadonlyMap<string, Spark>;
  cards: ReadonlyMap<string, SupportCard>;
  scenarios: ReadonlyMap<string, Scenario>;
  /** Where each file came from on this load (cache hit or network). */
  sources: Record<string, 'cache' | 'network'>;
}

export class MasterDataError extends Error {
  override name = 'MasterDataError';
  readonly version: string | null;
  constructor(version: string | null, message: string) {
    super(message);
    this.version = version;
  }
}

/** Minimal Cache API surface (so tests can inject one; `null` disables caching). */
export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  keys(): Promise<readonly { url: string }[]>;
  delete(url: string): Promise<boolean>;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface LoadMasterOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  cache?: CacheLike | null;
  /** Origin used to resolve the relative file paths into cache keys. */
  origin?: string;
}

export async function openMasterCache(): Promise<CacheLike | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return (await caches.open(MASTER_CACHE)) as unknown as CacheLike;
  } catch {
    return null;
  }
}

export async function loadMaster(opts: LoadMasterOptions = {}): Promise<MasterData> {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const cache = opts.cache === undefined ? await openMasterCache() : opts.cache;
  const origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost');

  let latest: MasterLatest;
  try {
    const res = await doFetch('/master/latest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    latest = (await res.json()) as MasterLatest;
  } catch (e) {
    throw new MasterDataError(null, `latest.json: ${(e as Error).message}`);
  }
  const version = latest.version;
  const sources: Record<string, 'cache' | 'network'> = {};
  const data: Record<string, unknown> = {};

  for (const file of MASTER_FILES) {
    const path = latest.files[file];
    const expected = latest.sha256[file];
    if (!path || !expected) throw new MasterDataError(version, `latest.json lists no ${file}`);
    const url = new URL(path, origin).toString();
    let bytes: ArrayBuffer | null = null;
    const hit = cache ? await cache.match(url) : undefined;
    if (hit) {
      const b = await hit.arrayBuffer();
      if ((await sha256Hex(b)) === expected) {
        bytes = b;
        sources[file] = 'cache';
      }
    }
    if (!bytes) {
      const res = await doFetch(path);
      if (!res.ok) throw new MasterDataError(version, `${file}: HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
      const got = await sha256Hex(bytes);
      if (got !== expected) {
        throw new MasterDataError(version, `${file}: sha256 ${got} does not match latest.json ${expected}`);
      }
      sources[file] = 'network';
      if (cache) await cache.put(url, new Response(bytes.slice(0), { headers: { 'content-type': 'application/json' } }));
    }
    data[file] = JSON.parse(new TextDecoder().decode(bytes));
  }

  if (cache) {
    // Prune other versions (URLs are versioned, so stale entries are never read again).
    for (const req of await cache.keys()) {
      if (!req.url.includes(`/master/${version}/`)) await cache.delete(req.url);
    }
  }

  const bundle: MasterBundle = {
    version,
    characters: data['characters.json'] as Character[],
    outfits: data['outfits.json'] as Outfit[],
    skills: data['skills.json'] as Skill[],
    sparks: data['sparks.json'] as Spark[],
    cards: data['cards.json'] as SupportCard[],
    affinity: data['affinity.json'] as Affinity,
    scenarios: data['scenarios.json'] as Scenario[],
    ranks: data['ranks.json'] as Rank[],
    vocab: data['vocab.json'] as VocabEntry[],
    rules: data['rules.json'] as Rules,
  };
  return indexMaster(latest, bundle, sources);
}

export function indexMaster(
  latest: MasterLatest,
  bundle: MasterBundle,
  sources: Record<string, 'cache' | 'network'> = {},
): MasterData {
  const byId = <T extends { id: string }>(xs: readonly T[]) => new Map(xs.map((x) => [x.id, x]));
  return {
    version: bundle.version,
    latest,
    bundle,
    characters: byId(bundle.characters),
    outfits: byId(bundle.outfits),
    skills: byId(bundle.skills),
    sparks: byId(bundle.sparks),
    cards: byId(bundle.cards),
    scenarios: byId(bundle.scenarios),
    sources,
  };
}

// ---- name helpers (unknown ids are shown verbatim, never invented)
export const characterName = (m: MasterData, id: string | null | undefined): string =>
  id ? (m.characters.get(id)?.name ?? id) : '—';
export const outfitTitle = (m: MasterData, id: string | null | undefined): string =>
  id ? (m.outfits.get(id)?.title ?? id) : '—';
export const skillName = (m: MasterData, id: string): string => m.skills.get(id)?.name ?? id;
export const sparkName = (m: MasterData, id: string): string => m.sparks.get(id)?.name ?? id;
export const scenarioName = (m: MasterData, id: string): string => m.scenarios.get(id)?.name ?? id;
export const cardLabel = (m: MasterData, id: string): string => {
  const c = m.cards.get(id);
  return c ? `${c.name}${c.title ? ` [${c.title}]` : ''}` : id;
};
