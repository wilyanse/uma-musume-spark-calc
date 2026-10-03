/**
 * T06 review round 1 regressions:
 *
 * - B1 / Q-142: the trainee's OWN unique skill is never a fitted acquisition decision (ADR-0002 §3
 *   excludes it from the fit), so a target or explicit skill request naming it is rejected with a
 *   typed `ModelInputError` (code `own-unique-skill`) in prediction AND ranking, instead of a
 *   silent pHinted/acquire/pMeet 0. Another outfit's unique skill is not affected.
 * - S1: a schema-valid `training-v2` snapshot whose residualCov breaks the v2 contract (asymmetric,
 *   diagonal ≤ 0, a materially negative eigenvalue, sigma ≠ √diag) is `RefitRequiredError`
 *   `malformed` before any Gaussian or MC scoring, never silently symmetrised or clamped.
 * - S2: unknown requested/target skill ids, deck slots outside the shared `DeckSlot` contract
 *   (lb integer 0..4 …) and duplicate deck cards are rejected before feature computation.
 */
import { describe, expect, it } from 'vitest';
import { STAT_KEYS } from '@uma/schema';
import type { CmTarget, ModelSnapshot } from '@uma/schema';
import {
  eigenFactor,
  floorPsd,
  ModelInputError,
  predictChild,
  prepareModel,
  rankPairs,
  rankPairsDetailed,
  RefitRequiredError,
  UnknownIdError,
} from '../../src/index.ts';
import type { PlanInput } from '../../src/index.ts';
import {
  expectationFromPlan,
  legacyFromVeteran,
  planInheritance,
} from '../../src/inheritance/inheritance.ts';
import {
  gaussianScore,
  normalizeTarget,
  preparePlan,
  simulate,
  skillClosedForm,
} from '../../src/predict/index.ts';
import { byId, ctx, goldenFit, planInput, roster, target, truth } from '../model/golden-fit.ts';

const { snapshot } = goldenFit();
const best = truth.golden.bestPair.parents.map((id) => byId.get(id)!) as [
  (typeof roster)[number],
  (typeof roster)[number],
];
const outfit = ctx.outfits.get(planInput.traineeOutfitId)!;
const OWN_UNIQUE = outfit.uniqueSkillId;
const OTHER_UNIQUE = [...ctx.outfits.values()]
  .map((o) => o.uniqueSkillId)
  .find((s) => s !== OWN_UNIQUE && ctx.skills.get(s)?.rarity === 'unique')!;
const traineeChar = outfit.characterId;
const small = roster.filter((v) => v.characterId !== traineeChar).slice(0, 12);
const OPTS = { topK: 3, topN: 2, samples: 50 };
const bare = (extra: Partial<CmTarget> = {}): CmTarget => ({
  ...target,
  minStats: {},
  minAptitudes: {},
  requiredSkills: [],
  optionalSkills: [],
  ...extra,
});
const ownUnique = expect.objectContaining({ name: 'ModelInputError', code: 'own-unique-skill' });

describe("B1 / Q-142: the trainee's own unique skill is an unsupported request", () => {
  it('fixture sanity: the own unique skill exists in master data; another outfit has a different unique', () => {
    expect(ctx.skills.has(OWN_UNIQUE)).toBe(true);
    expect(OTHER_UNIQUE).toBeDefined();
    expect(OTHER_UNIQUE).not.toBe(OWN_UNIQUE);
  });

  const targets: [string, CmTarget][] = [
    ['required', bare({ requiredSkills: [OWN_UNIQUE] })],
    ['optional', bare({ optionalSkills: [{ skillId: OWN_UNIQUE, weight: 5 }] })],
  ];
  for (const [label, t] of targets) {
    it(`a ${label} own-unique target is rejected by predictChild and by every rankPairs path`, () => {
      expect(() =>
        predictChild(ctx, snapshot, planInput, best, { seed: 'b1', samples: 20, target: t }),
      ).toThrow(ownUnique);
      expect(() => rankPairs(ctx, snapshot, planInput, small, t, OPTS)).toThrow(ownUnique);
      // Empty roster and a lock with no legal partner must not silently return [] for it.
      expect(() => rankPairs(ctx, snapshot, planInput, [], t, OPTS)).toThrow(ownUnique);
      const lockedTrainee = roster.find((v) => v.characterId === traineeChar)!;
      expect(() =>
        rankPairs(
          ctx,
          snapshot,
          { ...planInput, lockParent1: lockedTrainee.id },
          [lockedTrainee],
          t,
          OPTS,
        ),
      ).toThrow(ownUnique);
      expect(() =>
        rankPairs(ctx, snapshot, { ...planInput, lockParent1: small[0]!.id }, small, t, OPTS),
      ).toThrow(ModelInputError);
    });
  }

  it('an explicit PredictOptions.skills request for it is rejected', () => {
    expect(() =>
      predictChild(ctx, snapshot, planInput, best, {
        seed: 'b1',
        samples: 20,
        skills: [OWN_UNIQUE],
      }),
    ).toThrow(ownUnique);
    expect(() =>
      predictChild(ctx, snapshot, planInput, best, {
        seed: 'b1',
        samples: 20,
        skills: [truth.golden.skillX, OWN_UNIQUE],
      }),
    ).toThrow(ownUnique);
  });

  it('the exported helpers never return a silent 0 for it', () => {
    const pc = preparePlan(ctx, prepareModel(ctx, snapshot), planInput);
    const plan = planInheritance(
      ctx,
      planInput.traineeOutfitId,
      [legacyFromVeteran(best[0]), legacyFromVeteran(best[1])],
      planInput.scenarioId,
    );
    const exp = expectationFromPlan(plan);
    expect(() => skillClosedForm(pc, exp, OWN_UNIQUE)).toThrow(ownUnique);
    expect(() => simulate(pc, plan, 10, 's', [OWN_UNIQUE])).toThrow(ownUnique);
    expect(() =>
      gaussianScore(pc, exp, normalizeTarget(bare({ requiredSkills: [OWN_UNIQUE] }))),
    ).toThrow(ownUnique);
  });

  it('default predictions and rankings still work and never select the own unique skill', () => {
    const p = predictChild(ctx, snapshot, planInput, best, { seed: 'b1', samples: 50 });
    expect(Object.keys(p.skills).length).toBeGreaterThan(0);
    expect(p.skills[OWN_UNIQUE]).toBeUndefined();
    const r = rankPairs(ctx, snapshot, planInput, small, target, OPTS);
    expect(r.length).toBe(2);
    for (const x of r) expect(x.prediction.skills[OWN_UNIQUE]).toBeUndefined();
  });

  it("another outfit's unique skill (e.g. an inherited unique hint) is NOT rejected for its rarity", () => {
    const t = bare({
      requiredSkills: [OTHER_UNIQUE],
      optionalSkills: [{ skillId: OTHER_UNIQUE, weight: 1 }],
    });
    const p = predictChild(ctx, snapshot, planInput, best, { seed: 'b1', samples: 50, target: t });
    expect(p.skills[OTHER_UNIQUE]).toBeDefined();
    expect(
      predictChild(ctx, snapshot, planInput, best, {
        seed: 'b1',
        samples: 20,
        skills: [OTHER_UNIQUE],
      }).skills[OTHER_UNIQUE],
    ).toBeDefined();
    expect(rankPairs(ctx, snapshot, planInput, small, t, OPTS)).toHaveLength(2);
  });
});

describe('S1: contract-invalid v2 residualCov is malformed before any scoring', () => {
  const malformed = expect.objectContaining({ name: 'RefitRequiredError', reason: 'malformed' });
  const mutate = (f: (s: ModelSnapshot) => void): ModelSnapshot => {
    const s = structuredClone(snapshot);
    f(s);
    return s;
  };
  const cases: [string, ModelSnapshot][] = [
    [
      'asymmetric off-diagonal',
      mutate((s) => {
        s.params.residualCov[0]![1] = s.params.residualCov[0]![1]! + 1e-3;
      }),
    ],
    [
      'negative diagonal',
      mutate((s) => {
        s.params.residualCov[0]![0] = -50;
      }),
    ],
    [
      'zero diagonal',
      mutate((s) => {
        s.params.residualCov[2]![2] = 0;
        s.params.perStat.pow.sigma = 0;
      }),
    ],
    [
      'materially negative eigenvalue (positive diagonal)',
      mutate((s) => {
        const c = s.params.residualCov;
        const v = 2 * Math.sqrt(c[0]![0]! * c[1]![1]!);
        c[0]![1] = v;
        c[1]![0] = v;
      }),
    ],
    [
      'sigma ≠ √diag',
      mutate((s) => {
        s.params.perStat.sta.sigma = s.params.perStat.sta.sigma * 1.01;
      }),
    ],
    [
      'non-finite sigma',
      mutate((s) => {
        s.params.perStat.wit.sigma = Number.NaN;
      }),
    ],
  ];
  for (const [label, bad] of cases) {
    it(`${label}: prepareModel, predictChild and rankPairs throw RefitRequiredError malformed`, () => {
      expect(() => prepareModel(ctx, bad)).toThrow(malformed);
      expect(() => predictChild(ctx, bad, planInput, best, { seed: 's1', samples: 20 })).toThrow(
        malformed,
      );
      expect(() => rankPairs(ctx, bad, planInput, small, target, OPTS)).toThrow(malformed);
      expect(() => rankPairsDetailed(ctx, bad, planInput, [], target, OPTS)).toThrow(
        RefitRequiredError,
      );
    });
  }

  it('the fitted snapshot (and its JSON round-trip) is accepted with the unchanged eigen factor', () => {
    const prepared = prepareModel(ctx, snapshot);
    expect(prepared.factor).toEqual(eigenFactor(snapshot.params.residualCov));
    const rt = JSON.parse(JSON.stringify(snapshot)) as ModelSnapshot;
    expect(prepareModel(ctx, rt).factor).toEqual(prepared.factor);
    const a = predictChild(ctx, snapshot, planInput, best, { seed: 'v', samples: 200, target });
    const b = predictChild(ctx, rt, planInput, best, { seed: 'v', samples: 200, target });
    expect(b).toEqual(a);
  });

  it('PSD-floored covariances (ε eigenvalues, rank-deficient raw input) are accepted unchanged', () => {
    // A rank-1 raw matrix floored at a tiny ε: eigenvalues ε, ε, ε, ε, big, so roundoff of the
    // smallest computed eigenvalues is relatively large. Every one must still be accepted.
    const u = [30, -12, 7, 0.5, 21];
    const rank1 = u.map((a) => u.map((b) => a * b));
    for (const [raw, eps] of [
      [rank1, 1e-6],
      [rank1, 1e-3],
      [rank1.map((r) => r.map(() => 0)), 1e-6],
      [snapshot.params.residualCov, 1e-6],
    ] as const) {
      const f = floorPsd(
        raw.map((r) => [...r]),
        eps,
      );
      const s = mutate((x) => {
        x.params.residualCov = f.sigma;
        STAT_KEYS.forEach((k, i) => {
          x.params.perStat[k].sigma = Math.sqrt(f.sigma[i]![i]!);
        });
      });
      const p = prepareModel(ctx, s);
      expect(p.factor).toEqual(eigenFactor(f.sigma));
      expect(() =>
        predictChild(ctx, s, planInput, best, { seed: 'psd', samples: 20, target }),
      ).not.toThrow();
    }
  });

  it('a last-ulp sigma difference (serialisation roundoff) is tolerated, a material one is not', () => {
    const ulp = mutate((s) => {
      s.params.perStat.spd.sigma = s.params.perStat.spd.sigma * (1 + 2 ** -52);
    });
    expect(() => prepareModel(ctx, ulp)).not.toThrow();
    const material = mutate((s) => {
      s.params.perStat.spd.sigma = s.params.perStat.spd.sigma * (1 + 1e-6);
    });
    expect(() => prepareModel(ctx, material)).toThrow(malformed);
  });
});

describe('S2: requested skill ids and the plan deck are validated before features', () => {
  const unknown = 'skill:does-not-exist';
  const deckWith = (i: number, patch: Record<string, unknown>): PlanInput => ({
    ...planInput,
    deck: planInput.deck.map((d, j) => (j === i ? { ...d, ...patch } : d)) as PlanInput['deck'],
  });

  it('unknown required / optional / explicit skill ids throw UnknownIdError in predict and rank', () => {
    for (const t of [
      bare({ requiredSkills: [unknown] }),
      bare({ optionalSkills: [{ skillId: unknown, weight: 1 }] }),
    ]) {
      expect(() =>
        predictChild(ctx, snapshot, planInput, best, { seed: 's2', samples: 20, target: t }),
      ).toThrow(UnknownIdError);
      expect(() => rankPairs(ctx, snapshot, planInput, small, t, OPTS)).toThrow(UnknownIdError);
      expect(() => rankPairs(ctx, snapshot, planInput, [], t, OPTS)).toThrow(UnknownIdError);
    }
    expect(() =>
      predictChild(ctx, snapshot, planInput, best, { seed: 's2', samples: 20, skills: [unknown] }),
    ).toThrow(UnknownIdError);
  });

  const badDecks: [string, PlanInput][] = [
    ['lb 9', deckWith(0, { lb: 9 })],
    ['lb -1', deckWith(0, { lb: -1 })],
    ['lb 2.5', deckWith(0, { lb: 2.5 })],
    ['lb NaN', deckWith(0, { lb: Number.NaN })],
    ['lb "4"', deckWith(0, { lb: '4' })],
    ['duplicate card id', deckWith(1, { cardId: planInput.deck[0]!.cardId })],
  ];
  for (const [label, input] of badDecks) {
    it(`${label}: predictChild and rankPairs throw ModelInputError`, () => {
      expect(() => predictChild(ctx, snapshot, input, best, { seed: 's2', samples: 20 })).toThrow(
        ModelInputError,
      );
      expect(() => rankPairs(ctx, snapshot, input, small, target, OPTS)).toThrow(ModelInputError);
      expect(() => rankPairs(ctx, snapshot, input, [], target, OPTS)).toThrow(ModelInputError);
    });
  }

  it('unknown deck card ids are typed errors in both paths', () => {
    const input = deckWith(0, { cardId: 'card:does-not-exist' });
    expect(() => predictChild(ctx, snapshot, input, best, { seed: 's2', samples: 20 })).toThrow(
      ModelInputError,
    );
    expect(() => rankPairs(ctx, snapshot, input, [], target, OPTS)).toThrow(ModelInputError);
  });

  it('valid inputs (every lb 0..4, known skills) still predict and rank', () => {
    for (const lb of [0, 1, 2, 3, 4]) {
      const p = predictChild(ctx, snapshot, deckWith(0, { lb }), best, { seed: 's2', samples: 20 });
      expect(p.trainingMean.every(Number.isFinite)).toBe(true);
    }
    const p = predictChild(ctx, snapshot, planInput, best, {
      seed: 's2',
      samples: 20,
      skills: [truth.golden.skillX],
      target,
    });
    expect(p.skills[truth.golden.skillX]).toBeDefined();
    expect(rankPairs(ctx, snapshot, planInput, small, target, OPTS)).toHaveLength(2);
  });
});
