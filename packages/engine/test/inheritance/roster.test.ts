/**
 * S1 / B1 on real data: the 50 §1 public API `inheritanceExpectation(ctx, outfit, [Veteran,
 * Veteran], scenarioId)` with schema-valid `RosterVeteran`s, and the `legacyFromVeteran` adapter.
 * Uses the published Global bundle read-only (validated with the shared schemas) and, where
 * events are needed, a synthetic copy of a scenario row with injected turns (clearly synthetic:
 * the published turns are unknown, Q-5).
 */
import { describe, expect, it } from 'vitest';
import type { RosterVeteran } from '@uma/schema';
import {
  expectationFromPlan,
  IllegalPairError,
  inheritanceExpectation,
  legacyFromVeteran,
  loadContext,
  planInheritance,
} from '../../src/index.ts';
import { loadPublishedBundle, makeRosterVeteran } from '../../scripts/published-bundle.ts';
import { expectContributionsSumToExpected, expectVectorClose } from './fixtures.ts';

const master = loadPublishedBundle();
const ctx = loadContext(master, master.rules);
const URA = 'scenario:ura-finale';
const TRAINEE = 'outfit:frontline-elegance'; // Mejiro McQueen
const IDS = [
  '01J8Z3K4M5N6P7Q8R9S0T1V2W3',
  '01J8Z3K4M5N6P7Q8R9S0T1V2W4',
  '01J8Z3K4M5N6P7Q8R9S0T1V2W5',
];
const cardId = master.cards[0]!.id;

type S = { sparkId: string; type: 'blue' | 'pink' | 'green' | 'white'; stars: 1 | 2 | 3 };
const b = (sparkId: string, stars: 1 | 2 | 3): S => ({ sparkId, type: 'blue', stars });
const pk = (sparkId: string, stars: 1 | 2 | 3): S => ({ sparkId, type: 'pink', stars });
const wh = (sparkId: string, stars: 1 | 2 | 3): S => ({ sparkId, type: 'white', stars });

/** Special Week: self spd 3★ + turf 2★ + Arima Kinen 2★; parent slot 1 Tokai Teio, slot 2 guest Gold Ship. */
function specialWeek(opts: { slots?: [1 | 2, 1 | 2]; id?: string } = {}): RosterVeteran {
  const slots = opts.slots ?? [1, 2];
  // `parents` array order follows `slots`: the character in slot 1 is always Tokai Teio.
  const teio = { characterId: 'character:tokai-teio', matchedVeteranId: IDS[2]! };
  const ship = { characterId: 'character:gold-ship', isGuest: true, matchedVeteranId: null };
  return makeRosterVeteran({
    id: opts.id ?? IDS[0]!,
    characterId: 'character:special-week',
    outfitId: 'outfit:special-dreamer',
    cardId,
    scenarioId: URA,
    self: [b('spark:speed', 3), pk('spark:turf', 2), wh('spark:arima-kinen', 2)],
    parent1: [b('spark:stamina', 2), pk('spark:mile', 1)],
    parent2: [b('spark:wit', 3), pk('spark:long', 1)],
    parents: slots[0] === 1 ? [teio, ship] : [ship, teio],
    slots,
  });
}
function suzuka(): RosterVeteran {
  return makeRosterVeteran({
    id: IDS[1]!,
    characterId: 'character:silence-suzuka',
    outfitId: 'outfit:innocent-silence',
    cardId,
    scenarioId: URA,
    self: [b('spark:power', 1), pk('spark:medium', 3)],
    parent1: [],
    parent2: [b('spark:guts', 1), pk('spark:dirt', 2)],
    parents: [{ characterId: 'character:vodka' }, { characterId: 'character:daiwa-scarlet' }],
  });
}
function mcqueenVeteran(): RosterVeteran {
  return makeRosterVeteran({
    id: IDS[2]!,
    characterId: 'character:mejiro-mcqueen',
    outfitId: 'outfit:end-of-the-skies',
    cardId,
    scenarioId: URA,
    self: [b('spark:stamina', 3), pk('spark:long', 2)],
    parent1: [],
    parent2: [],
    parents: [{ characterId: 'character:vodka' }, { characterId: 'character:daiwa-scarlet' }],
  });
}

describe('legacyFromVeteran (S1)', () => {
  it('maps self -> legacy sparks, parent1/parent2 -> grandparents by parent slot', () => {
    const l = legacyFromVeteran(specialWeek());
    expect(l.veteranId).toBe(IDS[0]);
    expect(l.characterId).toBe('character:special-week');
    expect(l.sparks.map((s) => s.sparkId)).toEqual([
      'spark:speed',
      'spark:turf',
      'spark:arima-kinen',
    ]);
    expect(l.grandparents[0]).toEqual({
      characterId: 'character:tokai-teio',
      sparks: [b('spark:stamina', 2), pk('spark:mile', 1)],
    });
    expect(l.grandparents[1]).toEqual({
      characterId: 'character:gold-ship',
      sparks: [b('spark:wit', 3), pk('spark:long', 1)],
    });
  });

  it('uses parents[].slot, not array order', () => {
    const swapped = specialWeek({ slots: [2, 1] });
    expect(swapped.parents.map((p) => p.slot)).toEqual([2, 1]);
    expect(legacyFromVeteran(swapped)).toEqual(legacyFromVeteran(specialWeek()));
  });

  it('keeps a guest, unmatched grandparent: its character and sparks are used', () => {
    const v = specialWeek();
    const guest = v.parents.find((p) => p.slot === 2)!;
    expect(guest).toMatchObject({ isGuest: true, matchedVeteranId: null });
    expect(legacyFromVeteran(v).grandparents[1]?.characterId).toBe('character:gold-ship');
  });
});

describe('inheritanceExpectation with RosterVeterans (S1, B1)', () => {
  it('attributes self -> P, parent1 -> GPxa, parent2 -> GPxb', () => {
    const r = inheritanceExpectation(ctx, TRAINEE, [specialWeek(), suzuka()], URA);
    expect(r.contributions.map((x) => `${x.from}:${x.sparkId}`)).toEqual([
      'P1:spark:speed',
      'P1:spark:turf',
      'P1:spark:arima-kinen',
      'P2:spark:power',
      'P2:spark:medium',
      'GP1a:spark:stamina',
      'GP1a:spark:mile',
      'GP1b:spark:wit',
      'GP1b:spark:long',
      'GP2b:spark:guts',
      'GP2b:spark:dirt',
    ]);
    // Grandparent affinity uses the slot's character, including the guest.
    const labels = Object.fromEntries(r.affinity.breakdown.map((x) => [x.label, x.members]));
    expect(labels['T-P1-GP1a']).toEqual([
      'character:mejiro-mcqueen',
      'character:special-week',
      'character:tokai-teio',
    ]);
    expect(labels['T-P1-GP1b']).toEqual([
      'character:mejiro-mcqueen',
      'character:special-week',
      'character:gold-ship',
    ]);
  });

  it("published data, zero events: only the parents' initial blue bonus, attributed per spark", () => {
    const r = inheritanceExpectation(ctx, TRAINEE, [specialWeek(), suzuka()], URA);
    const bonus = master.rules.blueInitialBonus;
    // P1 speed 3★ and P2 power 1★ from the published table; grandparent blue sparks add nothing.
    expect(r.expectedStatGain).toEqual([bonus['3'], 0, bonus['1'], 0, 0]);
    expect(r.expectedStatGain).toEqual([21, 0, 5, 0, 0]);
    expectContributionsSumToExpected(r);
    expect(
      r.contributions.find((x) => x.from === 'GP1b' && x.type === 'blue')?.expectedEffect.stats,
    ).toEqual([0, 0, 0, 0, 0]);
    expect(r.events).toEqual([]);
    expect(r.provenance).toMatchObject({
      masterVersion: master.version,
      rulesVersion: 'rules-1',
      eventsKnown: false,
      validated: false,
    });
    expect(r.provenance.unverifiedRules).toHaveLength(12);
    expect(r.provenance.placeholderRules).toEqual(['blueStatGain', 'whiteHintLevels']);
    expect(r.provenance.warnings.some((w) => w.includes('has no inheritanceTurns'))).toBe(true);
    for (const apt of Object.values(r.aptitudeDist))
      expect(Object.values(apt).reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
    expect(r.skillHintProb).toEqual(
      Object.fromEntries(Object.keys(r.skillHintProb).map((k) => [k, 0])),
    );
  });

  it('published data + synthetic injected turns: race spark stats roll, sum invariant holds', () => {
    const synthetic = {
      ...master,
      scenarios: master.scenarios.map((s) =>
        s.id === URA ? { ...s, inheritanceTurns: [30, 54] } : s,
      ),
    };
    const ctx2 = loadContext(synthetic, master.rules);
    const r = inheritanceExpectation(ctx2, TRAINEE, [specialWeek(), suzuka()], URA);
    expect(r.provenance.eventsKnown).toBe(true);
    expect(r.provenance.validated).toBe(false); // rules are still unverified
    // Arima Kinen (race 1023 -> gut, rules perStar[1] = 6 at 2★): 2 events × p × 6 on guts.
    const arima = r.contributions.find((x) => x.sparkId === 'spark:arima-kinen')!;
    expect(arima.kind).toBe('white-race');
    expect(arima.p).toBeGreaterThan(0);
    expectVectorClose(arima.expectedEffect.stats, [0, 0, 0, 2 * arima.p * 6, 0]);
    expectVectorClose(r.expectedStatGain, [21, 0, 5, 2 * arima.p * 6, 0]);
    expectContributionsSumToExpected(r);
  });

  it('rejects the same veteran as both parents', () => {
    const v = specialWeek();
    expect(() => inheritanceExpectation(ctx, TRAINEE, [v, v], URA)).toThrow(IllegalPairError);
    try {
      inheritanceExpectation(ctx, TRAINEE, [v, v], URA);
    } catch (e) {
      expect((e as IllegalPairError).reasons).toEqual(['same-veteran', 'same-parent-character']);
    }
  });

  it("rejects a parent of the trainee's character in either slot", () => {
    const reasons = (pair: [RosterVeteran, RosterVeteran]) => {
      try {
        inheritanceExpectation(ctx, TRAINEE, pair, URA);
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(IllegalPairError);
        return (e as IllegalPairError).reasons;
      }
    };
    expect(reasons([mcqueenVeteran(), suzuka()])).toEqual(['parent1-is-trainee-character']);
    expect(reasons([suzuka(), mcqueenVeteran()])).toEqual(['parent2-is-trainee-character']);
    expect(reasons([specialWeek(), suzuka()])).toEqual([]);
  });

  it('equals planInheritance over legacyFromVeteran', () => {
    const pair: [RosterVeteran, RosterVeteran] = [specialWeek(), suzuka()];
    const viaPlan = expectationFromPlan(
      planInheritance(ctx, TRAINEE, [legacyFromVeteran(pair[0]), legacyFromVeteran(pair[1])], URA),
    );
    expect(inheritanceExpectation(ctx, TRAINEE, pair, URA)).toEqual(viaPlan);
  });
});
