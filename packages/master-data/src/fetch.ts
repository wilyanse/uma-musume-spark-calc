// Raw GameTora data access: manifest -> hashed JSON files, cached under .cache/ (gitignored).
// Politeness rules (docs/specs/20 §1): at most 1 request/second, descriptive User-Agent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = join(PACKAGE_DIR, '.cache');
export const USER_AGENT = 'uma-spark-calc/0.1 (+https://github.com/wilyanse/uma-musume-spark-calc)';
export const DATA_BASE = 'https://gametora.com/data/umamusume';
export const MANIFEST_URL = 'https://gametora.com/data/manifests/umamusume.json';
export const IMAGE_BASE = 'https://gametora.com/images/umamusume';
export const MEDIA_BASE = 'https://media.gametora.com/umamusume';

/** Every data key the build reads (see SOURCES.md for what each one is used for). */
export const DATA_KEYS = [
  'characters',
  'character-cards',
  'support-cards',
  'skills',
  'factors',
  'scenarios',
  'static/scenarios',
  'static/scenario_factors',
  'nicknames',
  'en/db-files/single_mode_rank',
  'en/db-files/succession_relation',
  'en/db-files/succession_relation_member',
] as const;
export type DataKey = (typeof DATA_KEYS)[number];

let lastRequest = 0;
export async function politeFetch(url: string): Promise<Response> {
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  return fetch(url, { headers: { 'User-Agent': USER_AGENT } });
}

export interface RawData {
  manifest: Record<string, string>;
  get<T = unknown>(key: DataKey): T;
}

const fileFor = (key: string, hash: string) =>
  join(CACHE_DIR, 'data', `${key.replaceAll('/', '_')}.${hash}.json`);

/**
 * Loads all DATA_KEYS. Online: refreshes the manifest and downloads files whose hash isn't cached.
 * Offline: uses the cached manifest (`.cache/man.json`) and cached files, and fails if one is missing.
 */
export async function loadRawData(offline: boolean, log: (m: string) => void): Promise<RawData> {
  mkdirSync(join(CACHE_DIR, 'data'), { recursive: true });
  const manifestPath = join(CACHE_DIR, 'man.json');
  let manifest: Record<string, string>;
  if (offline) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } else {
    const res = await politeFetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    manifest = (await res.json()) as Record<string, string>;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    log(`manifest: ${Object.keys(manifest).length} keys`);
  }
  const data = new Map<string, unknown>();
  for (const key of DATA_KEYS) {
    const hash = manifest[key];
    if (!hash) throw new Error(`manifest has no key "${key}"`);
    const path = fileFor(key, hash);
    if (!existsSync(path)) {
      if (offline) throw new Error(`offline: ${key}.${hash}.json is not cached`);
      const res = await politeFetch(`${DATA_BASE}/${key}.${hash}.json`);
      if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      log(`fetched ${key}.${hash}.json`);
    }
    data.set(key, JSON.parse(readFileSync(path, 'utf8')));
  }
  return {
    manifest,
    get: <T>(key: DataKey) => data.get(key) as T,
  };
}
