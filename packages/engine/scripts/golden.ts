/**
 * T08 golden dataset generator (70 §2, 50 §9). Run with plain node (erasable TypeScript only):
 *   pnpm --filter @uma/engine golden        # = node scripts/golden.ts
 *
 * Writes, deterministically (seed 20260929, injected time, sorted keys, prettier-formatted JSON):
 *   packages/engine/test/golden/roster.json                     RosterVeteran[] (260)
 *   packages/engine/test/golden/roster.calibration-x1.3.json    same roster, blueStatGain × 1.3
 *   packages/engine/test/golden/truth.json                      every planted parameter
 *   packages/engine/test/golden/targets.json                    CmTarget[] (golden-cm-1)
 *   apps/web/fixtures/{roster,cm-targets,golden-truth}.json      byte-identical copies, named for the
 *                                                                web fixture-mode URL mapping
 *                                                                (/api/v1/<x> -> /fixtures/<x>.json)
 *
 * Everything here is SYNTHETIC. Only the master-data IDs (characters, outfits, skills, sparks,
 * cards, scenarios, ranks, epithets) are real, read read-only from the published bundle. The
 * training model, card effects, noise, skill rates, inheritance turns and blueStatGain are planted
 * values chosen for testability, never game facts. Inheritance itself is not re-implemented: it
 * goes through T05's public API (`loadContext` + `planInheritance` + `sampleInheritance`).
 *
 * Design rule: the generator first builds the `truth` parameters, then generates the roster only
 * from `truth` + the seed. `loadGoldenContext(master, truth, multiplier)` (in the browser-safe
 * `golden-context.ts`, together with the `GoldenTruth` types) is the single place the engine
 * context is built, so consumers (T06/T15 tests, a T13 fixture planner) rebuild exactly the same
 * context from truth.json without importing this Node-only file.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { APT_KEYS, CmTarget, fingerprint, GRADES, RosterVeteran, STAT_KEYS } from '@uma/schema';
import type { AptKey, Grade, Outfit, Spark, StatKey, SupportCard, TrainMode } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import {
  affinity2,
  mulberry32,
  planInheritance,
  sampleInheritance,
  seedFromString,
} from '../src/index.ts';
import type { Legacy, Rng, SparkRef, Stars } from '../src/index.ts';
import { loadGoldenContext } from './golden-context.ts';
import type { GoldenLatent, GoldenTruth, PlantedCard } from './golden-context.ts';
import { loadPublishedBundle } from './published-bundle.ts';
import {
  buildDesign,
  chooseLambda,
  effectiveSampleSize,
  holdoutCoverage,
  recencyWeights,
} from '../test/golden/t06-diagnostic.ts';

export { loadGoldenContext } from './golden-context.ts';
export type { GoldenTruth, PlantedCard } from './golden-context.ts';

// ---------------------------------------------------------------------------------------------
// Fixed inputs (seed, injected time, sizes)
// ---------------------------------------------------------------------------------------------

export const GOLDEN_SEED = 20260929;
/** Injected "now": every timestamp in the dataset is before this. No Date.now() anywhere. */
export const GOLDEN_NOW = '2026-09-29T00:00:00.000Z';
export const ROSTER_SIZE = 260;
export const CALIBRATION_MULTIPLIER = 1.3;
export const HOLDOUT_SEED = 20260930;
export const HOLDOUT_FRACTION = 0.2;
export const INDEPENDENT_SHARE = 0.6;
/** Planted cards per generated deck (uniform integer), the rest zero-effect cards. */
export const DECK_PLANTED_MIN = 2;
export const DECK_PLANTED_MAX = 5;

const ENGINE_DIR = join(import.meta.dirname, '..');
export const GOLDEN_DIR = join(ENGINE_DIR, 'test/golden');
export const WEB_FIXTURE_DIR = join(ENGINE_DIR, '../../apps/web/fixtures');

/** Output file names (relative to GOLDEN_DIR). */
export const FILES = {
  roster: 'roster.json',
  calibration: 'roster.calibration-x1.3.json',
  truth: 'truth.json',
  targets: 'targets.json',
} as const;
/**
 * Golden file -> apps/web/fixtures/ copy name. The web client maps `/api/v1/<x>` to
 * `/fixtures/<x>.json` (apps/web/src/api/client.ts), so the roster is `roster.json` and the CM
 * targets list is `cm-targets.json`. Copies, not symlinks (byte-identical, checked by tests).
 */
export const FIXTURE_FILES: Readonly<Record<string, string>> = {
  [FILES.roster]: 'roster.json',
  [FILES.targets]: 'cm-targets.json',
  [FILES.truth]: 'golden-truth.json',
};

// Planted choices that are master-data IDs (validated against the bundle at generation time).
const SKILL_X = 'skill:restraint';
const TRAINEE_OUTFIT = 'outfit:stone-piercing-blue'; // Grass Wonder: turf A, medium B, pace A
const PLAN_SCENARIO = 'scenario:ura-finale';
const PLAN_MODE: TrainMode = 'manual';
const TARGET_ID = '01KGQZ0000G01DENCM00000001'; // CmTarget.id must be a ULID; name = golden-cm-1
const INDEPENDENT_EPITHET = 'Independent Learner';

const STAT_ORDER = STAT_KEYS;
type Vec5 = [number, number, number, number, number];
const vec = (o: Record<StatKey, number>): Vec5 => STAT_ORDER.map((k) => o[k]) as Vec5;
const obj = (v: readonly number[]): Record<StatKey, number> =>
  Object.fromEntries(STAT_ORDER.map((k, i) => [k, v[i] ?? 0])) as Record<StatKey, number>;

// ---------------------------------------------------------------------------------------------
// Truth: the planted parameters
// ---------------------------------------------------------------------------------------------

/**
 * The planted card effects (LB4 values). Index = position in the sorted SSR list of that type
 * (gameId ascending, excluding the plan trainee's own character). Review round 1 (B1): raised so
 * the smallest planted coefficient is 40 per unit (80 at LB4); with the 90-day date span, the
 * LB timeline below and the noise sd, a 50 §4 fit (train split, E[inheritance] from the recorded
 * lineage, recency weights, id + type pooling, ridge) recovers every effect with margin.
 */
const PLANTED_EFFECTS: { type: SupportCard['type']; atLb4: Partial<Record<StatKey, number>> }[] = [
  { type: 'speed', atLb4: { spd: 110, pow: 80 } },
  { type: 'speed', atLb4: { spd: 96 } },
  { type: 'speed', atLb4: { spd: 90, wit: 80 } },
  { type: 'stamina', atLb4: { sta: 100, gut: 80 } },
  { type: 'stamina', atLb4: { sta: 90 } },
  { type: 'power', atLb4: { pow: 100, sta: 80 } },
  { type: 'power', atLb4: { pow: 90 } },
  { type: 'guts', atLb4: { gut: 96, pow: 80 } },
  { type: 'guts', atLb4: { gut: 90 } },
  { type: 'wit', atLb4: { wit: 96, spd: 80 } },
  { type: 'wit', atLb4: { wit: 90 } },
  { type: 'friend', atLb4: { spd: 80, sta: 80, pow: 80, gut: 80, wit: 80 } },
];
/** Zero-effect pool cards per type (taken after the planted ones in the same sorted list). */
const ZERO_PER_TYPE: Partial<Record<SupportCard['type'], number>> = {
  speed: 2,
  stamina: 2,
  power: 2,
  guts: 2,
  wit: 2,
  friend: 2,
  group: 2,
};

const NOISE_SD: Vec5 = [10, 9, 10, 9, 9];
/** dateAcquired span in days (B1: a 60-day recency half-life over 90 days keeps ESS ≈ 176/192). */
const DATE0 = '2026-06-25';
const SPAN = 90;
const NOISE_CORR: number[][] = [
  [1, 0.2, 0.3, 0.1, 0.1],
  [0.2, 1, 0.1, 0.25, 0],
  [0.3, 0.1, 1, 0.15, 0.05],
  [0.1, 0.25, 0.15, 1, 0.1],
  [0.1, 0, 0.05, 0.1, 1],
];

function selectPool(master: MasterBundle, traineeCharacterId: string) {
  const byType = new Map<string, SupportCard[]>();
  for (const c of master.cards) {
    if (c.rarity !== 'SSR' || c.characterId === traineeCharacterId) continue;
    const list = byType.get(c.type) ?? [];
    list.push(c);
    byType.set(c.type, list);
  }
  for (const list of byType.values()) list.sort((a, b) => (a.gameId ?? 0) - (b.gameId ?? 0));
  const used = new Map<string, number>();
  const planted: PlantedCard[] = [];
  for (const p of PLANTED_EFFECTS) {
    const i = used.get(p.type) ?? 0;
    used.set(p.type, i + 1);
    const card = byType.get(p.type)?.[i];
    if (!card) throw new Error(`golden: not enough SSR ${p.type} cards`);
    const atLb4 = obj(STAT_ORDER.map((k) => p.atLb4[k] ?? 0));
    planted.push({
      cardId: card.id,
      type: card.type,
      atLb4,
      perUnit: obj(STAT_ORDER.map((k) => (p.atLb4[k] ?? 0) / 2)),
    });
  }
  const zero: string[] = [];
  for (const [type, n] of Object.entries(ZERO_PER_TYPE)) {
    const start = used.get(type) ?? 0;
    const list = byType.get(type) ?? [];
    for (let i = start; i < start + (n ?? 0); i++) {
      const card = list[i];
      if (!card) throw new Error(`golden: not enough SSR ${type} cards`);
      zero.push(card.id);
    }
  }
  return { planted, zero };
}

/** Synthetic per-skill acquisition rate, rounded to 3 decimals, never exactly 0 or 1. */
function betaDraw(rng: Rng, a: number, b: number): number {
  const x = gammaDraw(rng, a);
  const y = gammaDraw(rng, b);
  return Math.min(0.98, Math.max(0.02, Math.round((x / (x + y)) * 1000) / 1000));
}

function normal(rng: Rng): number {
  // Box–Muller; 1 - u keeps log away from 0.
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gammaDraw(rng: Rng, shape: number): number {
  // Marsaglia–Tsang (shape >= 1 here).
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Lower Cholesky factor; throws if the matrix is not positive definite. */
export function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const l = a.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        if (s <= 0) throw new Error('golden: noise covariance is not positive definite');
        l[i]![i] = Math.sqrt(s);
      } else l[i]![j] = s / l[j]![j]!;
    }
  }
  return l;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The parameter part of truth.json, fixed before any veteran is generated. */
export type TruthParams = Pick<GoldenTruth, 'meta' | 'syntheticInheritance' | 'skills'> & {
  trainingModel: Omit<GoldenTruth['trainingModel'], 'clipping'>;
  golden: Pick<
    GoldenTruth['golden'],
    'skillX' | 'traineeOutfitId' | 'traineeCharacterId' | 'scenarioId' | 'trainMode'
  >;
};

export function buildTruthParameters(master: MasterBundle): TruthParams {
  const trainee = master.outfits.find((o) => o.id === TRAINEE_OUTFIT);
  if (!trainee) throw new Error(`golden: ${TRAINEE_OUTFIT} missing from master`);
  const { planted, zero } = selectPool(master, trainee.characterId);
  const covariance = NOISE_CORR.map((row, i) =>
    row.map((c, j) => r6(c * NOISE_SD[i]! * NOISE_SD[j]!)),
  );
  cholesky(covariance);

  // Skill acquisition rates: a Beta prior per mode, one draw per skill (all master skills).
  const priors: Record<TrainMode, { a: number; b: number }> = {
    independent: { a: 3, b: 7 },
    manual: { a: 5, b: 5 },
  };
  const rates: Record<TrainMode, Record<string, number>> = { independent: {}, manual: {} };
  const skillIds = master.skills.map((s) => s.id).sort();
  for (const mode of ['independent', 'manual'] as const) {
    const rng = mulberry32(seedFromString(`${GOLDEN_SEED}:skill-rates:${mode}`));
    for (const id of skillIds) rates[mode][id] = betaDraw(rng, priors[mode].a, priors[mode].b);
  }
  // Skill X has explicit rates so the planted pair's requirement is not left to a draw.
  rates.independent[SKILL_X] = 0.4;
  rates.manual[SKILL_X] = 0.75;

  const turnsNote =
    'SYNTHETIC (T08): published Global inheritanceTurns are [] (Q-5). Two events are injected for the golden data only; ' +
    'the count follows the GameTora note "years 2 and 3", the turn numbers themselves are arbitrary labels. Not a game fact.';
  const inheritanceTurns: GoldenTruth['syntheticInheritance']['inheritanceTurns'] = {};
  for (const s of [...master.scenarios].sort((a, b) => a.id.localeCompare(b.id))) {
    inheritanceTurns[s.id] = { turns: [31, 55], synthetic: true, note: turnsNote };
  }

  return {
    meta: {
      dataset: 'golden-1',
      synthetic: true,
      notice:
        'Synthetic dataset for engine tests (70 §2). Only master-data IDs are real; every planted value below is invented for testability and is not a game fact.',
      seed: GOLDEN_SEED,
      generatedAt: GOLDEN_NOW,
      generator: 'packages/engine/scripts/golden.ts',
      command: 'pnpm --filter @uma/engine golden',
      masterVersion: master.version,
      rulesVersion: master.rules.version,
      rosterSize: ROSTER_SIZE,
    },
    syntheticInheritance: {
      note: 'Inheritance is generated with T05 planInheritance/sampleInheritance on a context built by loadGoldenContext(master, truth, multiplier): rules.json values verbatim except the overrides below, plus a scenario plugin that returns the synthetic turns.',
      inheritanceTurns,
      rulesOverrides: {
        blueStatGain: {
          '1': 10,
          '2': 20,
          '3': 30,
          verified: false,
          source:
            'SYNTHETIC (T08 golden dataset): rules.json blueStatGain is an UNKNOWN 0 placeholder (Q-3), which would make the ×1.3 calibration variant identical to the base. These per-activation gains are invented; see Q-120.',
        },
      },
      rulesUsedVerbatim: [
        'activation.blue',
        'activation.pink',
        'activation.green',
        'activation.white',
        'affinityMultiplier',
        'grandparentWeight',
        'blueInitialBonus',
        'pinkGradeGain',
        'whiteHintLevels',
        'raceSparkStatGain',
        'scenarioSparkEffects',
      ],
      blueStatGainMultiplier: 1,
      guestsHaveNoLineage:
        'Guest parents and unread/unmatched parents contribute their own recorded sparks only; synthetic guests have no parents of their own, so their grandparent slots are null (no sparks roll). Matched parents contribute their own sparks plus their recorded parents as grandparents.',
    },
    trainingModel: {
      formula:
        'stat_k = round(clip(baseline_k + modeIntercept[mode]_k + scenarioIntercept[scenario]_k + growthCoefficient_k * growth%_k(outfit, own stat k only) + Σ_deck perUnit[card]_k * (1 + lb/4) + noise_k + inheritanceSample_k, 1, statCap[scenario]))',
      baseline: obj([618, 452, 590, 300, 448]),
      modeIntercept: {
        independent: obj([-30, -20, -30, -15, -25]),
        manual: obj([0, 0, 0, 0, 0]),
      },
      modeInterceptTotal: { independent: -120, manual: 0 },
      scenarioIntercept: {
        'scenario:brighter-together-our-grand-concert': obj([10, 20, 5, 25, 10]),
        'scenario:trackblazer': obj([25, 15, 15, 10, 5]),
        'scenario:unity-cup': obj([15, 0, 20, 0, 15]),
        'scenario:ura-finale': obj([0, 0, 0, 0, 0]),
      },
      growthCoefficient: obj([4, 4, 4, 4, 4]),
      growthNote:
        "Each stat depends only on the outfit's growth % for that same stat (cross-stat growth coefficients are 0).",
      cardFeature:
        "Per deck slot: perUnit[card] * (1 + lb/4), summed over the 6 slots (50 §4 'indicator × (1 + lb/4)'). Card level has no effect. Borrowed cards count like owned ones.",
      plantedCards: planted,
      zeroEffectCards: zero,
      residualNoise: {
        distribution: 'MVN(0, covariance), one independent draw per veteran',
        sd: obj(NOISE_SD),
        correlation: NOISE_CORR,
        covariance,
        order: STAT_ORDER,
      },
      rounding:
        'The sum is clipped to [1, statCap[scenarioId]] (master scenarios.json statCap) and rounded to the nearest integer (round-half-up on the clipped value).',
      statCap: Object.fromEntries(
        [...master.scenarios]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((s) => [s.id, s.statCap]),
      ),
      timeTrend:
        'None: no planted drift over dateAcquired (recency weights must not change the truth).',
      cardEffectEstimand:
        'Q-122. 50 §4 pools each card by id AND by type: the type feature is the sum of the id features of that type, so β_id[card] and β_type[type] are not separately identified (only their split is set by the ridge penalties). The identified, comparable quantity is the effective contribution per unit of (1 + lb/4): β_id[card] + β_type[type(card)]. "Recovers the planted card effects within ±15%" is read as: for every planted card and every stat with perUnit ≠ 0, |(β_id + β_type) − perUnit| / perUnit < 0.15. The planted generator has no type effect (every non-planted card is 0), so perUnit is also the true effective contribution. No oracle adjustment is applied.',
      synthetic: {
        effects:
          'Review round 1 (B1): per-unit effects raised to ≥ 40 (≥ 80 at LB4) from ≥ 20; baseline lowered so the totals stay in a similar range. Synthetic.',
        dates:
          'dateAcquired spans 90 days (was 360) so the 60-day recency half-life keeps an effective sample of ≈ 176 of the 192 train rows. Synthetic.',
        ownedLb:
          'every pool card starts at LB0 or LB1 and reaches LB4 within the 90 days (was: 0–2 start, 0..(4−start) upgrades over 360 days), so (1 + lb/4) varies within each card id and separates id effects from the pooled type and intercept directions. Synthetic.',
        pool: 'friend and group types each have 2 zero-effect cards (was 1), so no type-pool feature equals a single card id (Tazuna is still the only planted friend card). Synthetic.',
        noise: 'residual noise sd [10, 9, 10, 9, 9] (was [9, 8, 9, 7, 8]). Synthetic.',
      },
    },
    skills: {
      hintedDefinition:
        "LATENT (generator) definition: hinted = deck cards' hintSkillIds ∪ eventSkillIds ∪ the outfit's innateSkillIds ∪ skills hinted by the sparks that actually activated in the veteran's own inheritance sample (green/white skill sparks and race sparks with hint skills). The activation outcome is not observable in the roster.",
      acquisition:
        "Each hinted skill (except the outfit's unique skill) is acquired independently with probability rates[trainMode][skillId]. Nothing that was not hinted is ever acquired.",
      observableEstimand:
        "S2. `rates[mode][skill]` is the CONDITIONAL rate P(acquired | the skill was actually hinted). 50 §4 makes T06 call a skill hinted when it is in the deck hints/events, innate, or in any parent/grandparent white/green spark (observable), regardless of whether that spark activated. For a (veteran, skill) whose only possible source is the lineage, the observable acquisition probability is rates[mode][skill] × P(some lineage spark hinting it activated) = rates × skillHintProb (T05 closed form on the recorded lineage), which is strictly below rates. T06's per-mode Beta posterior means therefore estimate a mixture of rates (deck/innate-hinted rows) and rates × skillHintProb (lineage-only rows); they must NOT be compared with `rates` directly. Compare instead with the expected acquisitions Σ rates × P(hinted | observable lineage), as planted.test.ts does.",
      priors,
      rates,
      uniqueSkill:
        "The outfit's uniqueSkillId is always acquired, with a synthetic level uniform in 1..6.",
    },
    golden: {
      skillX: SKILL_X,
      traineeOutfitId: TRAINEE_OUTFIT,
      traineeCharacterId: trainee.characterId,
      scenarioId: PLAN_SCENARIO,
      trainMode: PLAN_MODE,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------------------------

const rngFor = (label: string): Rng => mulberry32(seedFromString(`${GOLDEN_SEED}:${label}`));
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
function pick<T>(rng: Rng, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error('golden: pick from empty list');
  return xs[Math.floor(rng() * xs.length)] as T;
}
function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let u = rng() * total;
  for (const [x, w] of items) {
    u -= w;
    if (u < 0) return x;
  }
  return items[items.length - 1]![0];
}
function shuffle<T>(rng: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}
const stars = (rng: Rng, w: [number, number, number] = [0.5, 0.35, 0.15]): Stars =>
  weighted(rng, [
    [1, w[0]],
    [2, w[1]],
    [3, w[2]],
  ] as const);

/** General (non-planted) blue sparks are 1★ or 2★ only, so the trap pair is the unique max. */
const GENERAL_BLUE_STARS: [number, number, number] = [0.55, 0.45, 0];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** ULID from an ISO time (48-bit ms) and 80 seeded random bits. */
function ulid(iso: string, rng: Rng): string {
  let t = Date.parse(iso);
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[Math.floor(rng() * 32)];
  return time + rand;
}

const DAY = 86_400_000;
const addDays = (date: string, d: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + d * DAY).toISOString().slice(0, 10);

/** Synthetic level cap per rarity and LB (unverified; card level has no planted effect). */
const LEVEL_CAP: Record<string, number[]> = {
  SSR: [30, 35, 40, 45, 50],
  SR: [25, 30, 35, 40, 45],
  R: [20, 25, 30, 35, 40],
};

// ---------------------------------------------------------------------------------------------
// Roster generation
// ---------------------------------------------------------------------------------------------

type Role = 'general' | 'best1' | 'best2' | 'trap1' | 'trap2';
const SPECIAL_INDEX: Partial<Record<number, Role>> = {
  140: 'trap1',
  170: 'best2',
  205: 'best1',
  230: 'trap2',
};

interface TrueVet {
  index: number;
  role: Role;
  id: string;
  characterId: string;
  outfit: Outfit;
  self: SparkRef[];
  parentSparks: [SparkRef[], SparkRef[]];
  parentChars: [string, string];
  /** True when this veteran's record misses a parent's sparks (never used as a matched parent). */
  unread: boolean;
}

interface GenResult {
  roster: RosterVeteran[];
  latent: Record<string, GoldenLatent>;
  rosterInfo: GoldenTruth['roster'];
  goldenInfo: { roles: Partial<Record<Role, string>> };
  sparkInfo: GoldenTruth['sparks'];
  deckInfo: GoldenTruth['deckModel'];
  /** N2: min/max of the unclipped stat sums, and whether any was clipped. */
  rawRange: [number, number];
  clipped: number;
}

async function generateRoster(
  master: MasterBundle,
  truth: TruthParams,
  multiplier: number,
): Promise<GenResult> {
  const ctx = loadGoldenContext(master, truth, multiplier);
  const tm = truth.trainingModel;
  const traineeChar = truth.golden.traineeCharacterId;

  // --- vocab -----------------------------------------------------------------------------------
  const sparkOfSkill = new Map<string, Spark>();
  for (const s of [...master.sparks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.target.kind === 'skill' && !sparkOfSkill.has(`${s.type}|${s.target.skillId}`))
      sparkOfSkill.set(`${s.type}|${s.target.skillId}`, s);
  }
  const sorted = (xs: Spark[]) => xs.sort((a, b) => a.id.localeCompare(b.id));
  const blueSparks = sorted(master.sparks.filter((s) => s.type === 'blue'));
  const pinkSparks = sorted(master.sparks.filter((s) => s.type === 'pink'));
  const whiteSkillSparks = sorted(
    master.sparks.filter(
      (s) => s.type === 'white' && s.target.kind === 'skill' && s.target.skillId !== SKILL_X,
    ),
  );
  const raceSparks = sorted(
    master.sparks.filter((s) => s.type === 'white' && s.target.kind === 'race'),
  );
  const scenarioSparkFor = new Map<string, Spark>();
  for (const s of master.sparks)
    if (s.type === 'white' && s.target.kind === 'scenario')
      scenarioSparkFor.set(s.target.scenarioId, s);
  const sparkFor = (pred: (s: Spark) => boolean, list: Spark[]) => {
    const s = list.find(pred);
    if (!s) throw new Error('golden: spark not found');
    return s;
  };
  const blueOf = (stat: StatKey) =>
    sparkFor((s) => s.target.kind === 'stat' && s.target.stat === stat, blueSparks);
  const pinkOf = (apt: AptKey) =>
    sparkFor((s) => s.target.kind === 'aptitude' && s.target.apt === apt, pinkSparks);
  const xSpark = sparkOfSkill.get(`white|${SKILL_X}`);
  if (!xSpark) throw new Error('golden: no white spark for skill X');
  const ref = (s: Spark, st: Stars): SparkRef => ({ sparkId: s.id, type: s.type, stars: st });

  const outfits = [...master.outfits].sort((a, b) => a.id.localeCompare(b.id));
  const outfitsOf = new Map<string, Outfit[]>();
  for (const o of outfits)
    outfitsOf.set(o.characterId, [...(outfitsOf.get(o.characterId) ?? []), o]);
  const characters = [...outfitsOf.keys()].sort();
  const scenarios = Object.keys(tm.scenarioIntercept).sort();
  const epithets = master.vocab
    .filter((v) => v.kind === 'epithet' && v.text.trim().toLowerCase() !== 'independent learner')
    .map((v) => v.text)
    .sort();
  const cardsById = new Map(master.cards.map((c) => [c.id, c]));
  const pool = [...tm.plantedCards.map((c) => c.cardId), ...tm.zeroEffectCards];
  const perUnit = new Map<string, Vec5>(tm.plantedCards.map((c) => [c.cardId, vec(c.perUnit)]));
  const growthCoef = vec(tm.growthCoefficient);
  const baseline = vec(tm.baseline);
  const chol = cholesky(tm.residualNoise.covariance);
  const ranks = [...master.ranks].sort((a, b) => b.minRating - a.minRating);

  // --- owned card LB timeline (synthetic) -------------------------------------------------------
  const owned = new Map<string, { lb0: number; ups: number[] }>();
  {
    const rng = rngFor('owned-cards');
    for (const id of pool) {
      const lb0 = int(rng, 0, 1);
      const ups = Array.from({ length: 4 - lb0 }, () => int(rng, 1, SPAN)).sort((a, b) => a - b);
      owned.set(id, { lb0, ups });
    }
  }
  const ownedLb = (id: string, day: number) => {
    const o = owned.get(id)!;
    return Math.min(4, o.lb0 + o.ups.filter((d) => d <= day).length);
  };

  // --- structure: dates, roles, modes ------------------------------------------------------------
  const sRng = rngFor('structure');
  const days = Array.from({ length: ROSTER_SIZE }, () => int(sRng, 0, SPAN)).sort((a, b) => a - b);
  // Exact 60/40 mode split over the whole roster: the planted veterans are manual, so the general
  // veterans get exactly round(0.6 × size) independent rows, assigned by a seeded permutation.
  const generalIdx = Array.from({ length: ROSTER_SIZE }, (_, i) => i).filter(
    (i) => SPECIAL_INDEX[i] === undefined,
  );
  const independentIdx = new Set(
    shuffle(rngFor('modes'), generalIdx).slice(0, Math.round(ROSTER_SIZE * INDEPENDENT_SHARE)),
  );
  const vets: TrueVet[] = [];
  const roster: RosterVeteran[] = [];
  const latent: Record<string, GoldenLatent> = {};
  let rawMin = Infinity;
  let rawMax = -Infinity;
  let clipped = 0;
  const lowConfidence: string[] = [];
  const unreadParentSparks: { id: string; owner: 'parent1' | 'parent2' }[] = [];
  const overrides: string[] = [];
  const guestParents: string[] = [];
  const unmatchedParents: string[] = [];
  const matchedParents: string[] = [];

  const generalPool = () => vets.filter((v) => v.role === 'general');
  const roles: Partial<Record<Role, string>> = {};

  for (let i = 0; i < ROSTER_SIZE; i++) {
    const role: Role = SPECIAL_INDEX[i] ?? 'general';
    const r = rngFor(`vet:${i}`);
    const day = days[i]!;
    const dateAcquired = addDays(DATE0, day);
    const capDay = Math.min(day + int(r, 0, 20), SPAN + 2);
    const capturedAt = new Date(
      Date.parse(`${addDays(DATE0, capDay)}T00:00:00.000Z`) + (12 * 3600 + i * 37) * 1000,
    ).toISOString();
    const id = ulid(capturedAt, r);

    // Character / outfit. Special roles avoid the plan trainee's character and each other.
    const specialChars = vets.filter((v) => v.role !== 'general').map((v) => v.characterId);
    let characterId: string;
    if (role === 'general') characterId = pick(r, characters);
    else {
      // Best pair: the two highest-affinity characters with the trainee (deterministic);
      // trap pair: random distinct characters.
      const cands = characters.filter((c) => c !== traineeChar && !specialChars.includes(c));
      if (role === 'best1' || role === 'best2') {
        const ranked = [...cands].sort(
          (a, b) =>
            affinity2(ctx, traineeChar, b) - affinity2(ctx, traineeChar, a) || a.localeCompare(b),
        );
        characterId = ranked[0]!;
      } else characterId = pick(r, cands);
    }
    const outfit = pick(r, outfitsOf.get(characterId)!);

    // Mode: 60% independent / 40% manual (exact counts are reported in truth.roster).
    const trainMode: TrainMode =
      role === 'general' ? (independentIdx.has(i) ? 'independent' : 'manual') : PLAN_MODE;
    const scenarioId = role === 'general' ? pick(r, scenarios) : PLAN_SCENARIO;

    // Parents.
    type ParentGen = {
      slot: 1 | 2;
      characterId: string;
      outfitId: string | null;
      isGuest: boolean;
      guestTrainer: string | null;
      matchedVeteranId: string | null;
      legacy: Legacy;
      recordedSparks: SparkRef[];
    };
    const parents: ParentGen[] = [];
    const usedChars = new Set([characterId]);
    for (const slot of [1, 2] as const) {
      const candidates = generalPool().filter(
        (v) => !usedChars.has(v.characterId) && v.index < i && !v.unread,
      );
      const kindRoll = r();
      const kind =
        role !== 'general'
          ? 'guest'
          : candidates.length > 0 && kindRoll < 0.55
            ? 'matched'
            : kindRoll < 0.9
              ? 'guest'
              : 'unmatched';
      if (kind === 'matched') {
        const m = pick(r, candidates);
        usedChars.add(m.characterId);
        parents.push({
          slot,
          characterId: m.characterId,
          outfitId: m.outfit.id,
          isGuest: false,
          guestTrainer: null,
          matchedVeteranId: m.id,
          legacy: {
            veteranId: m.id,
            characterId: m.characterId,
            sparks: m.self,
            grandparents: [
              { characterId: m.parentChars[0], sparks: m.parentSparks[0] },
              { characterId: m.parentChars[1], sparks: m.parentSparks[1] },
            ],
          },
          recordedSparks: m.self,
        });
        matchedParents.push(`${id}#${slot}`);
        continue;
      }
      const pc = pick(
        r,
        characters.filter((c) => !usedChars.has(c)),
      );
      usedChars.add(pc);
      const po = pick(r, outfitsOf.get(pc)!);
      const sp = guestSparks(r, role, slot, po);
      parents.push({
        slot,
        characterId: pc,
        outfitId: kind === 'guest' && r() < 0.5 ? null : po.id,
        isGuest: kind === 'guest',
        guestTrainer: kind === 'guest' ? `Guest Trainer ${int(r, 100, 999)}` : null,
        matchedVeteranId: null,
        legacy: { veteranId: null, characterId: pc, sparks: sp, grandparents: [null, null] },
        recordedSparks: sp,
      });
      (kind === 'guest' ? guestParents : unmatchedParents).push(`${id}#${slot}`);
    }

    // Deck: 6 distinct pool cards, distinct characters, none of the veteran's own character.
    const deckRng = rngFor(`deck:${i}`);
    const deck: RosterVeteran['deck'] = [];
    const borrowedSlot = deckRng() < 0.7 ? int(deckRng, 1, 6) : 0;
    const deckChars = new Set([characterId]);
    // Planted share: DECK_PLANTED_MIN..MAX planted cards (uniform), the rest zero-effect cards,
    // each list in a seeded random order; a card clashing with a used character is skipped and
    // the other list fills the gap.
    const plantedIds = shuffle(
      deckRng,
      tm.plantedCards.map((c) => c.cardId),
    );
    const zeroIds = shuffle(deckRng, [...tm.zeroEffectCards]);
    const nPlanted = int(deckRng, DECK_PLANTED_MIN, DECK_PLANTED_MAX);
    const order = [...plantedIds.slice(0, nPlanted), ...zeroIds, ...plantedIds.slice(nPlanted)];
    for (const cid of order) {
      if (deck.length === 6) break;
      const card = cardsById.get(cid)!;
      if (card.characterId && deckChars.has(card.characterId)) continue;
      if (card.characterId) deckChars.add(card.characterId);
      const slot = deck.length + 1;
      const borrowed = slot === borrowedSlot;
      const lb = borrowed ? 4 : ownedLb(cid, day);
      const cap = LEVEL_CAP[card.rarity]![lb]!;
      const level = borrowed || deckRng() < 0.85 ? cap : cap - int(deckRng, 1, 5);
      deck.push({ slot, cardId: cid, lb, level, borrowed });
    }
    if (deck.length !== 6) throw new Error('golden: could not build a legal deck');

    // Inheritance through the T05 public API.
    const plan = planInheritance(
      ctx,
      outfit.id,
      [parents[0]!.legacy, parents[1]!.legacy],
      scenarioId,
    );
    const inh = sampleInheritance(plan, rngFor(`inh:${i}`));

    // Training model.
    const nRng = rngFor(`noise:${i}`);
    const z = STAT_ORDER.map(() => normal(nRng));
    const noise = STAT_ORDER.map((_, k) => {
      let s = 0;
      for (let j = 0; j <= k; j++) s += chol[k]![j]! * z[j]!;
      return s;
    });
    const mode = vec(tm.modeIntercept[trainMode]);
    const scen = vec(tm.scenarioIntercept[scenarioId]!);
    const growth = vec(outfit.growth);
    const training = STAT_ORDER.map((_, k) => {
      let t = baseline[k]! + mode[k]! + scen[k]! + growthCoef[k]! * growth[k]!;
      for (const d of deck) t += (perUnit.get(d.cardId)?.[k] ?? 0) * (1 + d.lb / 4);
      return t;
    });
    const statsVec = STAT_ORDER.map((_, k) => {
      const raw = training[k]! + noise[k]! + inh.statGain[k]!;
      rawMin = Math.min(rawMin, raw);
      rawMax = Math.max(rawMax, raw);
      if (raw < 1 || raw > tm.statCap[scenarioId]!) clipped++;
      return Math.round(Math.min(tm.statCap[scenarioId]!, Math.max(1, raw)));
    });
    latent[id] = {
      inheritance: inh.statGain.map(r6),
      training: training.map(r6),
      noise: noise.map(r6),
      inheritanceHints: Object.keys(inh.hints).sort(),
    };

    // Skills: hinted set, then per-mode acquisition.
    const kRng = rngFor(`skills:${i}`);
    const hinted = new Set<string>([...outfit.innateSkillIds, ...Object.keys(inh.hints)]);
    for (const d of deck) {
      const c = cardsById.get(d.cardId)!;
      for (const s of [...c.hintSkillIds, ...c.eventSkillIds]) hinted.add(s);
    }
    hinted.delete(outfit.uniqueSkillId);
    const hintedSorted = [...hinted].sort();
    const skills: RosterVeteran['skills'] = [
      { skillId: outfit.uniqueSkillId, level: int(kRng, 1, 6) },
    ];
    for (const s of hintedSorted) {
      const p = truth.skills.rates[trainMode][s];
      if (p === undefined) throw new Error(`golden: no rate for ${s}`);
      if (kRng() < p) skills.push({ skillId: s, level: null });
    }

    // Own sparks (self).
    const aptitudes = {} as Record<AptKey, Grade>;
    for (const a of APT_KEYS) aptitudes[a] = inh.aptitudes[a];
    const spRng = rngFor(`sparks:${i}`);
    const self = selfSparks(spRng, role, outfit, aptitudes, skills, scenarioId);

    const v: TrueVet = {
      index: i,
      role,
      id,
      characterId,
      outfit,
      self,
      parentSparks: [parents[0]!.legacy.sparks, parents[1]!.legacy.sparks],
      parentChars: [parents[0]!.characterId, parents[1]!.characterId],
      unread: false,
    };
    if (role !== 'general') roles[role] = id;

    // Confidence / unread parent sparks / mode override (recorded-data realism).
    const cRng = rngFor(`confidence:${i}`);
    const lowConf = role === 'general' && cRng() < 0.08;
    const minConfidence = lowConf
      ? Math.round((0.6 + cRng() * 0.29) * 1000) / 1000
      : Math.round((0.9 + cRng() * 0.1) * 1000) / 1000;
    let unread: 1 | 2 | 0 = 0;
    if (lowConf) {
      lowConfidence.push(id);
      if (cRng() < 0.5) {
        unread = cRng() < 0.5 ? 1 : 2;
        unreadParentSparks.push({ id, owner: unread === 1 ? 'parent1' : 'parent2' });
      }
    }
    v.unread = unread !== 0;
    vets.push(v);
    let epithet = trainMode === 'independent' ? INDEPENDENT_EPITHET : pick(cRng, epithets);
    let modeSource: 'epithet' | 'override' = 'epithet';
    if (role === 'general' && cRng() < 0.03) {
      // The user overrode the epithet-derived mode (01 §6); trainMode is the true mode.
      epithet = trainMode === 'independent' ? pick(cRng, epithets) : INDEPENDENT_EPITHET;
      modeSource = 'override';
      overrides.push(id);
    }

    const sum = statsVec.reduce((s, x) => s + x, 0);
    const rating = Math.round(sum * 3 + skills.length * 30);
    const rank = ranks.find((x) => x.minRating <= rating)!.id;
    const races = int(cRng, 18, 32);
    const wins = Math.round(races * (0.3 + cRng() * 0.6));
    const fans = cRng() < 0.95 ? (50 + wins * 20 + int(cRng, 0, 40)) * 1000 : null;

    const sparkRows: RosterVeteran['sparks'] = [
      ...self.map((s) => ({ owner: 'self' as const, ...s })),
      ...parents.flatMap((p) =>
        unread === p.slot
          ? []
          : p.recordedSparks.map((s) => ({ owner: `parent${p.slot}` as const, ...s })),
      ),
    ];
    const body = {
      id,
      fingerprint: '',
      modeSource,
      minConfidence,
      capturedAt,
      characterId,
      outfitId: outfit.id,
      rank,
      rating,
      epithet,
      trainMode,
      stats: obj(statsVec),
      aptitudes,
      skills,
      sparks: sparkRows,
      deck,
      parents: parents.map((p) => ({
        slot: p.slot,
        characterId: p.characterId,
        outfitId: p.outfitId,
        isGuest: p.isGuest,
        guestTrainer: p.guestTrainer,
        matchedVeteranId: p.matchedVeteranId,
      })),
      scenarioId,
      career: { races, wins, fans, dateAcquired },
    };
    body.fingerprint = await fingerprint(body);
    roster.push(RosterVeteran.parse(body));
  }

  // --- helpers that need the vocab (hoisted function declarations) ------------------------------
  function guestSparks(r: Rng, role: Role, slot: 1 | 2, po: Outfit): SparkRef[] {
    const out: SparkRef[] = [];
    if (role === 'best1') {
      // B1's parents: slot 1 carries a 2★ white spark for skill X; no medium pink.
      out.push(ref(blueOf(slot === 1 ? 'pow' : 'gut'), 2));
      out.push(ref(pinkOf(slot === 1 ? 'mile' : 'turf'), 2));
      if (slot === 1) out.push(ref(xSpark!, 2));
      return out;
    }
    if (role === 'best2') {
      out.push(ref(blueOf('sta'), 2));
      out.push(ref(pinkOf('medium'), 3));
      return out;
    }
    if (role === 'trap1' || role === 'trap2') {
      out.push(ref(blueOf('spd'), 3));
      out.push(ref(pinkOf(slot === 1 ? 'sprint' : 'mile'), 1));
      return out;
    }
    const blue = blueSparks[Math.floor(r() * blueSparks.length)]!;
    out.push(ref(blue, stars(r, GENERAL_BLUE_STARS)));
    const pink = pinkSparks[Math.floor(r() * pinkSparks.length)]!;
    out.push(ref(pink, isMedium(pink) ? 1 : stars(r)));
    if (r() < 0.7) {
      const g = sparkOfSkill.get(`green|${po.uniqueSkillId}`);
      if (g) out.push(ref(g, stars(r)));
    }
    const nWhite = int(r, 0, 3);
    for (let k = 0; k < nWhite; k++) {
      const w = whiteSkillSparks[Math.floor(r() * whiteSkillSparks.length)]!;
      if (!out.some((s) => s.sparkId === w.id)) out.push(ref(w, stars(r, [0.55, 0.35, 0.1])));
    }
    if (r() < 0.3) {
      const w = raceSparks[Math.floor(r() * raceSparks.length)]!;
      out.push(ref(w, stars(r, [0.55, 0.35, 0.1])));
    }
    return out;
  }

  function isMedium(s: Spark) {
    return s.target.kind === 'aptitude' && s.target.apt === 'medium';
  }

  function selfSparks(
    r: Rng,
    role: Role,
    outfit: Outfit,
    aptitudes: Record<AptKey, Grade>,
    skills: RosterVeteran['skills'],
    scenarioId: string,
  ): SparkRef[] {
    const out: SparkRef[] = [];
    const green = sparkOfSkill.get(`green|${outfit.uniqueSkillId}`);
    if (role === 'best1') {
      out.push(ref(blueOf('spd'), 2), ref(pinkOf('turf'), 2), ref(xSpark!, 3));
      return out;
    }
    if (role === 'best2') {
      out.push(ref(blueOf('sta'), 3), ref(pinkOf('medium'), 3));
      return out;
    }
    if (role === 'trap1' || role === 'trap2') {
      out.push(ref(blueOf('spd'), 3), ref(pinkOf('turf'), 1));
      if (green) out.push(ref(green, 3));
      return out;
    }
    out.push(ref(blueSparks[Math.floor(r() * blueSparks.length)]!, stars(r, GENERAL_BLUE_STARS)));
    const good = APT_KEYS.filter((a) => GRADES.indexOf(aptitudes[a]) >= 6);
    const apt = good.length > 0 ? pick(r, good) : pick(r, APT_KEYS);
    out.push(ref(pinkOf(apt), apt === 'medium' ? 1 : stars(r)));
    if (green && r() < 0.75) out.push(ref(green, stars(r)));
    const acquired = skills
      .filter((s) => s.level === null && s.skillId !== SKILL_X)
      .map((s) => sparkOfSkill.get(`white|${s.skillId}`))
      .filter((s): s is Spark => s !== undefined);
    const nWhite = Math.min(acquired.length, int(r, 1, 4));
    for (const w of shuffle(r, [...acquired]).slice(0, nWhite))
      out.push(ref(w, stars(r, [0.55, 0.35, 0.1])));
    if (r() < 0.35) out.push(ref(pick(r, raceSparks), stars(r, [0.55, 0.35, 0.1])));
    if (r() < 0.1) {
      const s = scenarioSparkFor.get(scenarioId);
      if (s) out.push(ref(s, 1));
    }
    return out;
  }

  // --- reported composition ----------------------------------------------------------------------
  const count = (pred: (v: RosterVeteran) => boolean) => roster.filter(pred).length;
  const sparkInfo = {
    selfSparks:
      "general veterans: 1 blue (uniform stat; stars 1/2 with p .55/.45, never 3★), 1 pink (an aptitude graded ≥ A if any, stars 1/2/3 p .5/.35/.15; medium capped at 1★), the outfit's own green spark with p .75, 1–4 white skill sparks from acquired skills (p .55/.35/.10), a race spark with p .35, its scenario's spark (1★) with p .10. Skill X never appears outside the planted best pair.",
    guestSparks:
      "synthetic guest/unmatched parents: 1 blue (1★/2★ p .55/.45), 1 pink (stars 1/2/3 p .5/.35/.15) (medium capped at 1★), their outfit's green with p .7, 0–3 random white skill sparks (never X), a race spark with p .3.",
    gradeRule:
      'aptitudes = the outfit base + the sampled pink steps (engine sampleInheritance, capped at S).',
    xSparkId: xSpark.id,
  };
  const deckInfo = {
    pool: 'the 12 planted + 12 zero-effect SSR cards (truth.trainingModel); 6 distinct cards per deck with distinct characters, never the veteran’s own character; each deck takes a uniform 2–5 planted cards (seeded order), then zero-effect cards; a card whose character is already used is skipped and the next card is taken (the other list fills any gap).',
    borrowed: '70% of decks have one borrowed slot (LB4, max level).',
    ownedLbRule:
      'each pool card: lbAtStart uniform 0..1, then exactly (4 − lbAtStart) upgrades on uniform days 1..90 (sorted); owned LB on day d = min(4, lbAtStart + #upgrades ≤ d). Synthetic.',
    ownedLb: Object.fromEntries(
      [...owned]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, o]) => [id, { lbAtStart: o.lb0, upgradeDays: o.ups, dayZero: DATE0 }]),
    ),
    level:
      'owned cards are at the synthetic level cap for their LB (SSR 30/35/40/45/50 for LB0..4) with p .85, else 1–5 below; level has no planted effect (unverified caps).',
  };
  const rosterInfo = {
    size: roster.length,
    modes: {
      independent: count((v) => v.trainMode === 'independent'),
      manual: count((v) => v.trainMode === 'manual'),
      rule: 'exactly 60% independent / 40% manual over all 260 rows: the 4 planted veterans are manual, round(0.6 × 260) = 156 general veterans chosen by a Fisher–Yates permutation with mulberry32(seedFromString("20260929:modes")) are independent, the rest manual',
    },
    scenarios: Object.fromEntries(scenarios.map((s) => [s, count((v) => v.scenarioId === s)])),
    dateAcquiredRange: [roster[0]!.career.dateAcquired, roster.at(-1)!.career.dateAcquired] as [
      string,
      string,
    ],
    dateAcquiredRule: `day uniform 0..${SPAN} after ${DATE0} per veteran, sorted (veteran index order = date order)`,
    capturedAt:
      'dateAcquired + 0..20 days at 12:00Z (+37 s per index), all before meta.generatedAt',
    ids: 'ULID: 48-bit time = capturedAt, 80 random bits from mulberry32(seedFromString(`20260929:vet:<index>`))',
    minConfidence:
      'general veterans: 8% are low-confidence (0.60–0.89), the rest 0.90–1.00; stats/skills/sparks of low-confidence rows are still the true generated values',
    lowConfidenceIds: lowConfidence,
    unreadParentSparks,
    modeOverrideIds: overrides,
    trainingEligibleIds: roster.filter((v) => v.minConfidence >= 0.9).map((v) => v.id),
    trainingEligibleRule:
      '50 §4: min_confidence ≥ 0.9 (every row has a scenario and both parents identified; unread parent sparks only occur on low-confidence rows)',
    parents: {
      matched: matchedParents.length,
      guest: guestParents.length,
      unmatchedNonGuest: unmatchedParents.length,
      note: 'parent kinds for general veterans: matched roster veteran (p .55 when an earlier legal one exists), guest (isGuest, guestTrainer set), unmatched non-guest (outfit known, no matchedVeteranId). Matched parents are always earlier general veterans whose own record is complete (no unread parent sparks), so legacyFromVeteran(matched roster record) is exactly the lineage the generator used; the 4 planted veterans are never anyone’s parent.',
    },
    hinted:
      'per veteran: deck hint/event skills ∪ outfit innate skills ∪ latent[id].inheritanceHints (skills hinted by the sparks that activated in its sampled inheritance), minus the outfit unique skill',
  };
  const goldenInfo = { roles };
  return {
    roster,
    latent,
    rosterInfo,
    goldenInfo,
    sparkInfo,
    deckInfo,
    rawRange: [r6(rawMin), r6(rawMax)],
    clipped,
  };
}

// ---------------------------------------------------------------------------------------------
// Target, holdout, serialisation
// ---------------------------------------------------------------------------------------------

function buildTargets(): CmTarget[] {
  return [
    CmTarget.parse({
      id: TARGET_ID,
      name: 'golden-cm-1',
      course: {
        surface: 'turf',
        distance: 'medium',
        notes: 'Synthetic golden target (T08, 70 §2): Medium / Turf / Pace.',
      },
      style: 'pace',
      minStats: { spd: 1100, sta: 800 },
      minAptitudes: { turf: 'A', medium: 'A', pace: 'A' },
      requiredSkills: [SKILL_X],
      optionalSkills: [],
    }),
  ];
}

/** Plan deck slots (planted card index in PLANTED_EFFECTS order). */
const PLAN_DECK_PLANTED = [0, 1, 3, 5, 9, 11];

function buildPlanDeck(master: MasterBundle, params: TruthParams): RosterVeteran['deck'] {
  const cards = new Map(master.cards.map((c) => [c.id, c]));
  const chars = new Set<string>([params.golden.traineeCharacterId]);
  return PLAN_DECK_PLANTED.map((idx, i) => {
    const pc = params.trainingModel.plantedCards[idx]!;
    const c = cards.get(pc.cardId)!;
    if (c.characterId) {
      if (chars.has(c.characterId)) throw new Error('golden: plan deck character clash');
      chars.add(c.characterId);
    }
    return { slot: i + 1, cardId: pc.cardId, lb: 4, level: 50, borrowed: false };
  });
}

function holdoutSplit(eligibleIds: string[]) {
  const ids = [...eligibleIds].sort();
  shuffle(mulberry32(HOLDOUT_SEED), ids);
  const n = Math.ceil(ids.length * HOLDOUT_FRACTION);
  return { holdoutIds: ids.slice(0, n).sort(), trainIds: ids.slice(n).sort() };
}

/** Coverage band of 50 §9 / 70 §3 F08. */
const COVERAGE_BAND: [number, number] = [0.72, 0.88];

/**
 * S3: 80% holdout interval coverage of the test-only 50 §4 diagnostic fit
 * (test/golden/t06-diagnostic.ts) on the stored split. Uses only T06-available data (no latent).
 */
function coverageDiagnostic(
  master: MasterBundle,
  params: TruthParams,
  roster: RosterVeteran[],
  trainIds: string[],
  holdoutIds: string[],
): GoldenTruth['holdout']['coverageDiagnostic'] {
  const ctx = loadGoldenContext(master, params);
  const d = buildDesign(ctx, master, roster, trainIds, holdoutIds);
  const train = d.rows.slice(0, trainIds.length);
  const hold = d.rows.slice(trainIds.length);
  const lambdas = STAT_ORDER.map((_, k) => chooseLambda(d, train, k));
  const c = holdoutCoverage(d, train, hold, lambdas);
  const ess = effectiveSampleSize(recencyWeights(train));
  const pooled = r6(c.pooled);
  return {
    definition: `Pooled over the 5 stats: the share of the ${c.cells} (holdout row, stat) cells whose y = finalStat − E[inheritance | recorded lineage] lies inside prediction ± z0.9 · sqrt(σ̂²_k (1 + v)), from a per-stat weighted ridge fit on the ${trainIds.length} train rows with 50 §4 features (scenario×mode, growth, card id and type × (1 + lb/4)), recency weights 0.5^(age/60) (ESS ${ess.toFixed(1)}), λ (id/base) chosen per stat by seeded 5-fold CV on {0.1,1,10,100}×{0.1,1,10}: ${lambdas.map((l) => `${l.lambdaId}/${l.lambdaBase}`).join(', ')}. σ̂²_k = Σw r²/Σw(1−h) on train residuals; v = the sandwich variance factor of the prediction. Code: packages/engine/test/golden/t06-diagnostic.ts (test-only, not T06).`,
    pooled,
    perStat: obj(c.perStat.map(r6)),
    cells: c.cells,
    band: COVERAGE_BAND,
    margin: `pooled ${pooled.toFixed(3)}: ${(pooled - COVERAGE_BAND[0]).toFixed(3)} above 0.72 and ${(COVERAGE_BAND[1] - pooled).toFixed(3)} below 0.88; binomial sd at n=${c.cells} cells ≈ ${Math.sqrt((0.8 * 0.2) / c.cells).toFixed(3)} (larger in practice: the 5 stats of a row are correlated), per stat at n=${hold.length} ≈ ${Math.sqrt((0.8 * 0.2) / hold.length).toFixed(3)}.`,
    limitations:
      'Per-stat coverage at n=48 has a sampling sd ≈ 0.058, so a per-stat 0.72–0.88 check is not robust; T06 should report the pooled figure. The interval uses one homoscedastic σ̂² per stat (noise + inheritance-sampling deviation together) from the train residuals. 50 §4 defines residualCov from the holdout residuals and 50 §7 adds Var[inh] on top; that would double count the inheritance variance and use the holdout to calibrate itself, so T06 coverage may differ from this diagnostic. The planted MVN covariance is not used.',
  };
}

function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x !== null && typeof x === 'object') {
    return Object.fromEntries(
      Object.keys(x as object)
        .sort()
        .map((k) => [k, sortKeys((x as Record<string, unknown>)[k])]),
    );
  }
  return x;
}

/** Stable serialisation: recursively sorted keys, then prettier with the repo config. */
export async function serialize(value: unknown, filePath: string): Promise<string> {
  const config = (await resolveConfig(filePath)) ?? {};
  return format(JSON.stringify(sortKeys(value)), { ...config, parser: 'json', filepath: filePath });
}

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Generates every golden file in memory: `{ [fileName]: content }`. Pure given the master bundle:
 * calling it twice returns byte-identical strings.
 */
export async function generateGolden(master: MasterBundle): Promise<Record<string, string>> {
  const params = buildTruthParameters(master);
  const base = await generateRoster(master, params, 1);
  const calib = await generateRoster(master, params, CALIBRATION_MULTIPLIER);
  const targets = buildTargets();
  const target = targets[0]!;

  const roles = base.goldenInfo.roles as Record<Role, string>;
  const byId = new Map(base.roster.map((v) => [v.id, v]));
  const best: [string, string] = [roles.best1, roles.best2];
  const trap: [string, string] = [roles.trap1, roles.trap2];
  const planDeck = buildPlanDeck(master, params);
  const { holdoutIds, trainIds } = holdoutSplit(base.rosterInfo.trainingEligibleIds);
  const coverage = coverageDiagnostic(master, params, base.roster, trainIds, holdoutIds);

  const files: Record<string, string> = {};
  const p = (name: string) => join(GOLDEN_DIR, name);
  files[FILES.roster] = await serialize(base.roster, p(FILES.roster));
  files[FILES.calibration] = await serialize(calib.roster, p(FILES.calibration));
  files[FILES.targets] = await serialize(targets, p(FILES.targets));

  const statValues = base.roster.flatMap((v) => STAT_ORDER.map((k) => v.stats[k]));
  const truth: GoldenTruth = {
    ...params,
    trainingModel: {
      ...params.trainingModel,
      clipping: {
        exercised: base.clipped + calib.clipped > 0,
        observedStatRange: [Math.min(...statValues), Math.max(...statValues)],
        note: `N2: unclipped sums range ${base.rawRange[0]}..${base.rawRange[1]} (roster.json; ${base.clipped} clipped cells, ${calib.clipped} in the ×1.3 variant) against statCap ${[...new Set(Object.values(params.trainingModel.statCap))].join('/')}, so the clip to [1, statCap] is documented but NOT exercised by the golden data. Clipping must be tested separately (70 §3 F09, T06).`,
      },
    },
    sparks: base.sparkInfo,
    deckModel: base.deckInfo,
    roster: base.rosterInfo,
    golden: {
      ...params.golden,
      targetName: target.name,
      targetId: target.id,
      target: 'targets.json[0]',
      planDeck,
      skillXWhy:
        'skill:restraint (normal, gameId 202161) has exactly one spark (spark:restraint), is not in any card hint/event list, not innate or unique for any outfit, and not hinted by any race spark in rules.json. In the roster its only sources are the planted best parent 1 (self 3★) and that veteran’s guest parent 1 (2★).',
      bestPair: {
        parents: best,
        characters: [byId.get(best[0])!.characterId, byId.get(best[1])!.characterId],
        why: 'best1: self 2★ blue speed, 2★ pink turf, 3★ white X; guest parent 1 with 2★ white X. best2: self 3★ blue stamina, 3★ pink medium; both guest parents 2★ blue stamina + 3★ pink medium. They are the two characters with the highest affinity2 with the trainee character. Only pairs containing best1 can hint X; only best2 brings 3★ medium pinks (every other medium pink is 1★).',
      },
      trapPair: {
        parents: trap,
        characters: [byId.get(trap[0])!.characterId, byId.get(trap[1])!.characterId],
        why: 'each trap veteran: self 3★ blue speed and both guest parents 3★ blue speed → 18 combined blue stars over the pair lineage, the unique maximum (every general veteran has ≤ 6: general blue sparks are never 3★; best1/best2 have 6/7). No source of skill X, no medium pink.',
      },
      roles,
    },
    holdout: {
      seed: HOLDOUT_SEED,
      fraction: HOLDOUT_FRACTION,
      method:
        'trainingEligibleIds sorted ascending, Fisher–Yates shuffle with mulberry32(seed) (engine src/rng.ts), first ceil(20%) = holdout; both lists stored sorted.',
      holdoutIds,
      trainIds,
      coverageDiagnostic: coverage,
    },
    calibration: {
      file: FILES.calibration,
      blueStatGainMultiplier: CALIBRATION_MULTIPLIER,
      effectiveBlueStatGain: {
        '1': r6(
          params.syntheticInheritance.rulesOverrides.blueStatGain['1'] * CALIBRATION_MULTIPLIER,
        ),
        '2': r6(
          params.syntheticInheritance.rulesOverrides.blueStatGain['2'] * CALIBRATION_MULTIPLIER,
        ),
        '3': r6(
          params.syntheticInheritance.rulesOverrides.blueStatGain['3'] * CALIBRATION_MULTIPLIER,
        ),
      },
      note: 'Same seed and streams: ids, decks, sparks, skills, aptitudes, noise and the activation draws are identical; only blue activation gains (and so stats, rating, rank and fingerprint) differ. 70 §3 F12: calibration should suggest ×1.2–1.4.',
      sha256: sha256(files[FILES.calibration]!),
      latent: calib.latent,
    },
    latent: base.latent,
    webFixtures: {
      note: 'S4/N3. apps/web/fixtures/{roster,cm-targets,golden-truth}.json are byte-identical copies named for the web fixture URL mapping (/api/v1/<x> -> /fixtures/<x>.json). golden-truth.json is intended metadata for a future fixture-mode planner (it carries the synthetic inheritance inputs that loadGoldenContext needs) and is NOT consumed by the web client today. apps/web/fixtures/ is currently outside Vite publicDir and is not served (T13/T02 follow-up). A fixture-mode planner must build its context with loadGoldenContext(master, truth) from packages/engine/scripts/golden-context.ts: the published rules (blueStatGain 0, inheritanceTurns []) do not reproduce the golden best pair.',
    },
    files: {
      [FILES.roster]: sha256(files[FILES.roster]!),
      [FILES.targets]: sha256(files[FILES.targets]!),
    },
  };
  files[FILES.truth] = await serialize(truth, p(FILES.truth));
  return files;
}

/** Writes the engine golden files and the byte-identical web fixture copies. */
export async function writeGolden(master: MasterBundle = loadPublishedBundle()) {
  const files = await generateGolden(master);
  mkdirSync(GOLDEN_DIR, { recursive: true });
  mkdirSync(WEB_FIXTURE_DIR, { recursive: true });
  const written: [string, string][] = [];
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(GOLDEN_DIR, name), content);
    written.push([join(GOLDEN_DIR, name), sha256(content)]);
  }
  for (const [name, copy] of Object.entries(FIXTURE_FILES)) {
    writeFileSync(join(WEB_FIXTURE_DIR, copy), files[name]!);
    written.push([join(WEB_FIXTURE_DIR, copy), sha256(files[name]!)]);
  }
  return written;
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(ENGINE_DIR, '../..');
  for (const [path, hash] of await writeGolden()) {
    const bytes = readFileSync(path).length;
    console.log(`${hash}  ${relative(root, path)}  (${bytes} bytes)`);
  }
}
