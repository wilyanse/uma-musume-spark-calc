import { describe, expect, it } from 'vitest';
import { VeteranCapture, RULE, CAPTURE_RULES, checkMasterIds, Ulid } from '../src/index.ts';
import { baseCapture } from './fixtures.ts';

type Mutate = (c: ReturnType<typeof baseCapture>) => void;

const messages = (c: unknown): string[] => {
  const r = VeteranCapture.safeParse(c);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};
const fails = (mutate: Mutate, fragment: string) => {
  const c = baseCapture();
  mutate(c);
  expect(messages(c).join('\n')).toContain(fragment);
};
const passes = (mutate: Mutate) => {
  const c = baseCapture();
  mutate(c);
  expect(messages(c)).toEqual([]);
};

const lowConfSparksField = (): ReturnType<typeof baseCapture>['fields'][number] => ({
  path: '/sparks/parent2',
  rawText: null,
  value: null,
  confidence: 0.2,
  status: 'low_confidence',
  candidates: [],
  cropKey: null,
});
const dropOwner = (c: ReturnType<typeof baseCapture>, owner: string) => {
  c.veteran.sparks = c.veteran.sparks.filter((s) => s.owner !== owner);
};

describe('01 §3 validation: stats', () => {
  it('accepts stats at 1 and 2000', () =>
    passes((c) => {
      c.veteran.stats.spd = 1;
      c.veteran.stats.wit = 2000;
    }));
  it('rejects 0', () => fails((c) => (c.veteran.stats.spd = 0), '>=1'));
  it('rejects 2001', () => fails((c) => (c.veteran.stats.sta = 2001), '<=2000'));
  it('rejects non-integers', () => fails((c) => (c.veteran.stats.pow = 500.5), 'expected int'));
});

describe('01 §3 validation: exact counts', () => {
  it('accepts 10 aptitudes, 6 deck slots, 2 parents (baseline)', () => passes(() => {}));
  it('rejects a missing aptitude', () => {
    const c = baseCapture();
    delete (c.veteran.aptitudes as Partial<typeof c.veteran.aptitudes>).end;
    const r = VeteranCapture.safeParse(c);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain('veteran.aptitudes.end');
  });
  it('rejects an extra aptitude key', () =>
    fails((c) => {
      (c.veteran.aptitudes as Record<string, string>).extra = 'A';
    }, 'Unrecognized'));
  it('rejects an invalid grade', () =>
    fails((c) => ((c.veteran.aptitudes as Record<string, string>).turf = 'SS'), 'Invalid'));
  it('rejects 5 deck slots', () => fails((c) => c.veteran.deck.pop(), 'exactly 6'));
  it('rejects 7 deck slots', () =>
    fails((c) => c.veteran.deck.push({ ...c.veteran.deck[0]!, slot: 6 }), 'exactly 6'));
  it('rejects duplicate deck slot numbers', () =>
    fails((c) => (c.veteran.deck[5]!.slot = 1), RULE.deckSlots));
  it('rejects LB 5', () => fails((c) => (c.veteran.deck[0]!.lb = 5), '<=4'));
  it('rejects 1 parent', () => fails((c) => c.veteran.parents.pop(), 'exactly 2'));
  it('rejects 3 parents', () =>
    fails(
      (c) => c.veteran.parents.push({ ...c.veteran.parents[0]!, characterId: 'character:x' }),
      'exactly 2',
    ));
  it('rejects duplicate parent slots', () =>
    fails((c) => (c.veteran.parents[1]!.slot = 1), RULE.parentSlots));
});

describe('01 §3 validation: self sparks', () => {
  it('accepts one blue + one pink + one green + many whites', () =>
    passes((c) => {
      c.veteran.sparks.push(
        { owner: 'self', sparkId: 'spark:g1', type: 'green', stars: 1 },
        { owner: 'self', sparkId: 'spark:w1', type: 'white', stars: 1 },
        { owner: 'self', sparkId: 'spark:w2', type: 'white', stars: 3 },
        { owner: 'self', sparkId: 'spark:w3', type: 'white', stars: 2 },
      );
    }));
  it('rejects two blues', () =>
    fails(
      (c) => c.veteran.sparks.push({ owner: 'self', sparkId: 'spark:b2', type: 'blue', stars: 1 }),
      'owner self',
    ));
  it('rejects no pink', () =>
    fails((c) => {
      c.veteran.sparks = c.veteran.sparks.filter((s) => !(s.owner === 'self' && s.type === 'pink'));
    }, 'owner self'));
  it('rejects two greens', () =>
    fails((c) => {
      c.veteran.sparks.push(
        { owner: 'self', sparkId: 'spark:g1', type: 'green', stars: 1 },
        { owner: 'self', sparkId: 'spark:g2', type: 'green', stars: 1 },
      );
    }, 'owner self'));
  it('rejects a capture with no self sparks at all', () =>
    fails((c) => dropOwner(c, 'self'), RULE.selfSparks));
  it('rejects the same spark twice for one owner', () =>
    fails(
      (c) =>
        c.veteran.sparks.push(
          { owner: 'self', sparkId: 'spark:w1', type: 'white', stars: 1 },
          { owner: 'self', sparkId: 'spark:w1', type: 'white', stars: 2 },
        ),
      RULE.sparkDuplicate,
    ));
  it('rejects stars outside 1..3', () =>
    fails((c) => ((c.veteran.sparks[0] as { stars: number }).stars = 4), 'Invalid'));
});

describe('01 §3 validation: parent sparks', () => {
  it('accepts the same shape for parent owners with a white', () =>
    passes((c) =>
      c.veteran.sparks.push({ owner: 'parent1', sparkId: 'spark:w1', type: 'white', stars: 2 }),
    ));
  it('rejects a parent owner with two pinks', () =>
    fails(
      (c) =>
        c.veteran.sparks.push({ owner: 'parent2', sparkId: 'spark:p2', type: 'pink', stars: 1 }),
      'owner parent2',
    ));
  it('rejects a parent owner with only a blue', () =>
    fails((c) => {
      c.veteran.sparks = c.veteran.sparks.filter(
        (s) => !(s.owner === 'parent1' && s.type === 'pink'),
      );
    }, 'owner parent1'));
  it('accepts a parent owner with no sparks when a low_confidence /sparks/parent2 field exists', () =>
    passes((c) => {
      dropOwner(c, 'parent2');
      c.fields.push(lowConfSparksField());
    }));
  it('rejects a parent owner with no sparks and no low_confidence flag', () =>
    fails((c) => dropOwner(c, 'parent2'), RULE.parentSparksUnreadable));
  it('rejects a low_confidence flag for a different owner or path', () => {
    for (const path of [
      '/sparks/parent1',
      '/sparks/0/stars',
      '/sparks',
      '/sparksX',
      '/sparks/self',
    ])
      fails((c) => {
        dropOwner(c, 'parent2');
        c.fields.push({ ...lowConfSparksField(), path });
      }, RULE.parentSparksUnreadable);
  });
  it('rejects the flag being merely status ok', () =>
    fails((c) => {
      dropOwner(c, 'parent2');
      c.fields.push({ ...lowConfSparksField(), status: 'ok' });
    }, RULE.parentSparksUnreadable));
});

describe('01 §3 validation: parents', () => {
  it('accepts a guest parent with null outfit', () =>
    passes((c) => {
      Object.assign(c.veteran.parents[1]!, {
        characterId: 'character:guest-example',
        outfitId: null,
        isGuest: true,
        guestTrainer: 'Some Trainer',
      });
    }));
  it('rejects a non-guest parent with a null outfit', () =>
    fails((c) => (c.veteran.parents[0]!.outfitId = null), RULE.guestShape));
  it('rejects a guest parent without a guestTrainer', () =>
    fails((c) => {
      c.veteran.parents[1]!.isGuest = true;
    }, RULE.guestShape));
  it('rejects identical parents', () =>
    fails(
      (c) => (c.veteran.parents[1]!.characterId = c.veteran.parents[0]!.characterId),
      RULE.parentsDiffer,
    ));
  it('rejects a parent equal to the veteran', () =>
    fails((c) => (c.veteran.parents[0]!.characterId = c.veteran.characterId), RULE.parentNotSelf));
  it('rejects the second parent equal to the veteran', () =>
    fails((c) => (c.veteran.parents[1]!.characterId = c.veteran.characterId), RULE.parentNotSelf));
});

describe('01 §3 validation: IDs and shape', () => {
  it('accepts kebab master IDs', () => passes(() => {}));
  it('rejects a malformed master ID', () =>
    fails((c) => (c.veteran.characterId = 'Mejiro McQueen'), 'character:<slug>'));
  it('rejects an ID of the wrong kind', () =>
    fails((c) => (c.veteran.scenarioId = 'skill:oops'), 'scenario:<slug>'));
  it('rejects a non-ULID captureId', () => fails((c) => (c.captureId = 'abc'), 'ULID'));
  it('rejects a non-UTC timestamp', () =>
    fails((c) => (c.capturedAt = '2026-09-29T08:00:00+08:00'), 'datetime'));
  it('rejects a bad dateAcquired', () =>
    fails((c) => (c.veteran.career.dateAcquired = '29/09/2026'), 'date'));
  it('rejects schemaVersion 2', () =>
    fails((c) => ((c as { schemaVersion: number }).schemaVersion = 2), '1'));
  it('rejects an uppercase fingerprint', () =>
    fails((c) => (c.fingerprint = c.fingerprint.toUpperCase()), 'sha256'));
  it('rejects unknown keys', () =>
    fails((c) => ((c.veteran as Record<string, unknown>).extra = 1), 'Unrecognized'));
  it('accepts skill levels null and numeric', () =>
    passes((c) => c.veteran.skills.push({ skillId: 'skill:unique-example', level: 3 })));
});

describe('CaptureField', () => {
  it('accepts confidence 0 and 1', () =>
    passes((c) => {
      c.fields[0]!.confidence = 0;
      c.fields.push({ ...c.fields[0]!, path: '/stats/sta', confidence: 1 });
    }));
  it('rejects confidence > 1', () => fails((c) => (c.fields[0]!.confidence = 1.1), '<=1'));
  it('rejects an unknown status', () =>
    fails((c) => ((c.fields[0] as { status: string }).status = 'bad'), 'Invalid'));
  it('rejects more than 3 candidates', () =>
    fails((c) => {
      c.fields[0]!.candidates = Array.from({ length: 4 }, (_, i) => ({ value: i, score: 0.1 }));
    }, '<=3'));
  it('rejects a path that is not a JSON pointer', () =>
    fails((c) => (c.fields[0]!.path = 'stats.spd'), 'JSON pointer'));
});

describe('strict ULID', () => {
  it('rejects a first character above 7 (128-bit overflow)', () => {
    expect(Ulid.safeParse('81J8Z3K4M5N6P7Q8R9S0T1V2W3').success).toBe(false);
    expect(Ulid.safeParse('01J8Z3K4M5N6P7Q8R9S0T1V2W3').success).toBe(true);
    expect(Ulid.safeParse('7ZZZZZZZZZZZZZZZZZZZZZZZZZ').success).toBe(true);
  });
});

describe('checkMasterIds (01 §3, needs master data)', () => {
  const index = () => {
    const v = baseCapture().veteran;
    return {
      characters: [v.characterId, ...v.parents.map((p) => p.characterId)],
      outfits: [v.outfitId, ...v.parents.flatMap((p) => (p.outfitId ? [p.outfitId] : []))],
      skills: v.skills.map((s) => s.skillId),
      sparks: v.sparks.map((s) => s.sparkId),
      cards: v.deck.map((d) => d.cardId),
      scenarios: [v.scenarioId],
    };
  };
  it('returns [] when every ID is known', () =>
    expect(checkMasterIds(baseCapture().veteran, index())).toEqual([]));
  it('lists every unknown ID once, in first-seen order', () => {
    const idx = index();
    idx.sparks = idx.sparks.filter((s) => s !== 'spark:speed' && s !== 'spark:pace');
    idx.cards = [];
    idx.scenarios = [];
    idx.characters = idx.characters.filter((c) => c !== 'character:silence-suzuka');
    expect(checkMasterIds(baseCapture().veteran, idx)).toEqual([
      'spark:speed',
      'spark:pace',
      'card:example-card',
      'character:silence-suzuka',
      'scenario:ura-finale',
    ]);
  });
  it('ignores a null guest outfit', () => {
    const v = baseCapture().veteran;
    Object.assign(v.parents[1]!, { outfitId: null, isGuest: true, guestTrainer: 'x' });
    expect(checkMasterIds(v, index())).toEqual([]);
  });
});

describe('CAPTURE_RULES (for T09 to mirror)', () => {
  it('lists each rule once with a message and path', () => {
    const ids = CAPTURE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'deckSlots',
      'parentSlots',
      'parentsDiffer',
      'parentNotSelf',
      'guestShape',
      'sparkDuplicate',
      'sparkShape',
      'selfSparks',
      'parentSparksUnreadable',
      'masterIds',
    ]);
    for (const r of CAPTURE_RULES) expect(r.message.length).toBeGreaterThan(10);
    for (const key of Object.keys(RULE)) expect(ids).toContain(key);
  });
});
