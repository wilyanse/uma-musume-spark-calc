/**
 * S05 target editor model and the per-trainee skill checks used by S06 (Q-142). Pure.
 *
 * The editor has no trainee, so it never bans unique skills globally: it only checks that ids are
 * known master skills. The planner, which knows the trainee, runs `skillIssuesForTrainee` before
 * ranking (and before any re-score of cached results) and offers to drop offending skills from a
 * per-run copy of the target.
 */
import type { AptKey, CmTarget, Grade, StatKey } from '@uma/schema';
import type { CmTargetInput } from '../api/types.ts';
import type { MasterData } from '../master/load.ts';
import { APT_KEYS, GRADES, STAT_KEYS } from './keys.ts';

export interface TargetDraft {
  name: string;
  surface: 'turf' | 'dirt';
  distance: 'sprint' | 'mile' | 'medium' | 'long';
  meters: string;
  notes: string;
  style: 'front' | 'pace' | 'late' | 'end';
  minStats: Record<StatKey, string>;
  minAptitudes: Record<AptKey, Grade | ''>;
  requiredSkills: string[];
  optionalSkills: { skillId: string; weight: string }[];
  statWeights: Record<StatKey, string>;
}

const perStat = <T,>(f: (k: StatKey) => T) => Object.fromEntries(STAT_KEYS.map((k) => [k, f(k)])) as Record<StatKey, T>;
const perApt = <T,>(f: (k: AptKey) => T) => Object.fromEntries(APT_KEYS.map((k) => [k, f(k)])) as Record<AptKey, T>;

export function blankDraft(): TargetDraft {
  return {
    name: '',
    surface: 'turf',
    distance: 'medium',
    meters: '',
    notes: '',
    style: 'pace',
    minStats: perStat(() => ''),
    minAptitudes: perApt(() => ''),
    requiredSkills: [],
    optionalSkills: [],
    statWeights: perStat(() => ''),
  };
}

export function draftFromTarget(t: CmTarget): TargetDraft {
  const ms = t.minStats as Partial<Record<StatKey, number>>;
  const ma = t.minAptitudes as Partial<Record<AptKey, Grade>>;
  const sw = (t.statWeights ?? {}) as Partial<Record<StatKey, number>>;
  return {
    name: t.name,
    surface: t.course.surface,
    distance: t.course.distance,
    meters: t.course.meters === undefined ? '' : String(t.course.meters),
    notes: t.course.notes ?? '',
    style: t.style,
    minStats: perStat((k) => (ms[k] === undefined ? '' : String(ms[k]))),
    minAptitudes: perApt((k) => ma[k] ?? ''),
    requiredSkills: [...t.requiredSkills],
    optionalSkills: t.optionalSkills.map((o) => ({ skillId: o.skillId, weight: String(o.weight) })),
    statWeights: perStat((k) => (sw[k] === undefined ? '' : String(sw[k]))),
  };
}

export const ERR = {
  name: 'Give the target a name.',
  stat: 'Enter a whole number from 1 to 2000.',
  weight: 'Enter a number greater than 0.',
  duplicate: (skill: string) => `${skill} is already in the required list.`,
  meters: 'Enter a whole number of metres (1 or more).',
  unknownSkill: (id: string) => `${id} is not in master data.`,
};

export interface DraftResult {
  errors: Record<string, string>;
  input: CmTargetInput | null;
}

export function validateDraft(d: TargetDraft, m: MasterData): DraftResult {
  const errors: Record<string, string> = {};
  const name = d.name.trim();
  if (!name) errors.name = ERR.name;
  const minStats: Partial<Record<StatKey, number>> = {};
  for (const k of STAT_KEYS) {
    const raw = d.minStats[k].trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1 || n > 2000) errors[`minStats.${k}`] = ERR.stat;
    else minStats[k] = n;
  }
  const minAptitudes: Partial<Record<AptKey, Grade>> = {};
  for (const k of APT_KEYS) {
    const g = d.minAptitudes[k];
    if (g && (GRADES as readonly string[]).includes(g)) minAptitudes[k] = g;
  }
  let meters: number | undefined;
  if (d.meters.trim()) {
    const n = Number(d.meters.trim());
    if (!/^\d+$/.test(d.meters.trim()) || n < 1) errors.meters = ERR.meters;
    else meters = n;
  }
  const skillName = (id: string) => m.skills.get(id)?.name ?? id;
  const unknown = d.requiredSkills.filter((s) => !m.skills.has(s));
  if (unknown.length) errors.requiredSkills = unknown.map(ERR.unknownSkill).join(' ');
  const req = new Set(d.requiredSkills);
  const seenOpt = new Set<string>();
  const optionalSkills: { skillId: string; weight: number }[] = [];
  d.optionalSkills.forEach((o, i) => {
    const key = `optionalSkills.${i}`;
    if (!m.skills.has(o.skillId)) errors[key] = ERR.unknownSkill(o.skillId);
    else if (req.has(o.skillId) || seenOpt.has(o.skillId)) errors[key] = ERR.duplicate(skillName(o.skillId));
    const w = Number(o.weight);
    if (!errors[key] && !(o.weight.trim() !== '' && Number.isFinite(w) && w > 0)) errors[key] = ERR.weight;
    seenOpt.add(o.skillId);
    optionalSkills.push({ skillId: o.skillId, weight: w });
  });
  if (new Set(d.requiredSkills).size !== d.requiredSkills.length) {
    errors.requiredSkills = ERR.duplicate('A skill');
  }
  const statWeights: Partial<Record<StatKey, number>> = {};
  for (const k of STAT_KEYS) {
    const raw = d.statWeights[k].trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) errors[`statWeights.${k}`] = 'Enter a number.';
    else statWeights[k] = n;
  }
  if (Object.keys(errors).length) return { errors, input: null };
  const course: CmTarget['course'] = { surface: d.surface, distance: d.distance };
  if (meters !== undefined) course.meters = meters;
  if (d.notes.trim()) course.notes = d.notes.trim();
  const input: CmTargetInput = {
    name,
    course,
    style: d.style,
    minStats,
    minAptitudes,
    requiredSkills: [...d.requiredSkills],
    optionalSkills,
  };
  if (Object.keys(statWeights).length) input.statWeights = statWeights;
  return { errors, input };
}

export interface SkillIssue {
  skillId: string;
  reason: 'own-unique' | 'unknown';
  where: 'required' | 'optional';
}

/** Q-142 + T06 S2: target skills the engine will refuse for this trainee. */
export function skillIssuesForTrainee(t: CmTarget, traineeOutfitId: string, m: MasterData): SkillIssue[] {
  const own = m.outfits.get(traineeOutfitId)?.uniqueSkillId;
  const out: SkillIssue[] = [];
  const check = (skillId: string, where: SkillIssue['where']) => {
    if (own && skillId === own) out.push({ skillId, reason: 'own-unique', where });
    else if (!m.skills.has(skillId)) out.push({ skillId, reason: 'unknown', where });
  };
  for (const s of t.requiredSkills) check(s, 'required');
  for (const o of t.optionalSkills) check(o.skillId, 'optional');
  return out;
}

/** A copy of the target without the given skills (the saved target is never modified). */
export function withoutSkills(t: CmTarget, drop: readonly string[]): CmTarget {
  const d = new Set(drop);
  return {
    ...t,
    requiredSkills: t.requiredSkills.filter((s) => !d.has(s)),
    optionalSkills: t.optionalSkills.filter((o) => !d.has(o.skillId)),
  };
}
