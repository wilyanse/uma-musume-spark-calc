// Pure normalisation: raw GameTora JSON -> master-data entities (01 §11), Global server only.
// No network, no clock, no image decoding here; hashes are filled in by build.ts afterwards.
import type {
  Affinity,
  AptKey,
  Character,
  Grade,
  Outfit,
  Rank,
  Rules,
  Scenario,
  Skill,
  Spark,
  StatKey,
  SupportCard,
  VocabEntry,
} from '@uma/schema';

// ---------------------------------------------------------------------------------------------
// Raw shapes (only the fields we read).
// ---------------------------------------------------------------------------------------------
export interface RawCharacter {
  char_id: number;
  en_name?: string;
  name_en?: string;
  playable_en?: boolean;
}
export interface RawCharacterCard {
  card_id: number;
  char_id: number;
  name_en: string;
  title_en_gl?: string;
  title: string;
  release_en?: string;
  aptitude: string[];
  stat_bonus: number[];
  skills_unique: number[];
  skills_innate: number[];
}
export interface RawSupportCard {
  support_id: number;
  char_id: number;
  char_name: string;
  title_en: string;
  type: string;
  rarity: number;
  release_en?: string;
  event_skills: number[];
  hints: { hint_skills: number[] };
}
export interface RawSkill {
  id: number;
  name_en?: string;
  enname?: string;
  rarity: number;
  cost?: number;
  type?: string[];
  unreleased?: string[];
}
interface RawFactorEffect {
  type: number;
  value_1: number[];
  value_2: number[];
}
export interface RawFactor {
  id: string;
  name_en?: string;
  name_en_gl?: string;
  type: number;
  race_id?: string;
  effects: RawFactorEffect[];
}
export interface RawFactors {
  blue: RawFactor[];
  pink: RawFactor[];
  race: RawFactor[];
  scenario: RawFactor[];
  skill: RawFactor[];
  other: RawFactor[];
}
export interface RawScenario {
  id: number;
  name_en?: string;
  name_en_full?: string;
  start_en?: number;
  hard_caps: number[];
}
export interface RawStaticScenario {
  id: number;
  url_name: string;
  factors: { id: number; name_en?: string; effect_1?: string; effect_2?: string }[];
}
export interface RawNickname {
  id: number;
  name_en_gl?: string;
}
export interface RawRank {
  id: number;
  min_value: number;
  max_value: number;
}
export interface RawRelation {
  relation_type: number;
  relation_point: number;
}
export interface RawRelationMember {
  chara_id: number;
  relation_type: number;
}

export interface RawBundle {
  characters: RawCharacter[];
  characterCards: RawCharacterCard[];
  supportCards: RawSupportCard[];
  skills: RawSkill[];
  factors: RawFactors;
  scenarios: RawScenario[];
  staticScenarios: RawStaticScenario[];
  nicknames: RawNickname[];
  ranks: RawRank[];
  relations: RawRelation[];
  relationMembers: RawRelationMember[];
}

export type IdPins = Record<string, string>;
export interface Overrides {
  ids: IdPins;
  /** Extra aliases per master ID (spelling variants as shown in game). */
  aliases: Record<string, string[]>;
}

export interface Normalised {
  characters: Character[];
  outfits: Outfit[];
  skills: Skill[];
  sparks: Spark[];
  cards: SupportCard[];
  affinity: Affinity;
  scenarios: Scenario[];
  ranks: Rank[];
  vocab: VocabEntry[];
  /** Card titles/names for OCR; `kind: 'card'` isn't in the schema's vocab enum yet (Q-4). */
  cardVocab: { kind: 'card'; id: string; text: string }[];
  rules: Rules;
  /** Pins to write back to overrides/ids.json. */
  ids: IdPins;
  /** Non-fatal data gaps, for SOURCES.md and the build log. */
  gaps: string[];
  /** Where the image hashes go: gameId keyed. */
  imageJobs: {
    characters: { id: string; charId: number }[];
    outfits: { characterId: string; cardId: number }[];
    cards: { id: string; supportId: number }[];
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** GameTora writes the small circle U+25CB; the game and the spec use U+25EF (Q-6). */
export function canonicalName(name: string): string {
  return name.replaceAll('\u25CB', '\u25EF').trim();
}

const STAT_BY_TYPE: Record<number, StatKey> = { 1: 'spd', 2: 'sta', 3: 'pow', 4: 'gut', 5: 'wit' };
const APT_BY_PINK_NAME: Record<string, AptKey> = {
  Turf: 'turf',
  Dirt: 'dirt',
  Sprint: 'sprint',
  Mile: 'mile',
  Medium: 'medium',
  Long: 'long',
  'Front Runner': 'front',
  'Pace Chaser': 'pace',
  'Late Surger': 'late',
  'End Closer': 'end',
};
const APT_ORDER: AptKey[] = ['turf', 'dirt', 'sprint', 'mile', 'medium', 'long', 'front', 'pace', 'late', 'end'];
const STAT_ORDER: StatKey[] = ['spd', 'sta', 'pow', 'gut', 'wit'];
const CARD_TYPE: Record<string, SupportCard['type']> = {
  speed: 'speed',
  stamina: 'stamina',
  power: 'power',
  guts: 'guts',
  intelligence: 'wit',
  friend: 'friend',
  group: 'group',
};
const CARD_RARITY: Record<number, SupportCard['rarity']> = { 1: 'R', 2: 'SR', 3: 'SSR' };
const SKILL_RARITY: Record<number, Skill['rarity']> = { 1: 'normal', 2: 'gold', 3: 'unique', 4: 'unique', 5: 'unique', 6: 'evolved' };
const GRADES = new Set(['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S']);

/** Allocates `<kind>:<slug>` IDs; collisions get -2, -3… and every member of a collision group is pinned. */
class IdAllocator {
  private readonly used = new Map<string, string>(); // id -> pin key
  private readonly bySlug = new Map<string, string[]>(); // base id -> pin keys
  readonly assigned = new Map<string, string>(); // pin key -> id
  private readonly pins: IdPins;
  constructor(pins: IdPins) {
    this.pins = pins;
    for (const [key, id] of Object.entries(pins)) this.used.set(id, key);
  }
  allocate(kind: string, pinKey: string, name: string): string {
    const base = `${kind}:${slugify(name) || 'unnamed'}`;
    const keys = this.bySlug.get(base) ?? [];
    keys.push(pinKey);
    this.bySlug.set(base, keys);
    const pinned = this.pins[pinKey];
    if (pinned) {
      this.assigned.set(pinKey, pinned);
      return pinned;
    }
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.set(id, pinKey);
    this.assigned.set(pinKey, id);
    return id;
  }
  /** Pins for every entry that shares a base slug with another one. */
  collisionPins(): IdPins {
    const out: IdPins = {};
    for (const keys of this.bySlug.values()) {
      if (keys.length < 2) continue;
      for (const k of keys) out[k] = this.assigned.get(k) as string;
    }
    return out;
  }
}

const isGlobalSkill = (s: RawSkill): s is RawSkill & { name_en: string } =>
  Boolean(s.name_en) && !(s.unreleased ?? []).includes('en');

// ---------------------------------------------------------------------------------------------
export function normalise(raw: RawBundle, overrides: Overrides): Normalised {
  const gaps: string[] = [];
  const alloc = new IdAllocator(overrides.ids);
  const alias = (id: string, ...extra: string[]) =>
    [...new Set([...extra, ...(overrides.aliases[id] ?? [])])];

  // --- Characters (Global playable) -------------------------------------------------------------
  const globalChars = raw.characters
    .map((c) => ({ ...c, en_name: c.en_name ?? c.name_en })) // GameTora renamed the field in a later build
    .filter((c) => c.playable_en && c.en_name)
    .sort((a, b) => a.char_id - b.char_id);
  const charIdByGame = new Map<number, string>();
  for (const c of globalChars) charIdByGame.set(c.char_id, alloc.allocate('character', `character:${c.char_id}`, c.en_name as string));

  // --- Skills (Global-released, exact names) ----------------------------------------------------
  const skills: Skill[] = [];
  const skillIdByGame = new Map<number, string>();
  for (const s of raw.skills.filter(isGlobalSkill).sort((a, b) => a.id - b.id)) {
    const name = canonicalName(s.name_en);
    const id = alloc.allocate('skill', `skill:${s.id}`, name);
    skillIdByGame.set(s.id, id);
    skills.push({
      id,
      gameId: s.id,
      name,
      aliases: alias(id, ...(s.name_en !== name ? [s.name_en] : [])),
      rarity: SKILL_RARITY[s.rarity] ?? 'normal',
      ...(s.cost !== undefined ? { cost: s.cost } : {}),
      tags: [...(s.type ?? [])].sort(),
    });
  }
  const rawSkillByGame = new Map(raw.skills.map((s) => [s.id, s]));
  const skillRefs = (ids: number[], where: string) =>
    ids.flatMap((g) => {
      const id = skillIdByGame.get(g);
      if (!id) gaps.push(`${where}: skill ${g} (${rawSkillByGame.get(g)?.name_en ?? rawSkillByGame.get(g)?.enname ?? 'unknown'}) is not released on Global; reference dropped`);
      return id ? [id] : [];
    });

  // --- Outfits ----------------------------------------------------------------------------------
  const globalCards = raw.characterCards
    .filter((c) => c.release_en && charIdByGame.has(c.char_id))
    .sort((a, b) => a.card_id - b.card_id);
  const outfits: Outfit[] = [];
  const outfitByCard = new Map<number, string>();
  for (const c of globalCards) {
    const title = (c.title_en_gl ?? `[${c.title}]`).replace(/^\[|\]$/g, '').trim();
    const id = alloc.allocate('outfit', `outfit:${c.card_id}`, title);
    outfitByCard.set(c.card_id, id);
    if (c.aptitude.length !== 10 || !c.aptitude.every((g) => GRADES.has(g))) throw new Error(`card ${c.card_id}: bad aptitudes`);
    if (c.stat_bonus.length !== 5) throw new Error(`card ${c.card_id}: bad stat_bonus`);
    const unique = skillRefs(c.skills_unique.slice(-1), `outfit ${id}`)[0];
    if (!unique) throw new Error(`outfit ${id}: no released unique skill`);
    outfits.push({
      id,
      gameId: c.card_id,
      characterId: charIdByGame.get(c.char_id) as string,
      title,
      aptitudes: Object.fromEntries(APT_ORDER.map((k, i) => [k, c.aptitude[i] as Grade])) as Record<AptKey, Grade>,
      growth: Object.fromEntries(STAT_ORDER.map((k, i) => [k, c.stat_bonus[i] as number])) as Record<StatKey, number>,
      uniqueSkillId: unique,
      innateSkillIds: skillRefs(c.skills_innate, `outfit ${id}`),
    });
  }

  // --- Affinity ---------------------------------------------------------------------------------
  const pointsByType = new Map(raw.relations.map((r) => [r.relation_type, r.relation_point]));
  const membersByType = new Map<number, Set<string>>();
  for (const m of raw.relationMembers) {
    const cid = charIdByGame.get(m.chara_id);
    if (!cid) continue;
    const set = membersByType.get(m.relation_type) ?? new Set<string>();
    set.add(cid);
    membersByType.set(m.relation_type, set);
  }
  const groups: Affinity['groups'] = [];
  const groupsByChar = new Map<string, string[]>();
  for (const type of [...membersByType.keys()].sort((a, b) => a - b)) {
    const members = [...(membersByType.get(type) as Set<string>)].sort();
    const points = pointsByType.get(type);
    if (points === undefined) {
      gaps.push(`affinity: relation_type ${type} has members but no relation_point; dropped`);
      continue;
    }
    if (members.length < 2) continue; // a group of one never affects a pair
    const id = `relation:${type}`;
    groups.push({ id, members, points });
    for (const m of members) groupsByChar.set(m, [...(groupsByChar.get(m) ?? []), id]);
  }

  const characters: Character[] = globalChars.map((c) => {
    const id = charIdByGame.get(c.char_id) as string;
    return {
      id,
      gameId: c.char_id,
      name: c.en_name as string,
      aliases: alias(id),
      affinityGroups: groupsByChar.get(id) ?? [],
      iconHashes: [],
    };
  });

  // --- Scenarios (Global = has an English start date) ---------------------------------------------
  const staticById = new Map(raw.staticScenarios.map((s) => [s.id, s]));
  const scenarios: Scenario[] = [];
  const scenarioIdByGame = new Map<number, string>();
  for (const s of raw.scenarios.filter((x) => x.start_en && x.name_en).sort((a, b) => a.id - b.id)) {
    const id = alloc.allocate('scenario', `scenario:${s.id}`, s.name_en as string);
    scenarioIdByGame.set(s.id, id);
    const st = staticById.get(s.id);
    scenarios.push({
      id,
      name: s.name_en as string,
      statCap: s.hard_caps[0] as number,
      // The Global turn numbers of the inspiration events aren't in any cited source (Q-4).
      inheritanceTurns: [],
      extra: {
        fullName: s.name_en_full ?? s.name_en,
        gameId: s.id,
        hardCaps: s.hard_caps,
        ...(st ? { aliases: [...new Set(st.factors.map((f) => f.name_en).filter(Boolean))] } : {}),
        inheritanceTurnsVerified: false,
        inheritanceTurnsNote: 'GameTora legacies article: inspiration happens in the first half of April of years 2 and 3; turn numbers not published',
      },
    });
  }
  const droppedScenarios = raw.scenarios.filter((x) => !(x.start_en && x.name_en)).length;
  gaps.push(`scenarios: ${droppedScenarios} scenario(s) without a Global start date excluded`);

  // --- Ranks ------------------------------------------------------------------------------------
  const rankNames = buildRankNames(raw.ranks.length);
  const ranks: Rank[] = [...raw.ranks]
    .sort((a, b) => a.id - b.id)
    .map((r) => ({ id: rankNames[r.id - 1] as string, minRating: r.min_value }));

  // --- Sparks -----------------------------------------------------------------------------------
  const sparks: Spark[] = [];
  const addSpark = (type: Spark['type'], gameId: number | undefined, key: string, name: string, target: Spark['target']) => {
    const id = alloc.allocate('spark', `spark:${key}`, name);
    sparks.push({ id, ...(gameId !== undefined ? { gameId } : {}), name, type, target });
  };
  for (const f of raw.factors.blue) {
    const stat = STAT_BY_TYPE[f.effects[0]?.type ?? 0];
    if (stat && f.name_en_gl) addSpark('blue', Number(f.id), `blue:${f.id}`, f.name_en_gl, { kind: 'stat', stat });
  }
  for (const f of raw.factors.pink) {
    const apt = APT_BY_PINK_NAME[f.name_en_gl ?? ''];
    if (apt) addSpark('pink', Number(f.id), `pink:${f.id}`, f.name_en_gl as string, { kind: 'aptitude', apt });
    else gaps.push(`pink factor ${f.id} (${f.name_en_gl}) has no aptitude mapping`);
  }
  // Green: one per Global outfit whose green factor (factor id == card id) has a Global name.
  const greenFactors = new Map(raw.factors.other.filter((f) => f.type === 3).map((f) => [Number(f.id), f]));
  for (const c of globalCards) {
    const f = greenFactors.get(c.card_id);
    const name = f?.name_en_gl;
    if (!f || !name) {
      gaps.push(`green spark: outfit ${outfitByCard.get(c.card_id)} has no Global green factor name`);
      continue;
    }
    const wanted = name.toLowerCase();
    const match = c.skills_unique.find((g) => rawSkillByGame.get(g)?.name_en?.toLowerCase() === wanted) ?? c.skills_unique[c.skills_unique.length - 1];
    const skillId = skillIdByGame.get(match as number);
    if (!skillId) {
      gaps.push(`green spark "${name}": unique skill ${match} not on Global; dropped`);
      continue;
    }
    addSpark('green', c.card_id, `green:${f.id}`, name, { kind: 'skill', skillId });
  }
  for (const f of raw.factors.skill.filter((x) => x.name_en_gl)) {
    const hint = f.effects.find((e) => e.type === 41);
    const skillId = hint ? skillIdByGame.get(hint.value_1[0] as number) : undefined;
    if (!skillId) {
      gaps.push(`white skill spark "${f.name_en_gl}": target skill not on Global; dropped`);
      continue;
    }
    addSpark('white', Number(f.id), `white-skill:${f.id}`, canonicalName(f.name_en_gl as string), { kind: 'skill', skillId });
  }
  for (const f of raw.factors.race.filter((x) => x.name_en_gl)) {
    addSpark('white', Number(f.id), `white-race:${f.id}`, f.name_en_gl as string, { kind: 'race', raceId: f.race_id as string });
  }
  const staticByFactorGroup = new Map<number, number>(); // 30002 -> scenario game id 2
  for (const s of raw.staticScenarios) for (const f of s.factors) staticByFactorGroup.set(Math.floor(f.id / 100), s.id);
  for (const f of raw.factors.scenario.filter((x) => x.name_en_gl)) {
    const scenarioId = scenarioIdByGame.get(staticByFactorGroup.get(Number(f.id)) ?? -1);
    if (!scenarioId) {
      gaps.push(`white scenario spark "${f.name_en_gl}": scenario not on Global; dropped`);
      continue;
    }
    addSpark('white', Number(f.id), `white-scenario:${f.id}`, f.name_en_gl as string, { kind: 'scenario', scenarioId });
  }

  // --- Support cards ----------------------------------------------------------------------------
  const cards: SupportCard[] = [];
  const cardJobs: Normalised['imageJobs']['cards'] = [];
  for (const c of raw.supportCards.filter((x) => x.release_en).sort((a, b) => a.support_id - b.support_id)) {
    const type = CARD_TYPE[c.type];
    const rarity = CARD_RARITY[c.rarity];
    if (!type || !rarity) throw new Error(`support card ${c.support_id}: unknown type/rarity ${c.type}/${c.rarity}`);
    const title = c.title_en.replace(/^\[|\]$/g, '').trim();
    const id = alloc.allocate('card', `card:${c.support_id}`, `${title} ${c.char_name}`);
    const characterId = charIdByGame.get(c.char_id);
    cards.push({
      id,
      gameId: c.support_id,
      name: c.char_name,
      title,
      ...(characterId ? { characterId } : {}),
      type,
      rarity,
      hintSkillIds: skillRefs(c.hints.hint_skills, `card ${id} hints`),
      eventSkillIds: skillRefs(c.event_skills, `card ${id} events`),
      artHashes: [],
    });
    cardJobs.push({ id, supportId: c.support_id });
  }

  // --- Vocab ------------------------------------------------------------------------------------
  const vocabMap = new Map<string, VocabEntry>();
  const addVocab = (kind: VocabEntry['kind'], id: string, ...texts: string[]) => {
    for (const text of texts) {
      if (!text) continue;
      // OCR may read either circle glyph (Q-6), so both spellings resolve.
      for (const variant of new Set([text, text.replaceAll('\u25EF', '\u25CB')])) {
        vocabMap.set(`${kind}|${id}|${variant}`, { kind, id, text: variant });
      }
    }
  };
  for (const c of characters) addVocab('character', c.id, c.name, ...c.aliases);
  for (const o of outfits) addVocab('outfit', o.id, o.title);
  for (const s of skills) addVocab('skill', s.id, s.name, ...s.aliases);
  for (const s of sparks) addVocab('spark', s.id, s.name);
  for (const s of scenarios) {
    const extra = s.extra as { fullName?: string; aliases?: string[] };
    addVocab('scenario', s.id, s.name, extra.fullName ?? '', ...(extra.aliases ?? []));
  }
  const epithetIds = new Set<string>();
  for (const n of raw.nicknames.filter((x) => x.name_en_gl).sort((a, b) => a.id - b.id)) {
    const id = alloc.allocate('epithet', `epithet:${n.id}`, n.name_en_gl as string);
    epithetIds.add(id);
    addVocab('epithet', id, n.name_en_gl as string);
  }
  const vocab = [...vocabMap.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id) || a.text.localeCompare(b.text),
  );
  const cardVocab = cards
    .flatMap((c) => [c.title, c.name].map((text) => ({ kind: 'card' as const, id: c.id, text })))
    .sort((a, b) => a.id.localeCompare(b.id) || a.text.localeCompare(b.text));

  return {
    characters,
    outfits,
    skills,
    sparks,
    cards,
    affinity: { groups },
    scenarios,
    ranks,
    vocab,
    cardVocab,
    rules: buildRules(raw, scenarioIdByGame, staticByFactorGroup),
    ids: alloc.collisionPins(),
    gaps,
    imageJobs: {
      characters: characters.map((c) => ({ id: c.id, charId: c.gameId as number })),
      outfits: outfits.map((o) => ({ characterId: o.characterId, cardId: o.gameId as number })),
      cards: cardJobs,
    },
  };
}

/**
 * Rank badge names for GameTora's `single_mode_rank` rows (ordered by id).
 * The source table has numeric ids only. The names follow the in-game badge ladder
 * G, G+, F, F+, E, E+, D, D+, C, C+, B, B+, A, A+, S, S+, SS, SS+ (18) then UG, UG1-UG9, UF, UF1-UF9 …
 * US, US1-US9 (80). 18 + 80 = 98 rows, which equals the table length, and the screenshot's A+ / rating
 * 13471 falls in the A+ row (12100-14499). The mapping itself is an assumption (Q-6).
 */
export function buildRankNames(count: number): string[] {
  const names = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'].flatMap((l) => (l === 'S' ? [l, `${l}+`, 'SS', 'SS+'] : [l, `${l}+`]));
  for (const l of ['UG', 'UF', 'UE', 'UD', 'UC', 'UB', 'UA', 'US']) {
    names.push(l);
    for (let i = 1; i <= 9; i++) names.push(`${l}${i}`);
  }
  if (names.length !== count) throw new Error(`rank ladder has ${names.length} names but the source has ${count} rows`);
  return names;
}

// ---------------------------------------------------------------------------------------------
// rules.json (01 §12): everything verified:false with a source. Unknown numbers are 0 and say so.
// ---------------------------------------------------------------------------------------------
const GT_LEGACIES = 'https://gametora.com/umamusume/legacies';
const GT_CALC_JS = 'https://gametora.com/_next/static/chunks/2464-2e90db37675bc47e.js (compatibility calculator, spark copy-rate table `[.7,.8,.9]` blue, `[.01,.03,.05]` pink, `[.05,.1,.15]` green, `[.03,.06,.09]` skills, `[.01,.02,.03]` races; affinity factor `1 + affinity/100`)';
const GT_FACTORS = 'https://gametora.com/data/umamusume/factors.<hash>.json';
const UNKNOWN = 'UNKNOWN: no cited source; 0 is a placeholder to be calibrated by T15 (Q-3)';

export function buildRules(
  raw: RawBundle,
  scenarioIdByGame: Map<number, string>,
  staticByFactorGroup: Map<number, number>,
): Rules {
  const table = (a: number, b: number, c: number, source: string, verified = false) => ({
    '1': a,
    '2': b,
    '3': c,
    verified,
    source,
  });
  const races: Record<string, { stats: StatKey[]; hintSkillIds: number[] }> = {};
  let raceStars: number[] = [];
  for (const f of raw.factors.race.filter((x) => x.name_en_gl)) {
    const stats = f.effects.filter((e) => STAT_BY_TYPE[e.type]).map((e) => STAT_BY_TYPE[e.type] as StatKey);
    const statEffect = f.effects.find((e) => STAT_BY_TYPE[e.type]);
    if (statEffect && raceStars.length === 0) raceStars = statEffect.value_1;
    races[f.race_id as string] = {
      stats,
      hintSkillIds: f.effects.filter((e) => e.type === 41).flatMap((e) => e.value_1.slice(0, 1)),
    };
  }
  const scenarioEffects: Record<string, { stats: StatKey[]; perStar: number[] }> = {};
  for (const f of raw.factors.scenario.filter((x) => x.name_en_gl)) {
    const sid = scenarioIdByGame.get(staticByFactorGroup.get(Number(f.id)) ?? -1);
    if (!sid) continue;
    const stats = f.effects.filter((e) => STAT_BY_TYPE[e.type]);
    scenarioEffects[sid] = {
      stats: stats.map((e) => STAT_BY_TYPE[e.type] as StatKey),
      perStar: stats[0]?.value_1 ?? [],
    };
  }
  return {
    version: 'rules-1',
    activation: {
      blue: table(0.7, 0.8, 0.9, GT_CALC_JS),
      pink: table(0.01, 0.03, 0.05, GT_CALC_JS),
      green: table(0.05, 0.1, 0.15, GT_CALC_JS),
      white: table(0.03, 0.06, 0.09, `${GT_CALC_JS}; this is the skill-spark table, race sparks are in raceSparkStatGain.activation`),
    },
    affinityMultiplier: {
      formula: '1 + affinity/100',
      verified: false,
      source: `${GT_CALC_JS}; rate = min(base[stars] * (1 + affinity/100), 1)`,
    },
    grandparentWeight: {
      value: 1,
      verified: false,
      source: `${GT_CALC_JS}: each legacy and sub-legacy rolls independently with its own affinity; no extra sub-legacy factor was found in the calculator code. Assumed 1 (Q-3)`,
    },
    blueStatGain: table(0, 0, 0, `${UNKNOWN}. Per-event blue gain is not documented in ${GT_LEGACIES}; the raw factor table ${GT_FACTORS} (blue[].effects) has unlabeled per-star arrays`),
    blueInitialBonus: table(5, 12, 21, `${GT_LEGACIES} (Blue spark section: "1☆ +5, 2☆ +12, 3☆ +21", additive over every legacy and sub-legacy)`),
    pinkGradeGain: table(1, 1, 1, 'docs/specs/01-data-contracts.md §12 (contract value, not independently confirmed)'),
    whiteHintLevels: table(0, 0, 0, `${UNKNOWN}. ${GT_LEGACIES} only says the skill becomes available at a discount depending on stars`),
    raceSparkStatGain: {
      verified: false,
      source: `${GT_FACTORS} race[].effects: stat-type effects carry [${raceStars.join(',')}] per star, type-41 effects carry a skill hint`,
      perStar: raceStars,
      activation: { '1': 0.01, '2': 0.02, '3': 0.03 },
      activationSource: GT_CALC_JS,
      races,
    },
    scenarioSparkEffects: {
      verified: false,
      source: `${GT_FACTORS} scenario[].effects (stat effect per star) joined to static/scenario_factors`,
      scenarios: scenarioEffects,
    },
  };
}
