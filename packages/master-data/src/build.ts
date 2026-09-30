// `pnpm --filter @uma/master-data build [-- --offline] [-- --no-images] [-- --date YYYYMMDD]`
// fetch (cached) -> normalise -> image hashes (in memory) -> zod validate -> versioned folder + latest.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  AffinityFile,
  CardsFile,
  CharactersFile,
  MasterLatest,
  OutfitsFile,
  RanksFile,
  Rules,
  ScenariosFile,
  SkillsFile,
  SparksFile,
  VocabFile,
} from '@uma/schema';
import { CARD_ART_CROP, CHAR_ICON_CROP, VETERAN_ICON_CROP } from './art-crop.ts';
import { DHASH_VERSION, dhash, type CropBox } from './dhash.ts';
import {
  CACHE_DIR,
  IMAGE_BASE,
  MEDIA_BASE,
  PACKAGE_DIR,
  loadRawData,
  politeFetch,
} from './fetch.ts';
import { normalise, type Overrides, type RawBundle } from './normalize.ts';

const REPO_ROOT = join(PACKAGE_DIR, '..', '..');
const OUT_ROOT = join(REPO_ROOT, 'apps', 'web', 'public', 'master');
const OVERRIDES_DIR = join(PACKAGE_DIR, 'overrides');

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const log = (m: string) => console.log(m);

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function readOverrides(): Overrides {
  const read = <T>(name: string, fallback: T): T => {
    const p = join(OVERRIDES_DIR, name);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
  };
  return { ids: read('ids.json', {}), aliases: read('aliases.json', {}) };
}

// --- image hashing (bytes never touch the repo; only hashes are cached, under .cache/) -----------
const hashCachePath = join(CACHE_DIR, 'hashes.json');
const hashCache: Record<string, string | null> = existsSync(hashCachePath) ? JSON.parse(readFileSync(hashCachePath, 'utf8')) : {};

async function hashImage(url: string, crop: CropBox, gaps: string[], offline: boolean): Promise<string | undefined> {
  const key = `v${DHASH_VERSION}|${JSON.stringify(crop)}|${url}`;
  if (key in hashCache) return hashCache[key] ?? undefined;
  if (offline) return undefined;
  try {
    const res = await politeFetch(url);
    if (!res.ok) {
      hashCache[key] = null;
      gaps.push(`image ${url}: HTTP ${res.status}; no hash`);
      return undefined;
    }
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const h = dhash({ width: info.width, height: info.height, data }, crop);
    hashCache[key] = h;
    return h;
  } catch (e) {
    gaps.push(`image ${url}: ${(e as Error).message}; no hash`);
    return undefined;
  }
}

function pickVersion(date: string): string {
  const base = `global-${date}`;
  const taken = existsSync(OUT_ROOT) ? new Set(readdirSync(OUT_ROOT)) : new Set<string>();
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

async function main() {
  const offline = flag('offline');
  const raw = await loadRawData(offline, log);
  const rawBundle: RawBundle = {
    characters: raw.get('characters'),
    characterCards: raw.get('character-cards'),
    supportCards: raw.get('support-cards'),
    skills: raw.get('skills'),
    factors: raw.get('factors'),
    scenarios: raw.get('scenarios'),
    staticScenarios: raw.get('static/scenarios'),
    nicknames: raw.get('nicknames'),
    ranks: raw.get('en/db-files/single_mode_rank'),
    relations: raw.get('en/db-files/succession_relation'),
    relationMembers: raw.get('en/db-files/succession_relation_member'),
  };
  const overrides = readOverrides();
  const n = normalise(rawBundle, overrides);
  const gaps = [...n.gaps];

  if (!flag('no-images')) {
    const charIcons = new Map<string, string[]>();
    for (const job of n.imageJobs.characters) {
      const h = await hashImage(`${IMAGE_BASE}/characters/icons/chr_icon_${job.charId}.png`, CHAR_ICON_CROP, gaps, offline);
      if (h) charIcons.set(job.id, [h]);
    }
    for (const job of n.imageJobs.outfits) {
      const h = await hashImage(`${MEDIA_BASE}/characters/veteran_icon/${job.cardId}_01.png`, VETERAN_ICON_CROP, gaps, offline);
      if (h) charIcons.get(job.characterId)?.push(h);
    }
    for (const c of n.characters) c.iconHashes = charIcons.get(c.id) ?? [];
    for (const job of n.imageJobs.cards) {
      const h = await hashImage(`${IMAGE_BASE}/supports/support_card_s_${job.supportId}.png`, CARD_ART_CROP, gaps, offline);
      const card = n.cards.find((c) => c.id === job.id);
      if (card && h) card.artHashes = [h];
    }
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(hashCachePath, json(hashCache));
    const noIcon = n.characters.filter((c) => c.iconHashes.length === 0).length;
    const noArt = n.cards.filter((c) => c.artHashes.length === 0).length;
    log(`hashes: ${n.characters.length - noIcon}/${n.characters.length} characters, ${n.cards.length - noArt}/${n.cards.length} cards`);
  } else {
    gaps.push('image hashes skipped (--no-images); iconHashes/artHashes are empty');
  }

  // Validate before writing anything.
  const files: Record<string, unknown> = {
    characters: CharactersFile.parse(byId(n.characters)),
    outfits: OutfitsFile.parse(byId(n.outfits)),
    skills: SkillsFile.parse(byId(n.skills)),
    sparks: SparksFile.parse(byId(n.sparks)),
    cards: CardsFile.parse(byId(n.cards)),
    affinity: AffinityFile.parse({ groups: byId(n.affinity.groups) }),
    scenarios: ScenariosFile.parse(byId(n.scenarios)),
    ranks: RanksFile.parse(n.ranks),
    vocab: VocabFile.parse(n.vocab),
    rules: Rules.parse(n.rules),
    'vocab-cards': n.cardVocab,
  };

  const version = pickVersion(opt('date') ?? new Date().toISOString().slice(0, 10).replaceAll('-', ''));
  const dir = join(OUT_ROOT, version);
  mkdirSync(dir, { recursive: true });
  const latest: MasterLatest = { version, files: {}, sha256: {} };
  for (const [name, value] of Object.entries(files)) {
    const text = json(value);
    writeFileSync(join(dir, `${name}.json`), text);
    latest.files[`${name}.json`] = `/master/${version}/${name}.json`;
    latest.sha256[`${name}.json`] = sha256(text);
  }
  writeFileSync(join(OUT_ROOT, 'latest.json'), json(MasterLatest.parse(latest)));

  mkdirSync(OVERRIDES_DIR, { recursive: true });
  writeFileSync(join(OVERRIDES_DIR, 'ids.json'), json(Object.fromEntries(Object.entries(n.ids).sort())));
  writeFileSync(join(CACHE_DIR, 'gaps.txt'), `${gaps.join('\n')}\n`);
  log(`wrote ${dir}`);
  for (const [k, v] of Object.entries(files)) log(`  ${k}: ${Array.isArray(v) ? v.length : Object.keys(v as object).length}`);
  log(`gaps: ${gaps.length} (see .cache/gaps.txt)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
