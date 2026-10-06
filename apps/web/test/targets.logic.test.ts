import { describe, expect, it } from 'vitest';
import type { CmTarget } from '@uma/schema';
import {
  blankDraft,
  draftFromTarget,
  validateDraft,
  skillIssuesForTrainee,
  withoutSkills,
} from '../src/lib/targets.ts';
import { goldenTargets, masterData } from './fixtures.ts';

const m = masterData();
const golden = goldenTargets()[0]!;

describe('target draft round trip (S05, F10)', () => {
  it('a saved target becomes a draft and validates back to the same input', () => {
    const r = validateDraft(draftFromTarget(golden), m);
    expect(r.errors).toEqual({});
    const rest: Record<string, unknown> = { ...golden };
    delete rest.id;
    expect(r.input).toEqual(rest);
  });
  it('blank stats/aptitudes/weights are omitted (not 0)', () => {
    const d = { ...blankDraft(), name: 'x' };
    const r = validateDraft(d, m);
    expect(r.errors).toEqual({});
    expect(r.input).toMatchObject({ minStats: {}, minAptitudes: {}, requiredSkills: [], optionalSkills: [] });
    expect(r.input).not.toHaveProperty('statWeights');
    expect(r.input!.course).not.toHaveProperty('meters');
  });
});

describe('target validation messages (copy.md S05)', () => {
  it('requires a name', () => {
    expect(validateDraft(blankDraft(), m).errors.name).toBe('Give the target a name.');
  });
  it('stats must be whole numbers 1..2000', () => {
    for (const bad of ['0', '2001', '12.5', 'abc', '-3']) {
      const d = { ...blankDraft(), name: 'x', minStats: { ...blankDraft().minStats, spd: bad } };
      expect(validateDraft(d, m).errors['minStats.spd']).toBe('Enter a whole number from 1 to 2000.');
    }
  });
  it('optional weights must be > 0', () => {
    const d = { ...blankDraft(), name: 'x', optionalSkills: [{ skillId: 'skill:restraint', weight: '0' }] };
    expect(validateDraft(d, m).errors['optionalSkills.0']).toBe('Enter a number greater than 0.');
  });
  it('rejects duplicate skills', () => {
    const d = {
      ...blankDraft(),
      name: 'x',
      requiredSkills: ['skill:restraint'],
      optionalSkills: [{ skillId: 'skill:restraint', weight: '1' }],
    };
    expect(validateDraft(d, m).errors['optionalSkills.0']).toMatch(/already in the required list/);
  });
  it('rejects skill ids unknown to the loaded master data', () => {
    const d = { ...blankDraft(), name: 'x', requiredSkills: ['skill:not-a-real-skill-zzz'] };
    expect(validateDraft(d, m).errors.requiredSkills).toMatch(/not in master data/);
  });
  it('does NOT ban unique skills globally (the editor has no trainee; Q-142)', () => {
    const unique = [...m.skills.values()].find((s) => s.rarity === 'unique')!;
    const d = { ...blankDraft(), name: 'x', requiredSkills: [unique.id] };
    expect(validateDraft(d, m).errors).toEqual({});
  });
});

describe('per-trainee skill checks before ranking or re-scoring (Q-142)', () => {
  const outfit = [...m.outfits.values()][0]!;
  const t: CmTarget = {
    ...golden,
    requiredSkills: [outfit.uniqueSkillId, 'skill:restraint'],
    optionalSkills: [{ skillId: 'skill:does-not-exist-zzz', weight: 1 }],
  };
  it('finds the trainee own unique skill and unknown ids', () => {
    const issues = skillIssuesForTrainee(t, outfit.id, m);
    expect(issues).toEqual([
      { skillId: outfit.uniqueSkillId, reason: 'own-unique', where: 'required' },
      { skillId: 'skill:does-not-exist-zzz', reason: 'unknown', where: 'optional' },
    ]);
  });
  it('another outfit unique skill is fine', () => {
    const other = [...m.outfits.values()].find((o) => o.uniqueSkillId !== outfit.uniqueSkillId)!;
    const t2 = { ...golden, requiredSkills: [other.uniqueSkillId] };
    expect(skillIssuesForTrainee(t2, outfit.id, m)).toEqual([]);
  });
  it('withoutSkills returns a copy without them and leaves the saved target untouched', () => {
    const copy = withoutSkills(t, [outfit.uniqueSkillId, 'skill:does-not-exist-zzz']);
    expect(copy.requiredSkills).toEqual(['skill:restraint']);
    expect(copy.optionalSkills).toEqual([]);
    expect(t.requiredSkills).toHaveLength(2);
  });
});
