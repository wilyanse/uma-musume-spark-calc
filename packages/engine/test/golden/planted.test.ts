/**
 * T08 golden dataset: the planted properties of 70 §2, checked independently of the generator.
 *
 * The checks recompute everything from the committed files, the published master bundle and the
 * T05 engine API (closed-form `planInheritance`/`expectationFromPlan`). Nothing imports the
 * generator's internals except `loadGoldenContext`, the documented way to rebuild the engine
 * context from truth.json (it is what T06/T15 tests will use too).
 */
import { describe, expect, it } from 'vitest';
import { APT_KEYS, GRADES, STAT_KEYS } from '@uma/schema';
import type { Grade, RosterVeteran, StatKey } from '@uma/schema';
import { expectationFromPlan, legacyFromVeteran, planInheritance } from '../../src/index.ts';
import type { InheritanceResult } from '../../src/index.ts';
import { loadGoldenContext } from '../../scripts/golden-context.ts';
import { calibrationRoster, master, roster, targets, truth } from './load.ts';
import {
  buildDesign,
  chooseLambda,
  effectiveCardEffect,
  effectiveSampleSize,
  holdoutCoverage,
  LAMBDA_BASE_GRID,
  LAMBDA_ID_GRID,
  recencyWeights,
  recordedLegacy as recordedLineage,
  ridge,
  coverageVariants,
} from '../../scripts/golden-diagnostic.ts';

const tm = truth.trainingModel;
const g = truth.golden;
const target = targets[0]!;
const byId = new Map(roster.map((v) => [v.id, v]));
const ctx = loadGoldenContext(master, truth);
const unread = new Map(truth.roster.unreadParentSparks.map((u) => [u.id, u.owner]));
const statIdx = (k: StatKey) => STAT_KEYS.indexOf(k);

/** The lineage recorded on a veteran, as the engine consumes it (matched -> roster record). */
const recordedLegacy = (v: RosterVeteran, slot: 1 | 2) => recordedLineage(v, slot, byId);

const pairExpectation = (a: RosterVeteran, b: RosterVeteran): InheritanceResult =>
  expectationFromPlan(
    planInheritance(
      ctx,
      g.traineeOutfitId,
      [legacyFromVeteran(a), legacyFromVeteran(b)],
      g.scenarioId,
    ),
  );

// --- Independent Gaussian pMeet for golden-cm-1 (the 50 §7 fast-pass idea, written here) -------
function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7).
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const upperTail = (z: number) => 0.5 * (1 - erf(z / Math.SQRT2));

const trainee = master.outfits.find((o) => o.id === g.traineeOutfitId)!;
/** The planted training mean for the plan (trainee, plan deck, mode, scenario), from truth.json. */
const planMean = STAT_KEYS.map((k) => {
  let m =
    tm.baseline[k] +
    tm.modeIntercept[g.trainMode][k] +
    tm.scenarioIntercept[g.scenarioId]![k] +
    tm.growthCoefficient[k] * trainee.growth[k];
  for (const d of g.planDeck) {
    const c = tm.plantedCards.find((p) => p.cardId === d.cardId);
    if (c) m += c.perUnit[k] * (1 + d.lb / 4);
  }
  return m;
});

function pMeet(e: InheritanceResult): number {
  let p = 1;
  for (const [apt, min] of Object.entries(target.minAptitudes) as [string, Grade][]) {
    const dist = e.aptitudeDist[apt as (typeof APT_KEYS)[number]];
    let q = 0;
    for (const [grade, pr] of Object.entries(dist))
      if (GRADES.indexOf(grade as Grade) >= GRADES.indexOf(min)) q += pr;
    p *= q;
  }
  for (const skill of target.requiredSkills)
    p *= (e.skillHintProb[skill] ?? 0) * truth.skills.rates[g.trainMode][skill]!;
  for (const [k, min] of Object.entries(target.minStats) as [StatKey, number][]) {
    const i = statIdx(k);
    const mean = planMean[i]! + e.expectedStatGain[i]!;
    const sd = Math.sqrt(tm.residualNoise.covariance[i]![i]! + e.statGainCov[i]![i]!);
    p *= upperTail((min - 0.5 - mean) / sd);
  }
  return p;
}

interface Scored {
  ids: [string, string];
  p: number;
  blueStars: number;
}
function scoreAllLegalPairs(): Scored[] {
  const out: Scored[] = [];
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i]!;
      const b = roster[j]!;
      if (a.characterId === b.characterId) continue;
      if (a.characterId === g.traineeCharacterId || b.characterId === g.traineeCharacterId)
        continue;
      out.push({
        ids: [a.id, b.id],
        p: pMeet(pairExpectation(a, b)),
        blueStars: [...a.sparks, ...b.sparks]
          .filter((s) => s.type === 'blue')
          .reduce((n, s) => n + s.stars, 0),
      });
    }
  }
  return out;
}
const samePair = (x: readonly string[], y: readonly string[]) =>
  x.length === 2 && y.length === 2 && x.includes(y[0]!) && x.includes(y[1]!);

// ------------------------------------------------------------------------------------------------

describe('legality and lineage', () => {
  it('parents are distinct characters, never the veteran itself; decks are legal', () => {
    for (const v of roster) {
      const [p1, p2] = [1, 2].map((s) => v.parents.find((p) => p.slot === s)!);
      expect(p1!.characterId).not.toBe(p2!.characterId);
      expect([p1!.characterId, p2!.characterId]).not.toContain(v.characterId);
      expect(new Set(v.deck.map((d) => d.cardId)).size).toBe(6);
      const deckChars = v.deck
        .map((d) => master.cards.find((c) => c.id === d.cardId)!.characterId)
        .filter((c): c is string => c !== undefined);
      expect(new Set(deckChars).size).toBe(deckChars.length);
      expect(deckChars).not.toContain(v.characterId);
      expect(v.deck.filter((d) => d.borrowed).length).toBeLessThanOrEqual(1);
      const outfit = master.outfits.find((o) => o.id === v.outfitId)!;
      expect(outfit.characterId).toBe(v.characterId);
    }
  });

  it('matched parents are earlier roster veterans whose record matches the parent block', () => {
    let matched = 0;
    for (const v of roster) {
      for (const p of v.parents) {
        if (p.isGuest) {
          expect(p.matchedVeteranId).toBeNull();
          expect(p.guestTrainer).not.toBeNull();
          continue;
        }
        expect(p.guestTrainer).toBeNull();
        if (!p.matchedVeteranId) continue;
        matched++;
        const m = byId.get(p.matchedVeteranId)!;
        expect(m.characterId).toBe(p.characterId);
        expect(m.outfitId).toBe(p.outfitId);
        expect(m.career.dateAcquired <= v.career.dateAcquired).toBe(true);
        expect(unread.has(m.id)).toBe(false);
        const owner = p.slot === 1 ? 'parent1' : 'parent2';
        if (unread.get(v.id) === owner) continue;
        const key = (s: { sparkId: string; stars: number }) => `${s.sparkId}|${s.stars}`;
        expect(
          v.sparks
            .filter((s) => s.owner === owner)
            .map(key)
            .sort(),
        ).toEqual(
          m.sparks
            .filter((s) => s.owner === 'self')
            .map(key)
            .sort(),
        );
      }
    }
    expect(matched).toBeGreaterThan(100);
  });

  it('planted veterans have guest parents only and are nobody’s parent', () => {
    const planted = new Set(Object.values(g.roles));
    for (const id of planted) expect(byId.get(id)!.parents.every((p) => p.isGuest)).toBe(true);
    for (const v of roster)
      for (const p of v.parents) expect(planted.has(p.matchedVeteranId ?? '')).toBe(false);
  });

  it('unread parent sparks only occur on low-confidence rows', () => {
    const low = new Set(truth.roster.lowConfidenceIds);
    for (const [id, owner] of unread) {
      expect(low.has(id)).toBe(true);
      expect(byId.get(id)!.sparks.some((s) => s.owner === owner)).toBe(false);
      expect(byId.get(id)!.minConfidence).toBeLessThan(0.9);
    }
  });
});

describe('skill X has no source except the planted best parent', () => {
  const X = g.skillX;
  const xSparks = master.sparks.filter((s) => s.target.kind === 'skill' && s.target.skillId === X);

  it('master data: one spark, no card / outfit / race-spark source', () => {
    expect(xSparks).toHaveLength(1);
    expect(xSparks[0]!.type).toBe('white');
    const skill = master.skills.find((s) => s.id === X)!;
    expect(skill.rarity).toBe('normal');
    for (const c of master.cards) expect([...c.hintSkillIds, ...c.eventSkillIds]).not.toContain(X);
    for (const o of master.outfits) {
      expect(o.uniqueSkillId).not.toBe(X);
      expect(o.innateSkillIds).not.toContain(X);
    }
    for (const row of ctx.tables.races.values()) expect(row.hintSkillIds).not.toContain(X);
  });

  it('roster: only best1 (self 3★, parent1 2★) carries the X spark, and only best1 has X', () => {
    const carriers = roster
      .filter((v) => v.sparks.some((s) => s.sparkId === xSparks[0]!.id))
      .map((v) => v.id);
    expect(carriers).toEqual([g.roles.best1]);
    const best1 = byId.get(g.roles.best1)!;
    expect(
      best1.sparks
        .filter((s) => s.sparkId === xSparks[0]!.id)
        .map((s) => `${s.owner}:${s.stars}`)
        .sort(),
    ).toEqual(['parent1:2', 'self:3']);
    const hasX = roster.filter((v) => v.skills.some((s) => s.skillId === X)).map((v) => v.id);
    expect(hasX).toEqual([g.roles.best1]);
  });

  it('target skill rates are planted per mode', () => {
    expect(truth.skills.rates.manual[X]).toBe(0.75);
    expect(truth.skills.rates.independent[X]).toBe(0.4);
  });
});

describe('planted best pair and trap pair for golden-cm-1', () => {
  const scored = scoreAllLegalPairs();
  const byP = [...scored].sort((a, b) => b.p - a.p);
  const byBlue = [...scored].sort((a, b) => b.blueStars - a.blueStars);

  it('every legal pair is scored (260 veterans minus trainee-character conflicts)', () => {
    expect(scored.length).toBeGreaterThan(30_000);
  });

  it('the best pair is the unique #1 by a wide margin', () => {
    expect(samePair(byP[0]!.ids, g.bestPair.parents)).toBe(true);
    expect(byP[0]!.p).toBeGreaterThan(0.05);
    expect(byP[0]!.p).toBeGreaterThan(10 * byP[1]!.p);
    expect(g.bestPair.characters).toEqual(
      g.bestPair.parents.map((id) => byId.get(id)!.characterId),
    );
  });

  it('only pairs containing best1 can meet the target (X hint), and best2 is needed for medium A', () => {
    for (const s of scored) {
      if (s.p > 0) expect(s.ids).toContain(g.roles.best1);
    }
    const mediumThree = roster.filter((v) =>
      v.sparks.some((s) => s.type === 'pink' && s.sparkId === 'spark:medium' && s.stars === 3),
    );
    expect(mediumThree.map((v) => v.id)).toEqual([g.roles.best2]);
  });

  it('the trap pair has the unique highest combined blue stars, no X source, and is not top 10', () => {
    expect(samePair(byBlue[0]!.ids, g.trapPair.parents)).toBe(true);
    expect(byBlue[0]!.blueStars).toBeGreaterThan(byBlue[1]!.blueStars);
    expect(byBlue[0]!.blueStars).toBe(18);
    const trap = g.trapPair.parents.map((id) => byId.get(id)!);
    const xSpark = master.sparks.find(
      (s) => s.target.kind === 'skill' && s.target.skillId === g.skillX,
    )!;
    for (const v of trap) expect(v.sparks.some((s) => s.sparkId === xSpark.id)).toBe(false);
    const e = pairExpectation(trap[0]!, trap[1]!);
    expect(e.skillHintProb[g.skillX] ?? 0).toBe(0);
    const trapRank = byP.findIndex((s) => samePair(s.ids, g.trapPair.parents));
    expect(trapRank).toBeGreaterThanOrEqual(10);
    // The trap is a "high single stat" pair: its expected speed beats the best pair's.
    const best = pairExpectation(byId.get(g.roles.best1)!, byId.get(g.roles.best2)!);
    expect(e.expectedStatGain[0]).toBeGreaterThan(best.expectedStatGain[0]! + 50);
  });
});

describe('training model: truth.json explains every roster stat', () => {
  it('stats = round(clip(training + noise + inheritance)) for both rosters', () => {
    for (const [rows, latent] of [
      [roster, truth.latent],
      [calibrationRoster, truth.calibration.latent],
    ] as const) {
      for (const v of rows) {
        const l = latent[v.id]!;
        const cap = tm.statCap[v.scenarioId]!;
        STAT_KEYS.forEach((k, i) => {
          const raw = l.training[i]! + l.noise[i]! + l.inheritance[i]!;
          expect(Math.abs(v.stats[k] - Math.min(cap, Math.max(1, raw)))).toBeLessThanOrEqual(
            0.5 + 1e-5,
          );
        });
      }
    }
  });

  it('latent training = the documented linear formula of the truth parameters', () => {
    for (const v of roster) {
      const outfit = master.outfits.find((o) => o.id === v.outfitId)!;
      STAT_KEYS.forEach((k, i) => {
        let t =
          tm.baseline[k] +
          tm.modeIntercept[v.trainMode][k] +
          tm.scenarioIntercept[v.scenarioId]![k] +
          tm.growthCoefficient[k] * outfit.growth[k];
        for (const d of v.deck) {
          const c = tm.plantedCards.find((p) => p.cardId === d.cardId);
          if (c) t += c.perUnit[k] * (1 + d.lb / 4);
        }
        expect(truth.latent[v.id]!.training[i]).toBeCloseTo(t, 5);
      });
    }
  });

  it('12 planted cards with exact LB scaling; zero-effect cards are disjoint; all real SSRs', () => {
    expect(tm.plantedCards).toHaveLength(12);
    const ids = new Set([...tm.plantedCards.map((c) => c.cardId), ...tm.zeroEffectCards]);
    expect(ids.size).toBe(12 + tm.zeroEffectCards.length);
    for (const c of tm.plantedCards) {
      const card = master.cards.find((m) => m.id === c.cardId)!;
      expect(card.type).toBe(c.type);
      expect(card.rarity).toBe('SSR');
      for (const k of STAT_KEYS) expect(c.atLb4[k]).toBe(2 * c.perUnit[k]);
      expect(Math.max(...STAT_KEYS.map((k) => c.atLb4[k]))).toBeGreaterThan(0);
    }
    for (const id of tm.zeroEffectCards)
      expect(master.cards.find((m) => m.id === id)?.rarity).toBe('SSR');
    // Every deck card is from the planted or zero pool; LBs 0..4 all occur among owned slots.
    const lbs = new Set<number>();
    for (const v of roster)
      for (const d of v.deck) {
        expect(ids.has(d.cardId)).toBe(true);
        if (!d.borrowed) lbs.add(d.lb);
      }
    expect([...lbs].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('residual noise sample covariance matches the planted MVN covariance', () => {
    const n = roster.length;
    const z = roster.map((v) => truth.latent[v.id]!.noise);
    const mean = STAT_KEYS.map((_, i) => z.reduce((s, r) => s + r[i]!, 0) / n);
    STAT_KEYS.forEach((_, i) => {
      expect(Math.abs(mean[i]!)).toBeLessThan(
        (4 * Math.sqrt(tm.residualNoise.covariance[i]![i]!)) / Math.sqrt(n),
      );
      STAT_KEYS.forEach((__, j) => {
        const c = z.reduce((s, r) => s + (r[i]! - mean[i]!) * (r[j]! - mean[j]!), 0) / (n - 1);
        const sd = Math.sqrt(
          tm.residualNoise.covariance[i]![i]! * tm.residualNoise.covariance[j]![j]!,
        );
        // Sampling sd of a covariance estimate ≤ σiσj·sqrt(2/n); allow 5 of them.
        expect(Math.abs(c - tm.residualNoise.covariance[i]![j]!)).toBeLessThan(
          5 * sd * Math.sqrt(2 / n),
        );
      });
    });
    // The documented covariance is corr × sd × sd.
    STAT_KEYS.forEach((ki, i) =>
      STAT_KEYS.forEach((kj, j) =>
        expect(tm.residualNoise.covariance[i]![j]).toBeCloseTo(
          tm.residualNoise.correlation[i]![j]! * tm.residualNoise.sd[ki] * tm.residualNoise.sd[kj],
          5,
        ),
      ),
    );
  });

  it('latent inheritance is consistent with the engine expectation on each recorded lineage', () => {
    // Σ (sampled − expected) over complete rows, standardised by the engine's own variance.
    const sumDiff = [0, 0, 0, 0, 0];
    const sumVar = [0, 0, 0, 0, 0];
    let rows = 0;
    for (const v of roster) {
      if (unread.has(v.id)) continue;
      const e = expectationFromPlan(
        planInheritance(
          ctx,
          v.outfitId,
          [recordedLegacy(v, 1), recordedLegacy(v, 2)],
          v.scenarioId,
        ),
      );
      rows++;
      for (let i = 0; i < 5; i++) {
        sumDiff[i]! += truth.latent[v.id]!.inheritance[i]! - e.expectedStatGain[i]!;
        sumVar[i]! += e.statGainCov[i]![i]!;
      }
    }
    expect(rows).toBeGreaterThan(240);
    for (let i = 0; i < 5; i++) {
      expect(sumVar[i]).toBeGreaterThan(0);
      expect(Math.abs(sumDiff[i]! / Math.sqrt(sumVar[i]!))).toBeLessThan(4);
    }
  });
});

describe('modes and skill acquisition', () => {
  it('exactly 60% independent / 40% manual; independent intercept −120 in total', () => {
    const ind = roster.filter((v) => v.trainMode === 'independent').length;
    expect(ind).toBe(156);
    expect(roster.length - ind).toBe(104);
    expect(truth.roster.modes).toMatchObject({ independent: 156, manual: 104 });
    const sum = (o: Record<StatKey, number>) => STAT_KEYS.reduce((s, k) => s + o[k], 0);
    expect(sum(tm.modeIntercept.independent)).toBe(-120);
    expect(tm.modeInterceptTotal.independent).toBe(-120);
    expect(sum(tm.modeIntercept.manual)).toBe(0);
  });

  it('epithet follows the 01 §6 rule unless modeSource is override', () => {
    for (const v of roster) {
      const fromEpithet =
        v.epithet.trim().toLowerCase() === 'independent learner' ? 'independent' : 'manual';
      if (v.modeSource === 'epithet') expect(v.trainMode).toBe(fromEpithet);
      else expect(v.trainMode).not.toBe(fromEpithet);
    }
    expect(
      roster
        .filter((v) => v.modeSource === 'override')
        .map((v) => v.id)
        .sort(),
    ).toEqual([...truth.roster.modeOverrideIds].sort());
  });

  it('acquired skills ⊆ hinted; acquisition counts match the per-mode planted rates', () => {
    const cards = new Map(master.cards.map((c) => [c.id, c]));
    const acc = {
      independent: { got: 0, exp: 0, v: 0 },
      manual: { got: 0, exp: 0, v: 0 },
    };
    for (const v of roster) {
      const outfit = master.outfits.find((o) => o.id === v.outfitId)!;
      const hinted = new Set([...outfit.innateSkillIds, ...truth.latent[v.id]!.inheritanceHints]);
      for (const d of v.deck)
        for (const s of [
          ...cards.get(d.cardId)!.hintSkillIds,
          ...cards.get(d.cardId)!.eventSkillIds,
        ])
          hinted.add(s);
      hinted.delete(outfit.uniqueSkillId);
      const unique = v.skills.filter((s) => s.level !== null);
      expect(unique.map((s) => s.skillId)).toEqual([outfit.uniqueSkillId]);
      const acquired = new Set(v.skills.filter((s) => s.level === null).map((s) => s.skillId));
      for (const s of acquired) expect(hinted.has(s)).toBe(true);
      const a = acc[v.trainMode];
      for (const s of hinted) {
        const p = truth.skills.rates[v.trainMode][s]!;
        a.exp += p;
        a.v += p * (1 - p);
        if (acquired.has(s)) a.got++;
      }
    }
    for (const a of Object.values(acc))
      expect(Math.abs(a.got - a.exp)).toBeLessThan(4 * Math.sqrt(a.v));
    // The two modes really differ: mean planted rate over all skills.
    const mean = (m: 'independent' | 'manual') => {
      const r = Object.values(truth.skills.rates[m]);
      return r.reduce((s, x) => s + x, 0) / r.length;
    };
    expect(mean('manual') - mean('independent')).toBeGreaterThan(0.1);
    expect(Object.keys(truth.skills.rates.manual).sort()).toEqual(
      master.skills.map((s) => s.id).sort(),
    );
  });
});

describe('synthetic inheritance inputs and the ×1.3 calibration variant', () => {
  it('turns are synthetic and labelled; published turns are still []', () => {
    for (const s of master.scenarios) {
      expect(s.inheritanceTurns).toEqual([]);
      const t = truth.syntheticInheritance.inheritanceTurns[s.id]!;
      expect(t.synthetic).toBe(true);
      expect(t.turns.length).toBeGreaterThan(0);
      expect(t.note).toMatch(/SYNTHETIC/);
      expect(ctx.scenarios.get(s.id)!.inheritanceTurns(ctx)).toEqual(t.turns);
    }
    const b = truth.syntheticInheritance.rulesOverrides.blueStatGain;
    expect(b.verified).toBe(false);
    expect(b.source).toMatch(/SYNTHETIC/);
    expect(truth.syntheticInheritance.blueStatGainMultiplier).toBe(1);
  });

  it('every other rule is used verbatim from rules.json', () => {
    for (const key of truth.syntheticInheritance.rulesUsedVerbatim) {
      const [head] = key.split('.');
      expect(ctx.rules[head as keyof typeof ctx.rules]).toEqual(
        master.rules[head as keyof typeof master.rules],
      );
    }
    expect(ctx.tables.blueStatGain).toEqual([b('1'), b('2'), b('3')]);
    function b(s: '1' | '2' | '3') {
      return truth.syntheticInheritance.rulesOverrides.blueStatGain[s];
    }
    const calibCtx = loadGoldenContext(master, truth, 1.3);
    expect(calibCtx.tables.blueStatGain.map((x) => Math.round(x * 1e6) / 1e6)).toEqual(
      [b('1'), b('2'), b('3')].map((x) => Math.round(x * 1.3 * 1e6) / 1e6),
    );
  });

  it('the ×1.3 roster differs only through blue activation gains', () => {
    expect(truth.calibration.blueStatGainMultiplier).toBe(1.3);
    let changed = 0;
    roster.forEach((v, n) => {
      const c = calibrationRoster[n]!;
      expect(c.id).toBe(v.id);
      expect({ ...c, stats: 0, rating: 0, rank: 0, fingerprint: 0 }).toEqual({
        ...v,
        stats: 0,
        rating: 0,
        rank: 0,
        fingerprint: 0,
      });
      const a = truth.latent[v.id]!;
      const b = truth.calibration.latent[v.id]!;
      expect(b.training).toEqual(a.training);
      expect(b.noise).toEqual(a.noise);
      for (let i = 0; i < 5; i++) {
        const d = b.inheritance[i]! - a.inheritance[i]!;
        // blueStatGain 10/20/30 × 0.3 = 3/6/9 per activation: always a non-negative multiple of 3.
        expect(d).toBeGreaterThanOrEqual(0);
        expect(Math.abs(d / 3 - Math.round(d / 3))).toBeLessThan(1e-6);
        if (d > 0) changed++;
      }
    });
    expect(changed).toBeGreaterThan(200);
  });
});

describe('training-row realism (50 §4 inputs)', () => {
  it('confidence, recency, holdout', () => {
    const eligible = roster
      .filter((v) => v.minConfidence >= 0.9)
      .map((v) => v.id)
      .sort();
    expect([...truth.roster.trainingEligibleIds].sort()).toEqual(eligible);
    expect(truth.roster.lowConfidenceIds.length).toBeGreaterThan(5);
    const h = truth.holdout;
    expect(h.holdoutIds.length).toBe(Math.ceil(eligible.length * 0.2));
    expect([...h.holdoutIds, ...h.trainIds].sort()).toEqual(eligible);
    expect(new Set([...h.holdoutIds, ...h.trainIds]).size).toBe(eligible.length);
    const dates = roster.map((v) => v.career.dateAcquired).sort();
    const spanDays = (Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / 86_400_000;
    // B1: 60–90 days, so the 60-day recency half-life keeps most of the train rows' weight.
    expect(spanDays).toBeGreaterThanOrEqual(60);
    expect(spanDays).toBeLessThanOrEqual(90);
    expect(truth.roster.dateAcquiredRange).toEqual([dates[0], dates.at(-1)]);
    for (const v of roster) {
      expect(v.capturedAt.slice(0, 10) >= v.career.dateAcquired).toBe(true);
      expect(v.capturedAt < truth.meta.generatedAt).toBe(true);
    }
    expect(new Set(roster.map((v) => v.scenarioId)).size).toBe(4);
  });
});

// ------------------------------------------------------------------------------------------------
// B1 / S3: what T06 can recover with ONLY the data it will have (no truth.latent, no holdout).
// ------------------------------------------------------------------------------------------------
describe('50 §4 recoverability with T06-available data only (test-only diagnostic fit)', () => {
  // The context is rebuilt from the synthetic inheritance inputs alone: no latent field reaches
  // the design (y = finalStat − E[inheritance | recorded lineage]).
  const ctxNoLatent = loadGoldenContext(master, {
    syntheticInheritance: structuredClone(truth.syntheticInheritance),
  });
  const h = truth.holdout;
  const design = buildDesign(ctxNoLatent, master, roster, h.trainIds, h.holdoutIds);
  const train = design.rows.slice(0, h.trainIds.length);
  const hold = design.rows.slice(h.trainIds.length);
  const w = recencyWeights(train);
  const cardType = new Map(master.cards.map((c) => [c.id, c.type]));

  /** Worst relative error of β_id + β_type over every planted (card, stat ≠ 0). */
  function recovery(lambdas: readonly { lambdaId: number; lambdaBase: number }[]) {
    let worst = 0;
    let worstZero = 0;
    const fails: string[] = [];
    STAT_KEYS.forEach((k, s) => {
      const fit = ridge(design, train, w, s, lambdas[s]!.lambdaId, lambdas[s]!.lambdaBase);
      for (const c of tm.plantedCards) {
        const want = c.perUnit[k];
        if (want === 0) continue;
        const got = effectiveCardEffect(design, fit.beta, c.cardId, c.type);
        const err = Math.abs(got - want) / want;
        worst = Math.max(worst, err);
        if (err >= 0.15) fails.push(`${c.cardId}.${k} ${want} -> ${got.toFixed(2)}`);
      }
      for (const id of tm.zeroEffectCards)
        worstZero = Math.max(
          worstZero,
          Math.abs(effectiveCardEffect(design, fit.beta, id, cardType.get(id)!)),
        );
    });
    return { worst, worstZero, fails };
  }

  it('uses only eligible train rows; the stored split is disjoint from the fit', () => {
    expect(train).toHaveLength(192);
    expect(hold).toHaveLength(48);
    const eligible = new Set(truth.roster.trainingEligibleIds);
    for (const r of train) expect(eligible.has(r.id)).toBe(true);
    const low = new Set(truth.roster.lowConfidenceIds);
    for (const r of design.rows) expect(low.has(r.id)).toBe(false);
    expect(new Set(h.holdoutIds).has(train[0]!.id)).toBe(false);
    // Recency (50 §4, half-life 60 days): the dataset keeps an effective sample of most rows.
    expect(effectiveSampleSize(w)).toBeGreaterThan(160);
  });

  it('the type feature is the sum of its id features: only β_id + β_type is identified (Q-122)', () => {
    const typeCol = (t: string) => design.names.indexOf(`type:${t}`);
    for (const r of train) {
      const sums = new Map<string, number>();
      design.names.forEach((n, i) => {
        if (!n.startsWith('card:')) return;
        const t = cardType.get(n.slice('card:'.length))!;
        sums.set(t, (sums.get(t) ?? 0) + r.x[i]!);
      });
      for (const [t, v] of sums) expect(r.x[typeCol(t)]).toBeCloseTo(v, 12);
    }
    // Every type has ≥ 2 cards in the pool, so no type feature equals a single card id.
    const perType = new Map<string, number>();
    for (const id of [...tm.plantedCards.map((c) => c.cardId), ...tm.zeroEffectCards])
      perType.set(cardType.get(id)!, (perType.get(cardType.get(id)!) ?? 0) + 1);
    for (const n of perType.values()) expect(n).toBeGreaterThanOrEqual(2);
  });

  it.each([
    [0.1, 0.1],
    [0.1, 1],
    [1, 0.1],
    [1, 1],
    [1, 10],
  ])('λ_id=%s λ_base=%s recovers all 12 planted effects within ±15% with margin', (li, lb) => {
    const r = recovery(STAT_KEYS.map(() => ({ lambdaId: li, lambdaBase: lb })));
    expect(r.fails).toEqual([]);
    // Margin: the worst relative error stays well inside the ±15% acceptance.
    expect(r.worst).toBeLessThan(0.1);
    // Zero-effect cards stay near 0 (smallest planted effect is 40 per unit).
    expect(r.worstZero).toBeLessThan(8);
  });

  // S1 (review round 2): λ 0.1/10 is a valid 50 §4 grid point with a THIN margin. A heavy base
  // penalty shrinks the intercept/scenario columns, and the friend card (Tazuna, +40 on all five
  // stats) absorbs part of it. Measured worst 13.78% (tazuna pow 40 -> 45.51) on the final data
  // (`node packages/engine/test/golden/diagnostics.ts`): it passes ±15% with only ~1.2 points of
  // margin, so it is asserted against the acceptance bound itself, not the 10% margin bound.
  it('λ_id=0.1 λ_base=10 (thin-margin grid point) still recovers every effect within ±15%', () => {
    const r = recovery(STAT_KEYS.map(() => ({ lambdaId: 0.1, lambdaBase: 10 })));
    expect(r.fails).toEqual([]);
    expect(r.worst).toBeLessThan(0.15);
    expect(r.worstZero).toBeLessThan(8);
  });

  it('the 5-fold CV grid {0.1,1,10,100}×{0.1,1,10} picks λ that recovers every effect', () => {
    const chosen = STAT_KEYS.map((_, s) => chooseLambda(design, train, s));
    for (const c of chosen) {
      expect(Object.keys(c.grid)).toHaveLength(LAMBDA_ID_GRID.length * LAMBDA_BASE_GRID.length);
      // N2: λ_id ≤ 1 is the tested recoverable region of THIS synthetic dataset (λ_id ≥ 10
      // over-shrinks the card ids: worst 17–58% in diagnostics.ts), not a universal rule for a
      // 50 §4 estimator. A different CV loss, fold seed or weighting may legitimately pick another
      // λ; this assertion only pins that the seeded CV here lands where recovery is proven.
      expect(c.lambdaId).toBeLessThanOrEqual(1);
    }
    const r = recovery(chosen);
    expect(r.fails).toEqual([]);
    expect(r.worst).toBeLessThan(0.1);
  });

  it('S3: holdout 80% interval coverage (pooled) is inside 0.72–0.88', () => {
    const lambdas = STAT_KEYS.map((_, s) => chooseLambda(design, train, s));
    const c = holdoutCoverage(design, train, hold, lambdas);
    expect(c.cells).toBe(240);
    // The band assertion is the evidence; it is computed here from the data, not read back.
    expect(c.pooled).toBeGreaterThanOrEqual(0.72);
    expect(c.pooled).toBeLessThanOrEqual(0.88);
    // DERIVED self-consistency only (review round 2 S2): truth.json stores what the same
    // scripts/golden-diagnostic.ts code computed at generation time. Matching it proves the
    // committed metadata is current, not that the diagnostic is correct.
    const rec = truth.holdout.coverageDiagnostic;
    expect(rec.status).toBe('DERIVED self-consistency metadata, not independent proof');
    expect(c.pooled).toBeCloseTo(rec.pooled, 6);
    STAT_KEYS.forEach((k, s) => expect(c.perStat[s]).toBeCloseTo(rec.perStat[k], 6));
    expect(rec.band).toEqual([0.72, 0.88]);
  });

  it('S3: alternative variance definitions are recorded for the final data (margins documented)', () => {
    const lambdas = STAT_KEYS.map((_, s) => chooseLambda(design, train, s));
    const v = coverageVariants(design, train, hold, lambdas);
    const rec = truth.holdout.coverageDiagnostic.variants;
    for (const key of [
      'literal',
      'plusInheritance',
      'plusInheritanceNet',
      'trainPlugin',
    ] as const) {
      expect(v[key].pooled).toBeCloseTo(rec[key].pooled, 6);
      expect(v[key].cells).toBe(240);
    }
    // literal 50 §4 holdout residualCov sits inside the band.
    expect(v.literal.pooled).toBeGreaterThanOrEqual(0.72);
    expect(v.literal.pooled).toBeLessThanOrEqual(0.88);
    // Adding Var[inh] on top of residualCov double counts the inheritance-sampling variance, so it
    // can only widen the interval relative to `literal`.
    expect(v.plusInheritance.pooled).toBeGreaterThanOrEqual(v.literal.pooled);
    // residualCov is a holdout statistic; the per-row engine variance is ≥ 0 and non-trivial.
    for (const r of hold) for (const x of r.inhVar) expect(x).toBeGreaterThanOrEqual(0);
    expect(truth.holdout.coverageDiagnostic.limitations).toMatch(
      /literal 50 §4 holdout residualCov/,
    );
  });
});

// ------------------------------------------------------------------------------------------------
// S2: the observable hinted-skill estimand differs from the latent conditional rates.
// ------------------------------------------------------------------------------------------------
describe('skill estimand: observable (50 §4) hinted vs latent activation-conditional rates', () => {
  it('lineage-hinted rows are acquired at rates × P(hint), not at rates', () => {
    const cards = new Map(master.cards.map((c) => [c.id, c]));
    const eligible = roster.filter((v) => v.minConfidence >= 0.9);
    let observableHinted = 0;
    let latentHinted = 0;
    const exp = { got: 0, mixture: 0, varMixture: 0, naive: 0 };
    for (const v of eligible) {
      const outfit = master.outfits.find((o) => o.id === v.outfitId)!;
      const sure = new Set(outfit.innateSkillIds);
      for (const d of v.deck)
        for (const s of [
          ...cards.get(d.cardId)!.hintSkillIds,
          ...cards.get(d.cardId)!.eventSkillIds,
        ])
          sure.add(s);
      sure.delete(outfit.uniqueSkillId);
      const e = expectationFromPlan(
        planInheritance(
          ctx,
          v.outfitId,
          [recordedLegacy(v, 1), recordedLegacy(v, 2)],
          v.scenarioId,
        ),
      );
      const observable = new Set([...sure, ...Object.keys(e.skillHintProb)]);
      observable.delete(outfit.uniqueSkillId);
      const latent = new Set([...sure, ...truth.latent[v.id]!.inheritanceHints]);
      latent.delete(outfit.uniqueSkillId);
      for (const s of latent) expect(observable.has(s)).toBe(true);
      observableHinted += observable.size;
      latentHinted += latent.size;
      const acquired = new Set(v.skills.filter((s) => s.level === null).map((s) => s.skillId));
      for (const s of observable) {
        const rate = truth.skills.rates[v.trainMode][s]!;
        const pHint = sure.has(s) ? 1 : (e.skillHintProb[s] ?? 0);
        const p = rate * pHint;
        exp.mixture += p;
        exp.varMixture += p * (1 - p);
        exp.naive += rate;
        if (acquired.has(s)) exp.got++;
      }
    }
    // The observable hinted set strictly contains the latent one.
    expect(observableHinted).toBeGreaterThan(latentHinted);
    // Observed acquisitions match the documented estimand rates × P(hint | recorded lineage)...
    const sd = Math.sqrt(exp.varMixture);
    expect(Math.abs(exp.got - exp.mixture)).toBeLessThan(4 * sd);
    // ...and are clearly below Σ rates over the observable hinted set, so Beta means ≠ rates.
    expect(exp.naive - exp.got).toBeGreaterThan(6 * sd);
    expect(truth.skills.observableEstimand).toMatch(/must NOT be compared with `rates`/);
  });
});

describe('documentation fields (N2, S4/N3)', () => {
  it('clipping is recorded as not exercised, consistent with the roster', () => {
    const vals = roster.flatMap((v) => STAT_KEYS.map((k) => v.stats[k]));
    const cap = Math.min(...Object.values(tm.statCap));
    expect(tm.clipping.exercised).toBe(false);
    expect(tm.clipping.observedStatRange).toEqual([Math.min(...vals), Math.max(...vals)]);
    expect(Math.max(...vals)).toBeLessThan(cap);
    expect(Math.min(...vals)).toBeGreaterThan(1);
  });

  it('web fixture copies are documented as future fixture-planner metadata', () => {
    expect(truth.webFixtures.note).toMatch(/NOT consumed by the web client/);
    expect(truth.webFixtures.note).toMatch(/loadGoldenContext/);
  });
});
