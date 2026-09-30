import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AffinityFile,
  CardsFile,
  CharactersFile,
  MASTER_FILE_NAMES,
  MasterLatest,
  OutfitsFile,
  RanksFile,
  Rules,
  ScenariosFile,
  SkillsFile,
  SparksFile,
  VocabFile,
} from '@uma/schema';
import { createHash } from 'node:crypto';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'apps', 'web', 'public', 'master');
const latest = MasterLatest.parse(JSON.parse(readFileSync(join(ROOT, 'latest.json'), 'utf8')));
const dir = join(ROOT, latest.version);
const load = (name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));

const characters = CharactersFile.parse(load('characters'));
const outfits = OutfitsFile.parse(load('outfits'));
const skills = SkillsFile.parse(load('skills'));
const sparks = SparksFile.parse(load('sparks'));
const cards = CardsFile.parse(load('cards'));
const affinity = AffinityFile.parse(load('affinity'));
const scenarios = ScenariosFile.parse(load('scenarios'));
const ranks = RanksFile.parse(load('ranks'));
const vocab = VocabFile.parse(load('vocab'));
const rules = Rules.parse(load('rules'));

describe('bundle', () => {
  it('latest.json lists every 01 §11 file with a matching sha256 and the version folder exists', () => {
    expect(latest.version).toMatch(/^global-\d{8}(-\d+)?$/);
    for (const name of MASTER_FILE_NAMES) {
      const file = `${name}.json`;
      expect(latest.files[file], file).toBe(`/master/${latest.version}/${file}`);
      const text = readFileSync(join(dir, file), 'utf8');
      expect(createHash('sha256').update(text, 'utf8').digest('hex'), file).toBe(latest.sha256[file]);
      expect(text.includes('\r'), `${file} has CR`).toBe(false);
      expect(text.endsWith('\n'), `${file} ends with LF`).toBe(true);
    }
  });

  it('only contains the expected files (no images or downloaded art)', () => {
    for (const f of readdirSync(dir)) expect(f.endsWith('.json'), f).toBe(true);
  });

  it('is sorted by id (deterministic output)', () => {
    for (const list of [characters, outfits, skills, sparks, cards, scenarios]) {
      const ids = list.map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  });

  it('has unique ids per file', () => {
    for (const list of [characters, outfits, skills, sparks, cards, scenarios]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('no dangling references', () => {
  const charIds = new Set(characters.map((c) => c.id));
  const skillIds = new Set(skills.map((s) => s.id));
  const scenarioIds = new Set(scenarios.map((s) => s.id));
  const groupIds = new Set(affinity.groups.map((g) => g.id));

  it('outfits -> characters, skills', () => {
    for (const o of outfits) {
      expect(charIds.has(o.characterId), o.id).toBe(true);
      expect(skillIds.has(o.uniqueSkillId), o.id).toBe(true);
      for (const s of o.innateSkillIds) expect(skillIds.has(s), `${o.id} -> ${s}`).toBe(true);
    }
  });
  it('every character has at least one outfit', () => {
    const withOutfit = new Set(outfits.map((o) => o.characterId));
    for (const c of characters) expect(withOutfit.has(c.id), c.id).toBe(true);
  });
  it('cards -> characters, skills', () => {
    for (const c of cards) {
      if (c.characterId) expect(charIds.has(c.characterId), c.id).toBe(true);
      for (const s of [...c.hintSkillIds, ...c.eventSkillIds]) expect(skillIds.has(s), `${c.id} -> ${s}`).toBe(true);
    }
  });
  it('sparks -> skills, scenarios; every green spark has a real unique skill', () => {
    for (const s of sparks) {
      if (s.target.kind === 'skill') expect(skillIds.has(s.target.skillId), s.id).toBe(true);
      if (s.target.kind === 'scenario') expect(scenarioIds.has(s.target.scenarioId), s.id).toBe(true);
    }
    const uniqueSkillIds = new Set(outfits.map((o) => o.uniqueSkillId));
    for (const s of sparks.filter((x) => x.type === 'green')) {
      expect(s.target.kind).toBe('skill');
      if (s.target.kind === 'skill') expect(skillIds.has(s.target.skillId)).toBe(true);
    }
    expect(uniqueSkillIds.size).toBeGreaterThan(0);
  });
  it('affinity groups -> characters and back', () => {
    for (const g of affinity.groups) for (const m of g.members) expect(charIds.has(m), `${g.id} -> ${m}`).toBe(true);
    for (const c of characters) for (const g of c.affinityGroups) {
      expect(groupIds.has(g), `${c.id} -> ${g}`).toBe(true);
      expect(affinity.groups.find((x) => x.id === g)?.members).toContain(c.id);
    }
  });
  it('vocab ids all resolve to an entity of that kind', () => {
    const byKind: Record<string, Set<string>> = {
      character: charIds,
      outfit: new Set(outfits.map((o) => o.id)),
      skill: skillIds,
      spark: new Set(sparks.map((s) => s.id)),
      scenario: scenarioIds,
    };
    for (const v of vocab) {
      if (v.kind === 'epithet') expect(v.id.startsWith('epithet:'), v.id).toBe(true);
      else expect(byKind[v.kind]?.has(v.id), `${v.kind} ${v.id}`).toBe(true);
    }
  });
  it('rules reference known scenarios', () => {
    const eff = (rules.scenarioSparkEffects as { scenarios?: Record<string, unknown> }).scenarios ?? {};
    for (const id of Object.keys(eff)) expect(scenarioIds.has(id), id).toBe(true);
  });
});

describe('Global-only content', () => {
  it('excludes JP-only characters and outfits that GameTora marks unreleased on Global', () => {
    const names = new Set(characters.map((c) => c.name));
    expect(names.has('Special Week')).toBe(true);
    expect(characters.length).toBe(68);
    expect(outfits.length).toBe(107);
    expect(cards.every((c) => c.rarity === 'R' || c.rarity === 'SR' || c.rarity === 'SSR')).toBe(true);
  });
  it('scenarios are the four with a Global start date', () => {
    expect(scenarios.map((s) => s.name).sort()).toEqual(
      ['Brighter Together Our Grand Concert', 'Trackblazer', 'Unity Cup', 'Ura Finale'].sort(),
    );
    for (const s of scenarios) expect(s.statCap).toBeGreaterThanOrEqual(1);
  });
});

describe('screenshot names resolve through vocab.json (20 §5)', () => {
  const texts = new Map<string, string[]>();
  for (const v of vocab) texts.set(v.text, [...(texts.get(v.text) ?? []), `${v.kind}:${v.id}`]);
  const names = [
    ['Mejiro McQueen', 'character'],
    ['Frontline Elegance', 'outfit'],
    ['The Duty of Dignity Calls', 'skill'],
    ['Straightaway Adept', 'skill'],
    ['Corner Recovery \u25EF', 'skill'],
    ['Pace Chaser Straightaways \u25EF', 'skill'],
    ['Front Runner Savvy \u25EF', 'skill'],
    ['Kawasaki Kinen', 'spark'],
    ['JBC Classic', 'spark'],
    ['Keeping the Lead', 'skill'],
    ['Uma Stan', 'skill'],
    ['My True Strength', 'skill'],
    ['Shooting Star', 'skill'],
    ['NHK Mile C.', 'spark'],
    ['Barcarole of Blessings', 'skill'],
    ['Ignited Spirit WIT', 'skill'],
    ['Ignited Spirit: Stamina +', 'spark'],
    ['Unity Cup', 'scenario'],
    ['Triumphant Pulse', 'skill'],
    ['KEEP IT REAL.', 'skill'],
    ['Victory Cheer!', 'skill'],
    ['Tokai Teio', 'character'],
    ['Beyond the Horizon', 'outfit'],
    ['Special Week', 'character'],
    ['Independent Learner', 'epithet'],
    ['The Beginning: URA Finale', 'scenario'],
  ] as const;
  for (const [text, kind] of names) {
    it(`"${text}" -> ${kind}`, () => {
      const hits = (texts.get(text) ?? []).filter((h) => h.startsWith(`${kind}:`));
      expect(hits.length, `${text} not found as ${kind}`).toBeGreaterThan(0);
    });
  }

  it('"The Brightest Star in Japan!" is a support-card title (vocab-cards.json; Q-4)', () => {
    const cardVocab = load('vocab-cards') as { kind: string; id: string; text: string }[];
    const hit = cardVocab.find((v) => v.text === 'The Brightest Star in Japan!');
    expect(hit).toBeDefined();
    expect(cards.some((c) => c.id === hit?.id && c.name === 'Special Week')).toBe(true);
  });

  it('both circle glyphs resolve for OCR (U+25EF and U+25CB, Q-6)', () => {
    expect(texts.has('Corner Recovery \u25CB')).toBe(true);
  });

  it('skill variants ◯ and ◎ are separate skills', () => {
    const single = skills.find((s) => s.name === 'Pace Chaser Straightaways \u25EF');
    const dbl = skills.find((s) => s.name === 'Pace Chaser Straightaways \u25CE');
    expect(single && dbl && single.id !== dbl.id).toBe(true);
  });

  it('T.M. Opera O alias resolves to the character', () => {
    expect(vocab.find((v) => v.text === 'T.M. Opera O')).toEqual({ kind: 'character', id: 'character:tm-opera-o', text: 'T.M. Opera O' });
  });
});

describe('content sanity', () => {
  it('Mejiro McQueen [Frontline Elegance] outfit is linked and has 10 aptitudes and 5 growths', () => {
    const o = outfits.find((x) => x.title === 'Frontline Elegance');
    expect(o?.characterId).toBe('character:mejiro-mcqueen');
    expect(Object.keys(o?.aptitudes ?? {})).toHaveLength(10);
    expect(Object.keys(o?.growth ?? {})).toEqual(['spd', 'sta', 'pow', 'gut', 'wit']);
  });
  it('spark inventory: 5 blue, 10 pink, green per outfit with a Global factor, plus white', () => {
    const count = (t: string) => sparks.filter((s) => s.type === t).length;
    expect(count('blue')).toBe(5);
    expect(count('pink')).toBe(10);
    expect(count('green')).toBe(107);
    expect(count('white')).toBeGreaterThan(100);
    expect(sparks.some((s) => s.type === 'white' && s.target.kind === 'race' && s.name === 'Japan C.')).toBe(true);
    expect(sparks.some((s) => s.type === 'white' && s.target.kind === 'scenario' && s.name === 'URA Finale')).toBe(true);
  });
  it('ranks are strictly increasing in minRating and start at 0', () => {
    expect(ranks[0]?.minRating).toBe(0);
    for (let i = 1; i < ranks.length; i++) expect((ranks[i] as { minRating: number }).minRating).toBeGreaterThan((ranks[i - 1] as { minRating: number }).minRating);
    // Screenshot 02: rating 13,471 is badge A+.
    const rank = [...ranks].reverse().find((r) => r.minRating <= 13471);
    expect(rank?.id).toBe('A+');
  });
  it('every rules number carries verified:false or a source', () => {
    const tables = [
      rules.activation.blue,
      rules.activation.pink,
      rules.activation.green,
      rules.activation.white,
      rules.blueStatGain,
      rules.blueInitialBonus,
      rules.pinkGradeGain,
      rules.whiteHintLevels,
    ];
    for (const t of tables) {
      expect(t.verified).toBe(false);
      expect(t.source).toMatch(/\S/);
    }
    expect(rules.affinityMultiplier.source).toMatch(/gametora\.com/);
    expect(rules.grandparentWeight.verified).toBe(false);
    expect(rules.raceSparkStatGain.verified).toBe(false);
    expect(rules.scenarioSparkEffects.verified).toBe(false);
  });
  it('affinity groups have positive points', () => {
    expect(affinity.groups.length).toBeGreaterThan(100);
    for (const g of affinity.groups) expect(g.points).toBeGreaterThan(0);
  });
});

describe('image hashes', () => {
  it('are well-formed 16-hex dHashes, with most characters and cards covered', () => {
    const hashes = [...characters.flatMap((c) => c.iconHashes), ...cards.flatMap((c) => c.artHashes)];
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(characters.filter((c) => c.iconHashes.length > 0).length).toBeGreaterThanOrEqual(characters.length * 0.95);
    expect(cards.filter((c) => c.artHashes.length > 0).length).toBeGreaterThanOrEqual(cards.length * 0.95);
  });
  it('the committed bundle contains no image bytes', () => {
    expect(existsSync(join(dir, 'gaps.txt'))).toBe(false);
  });
});
