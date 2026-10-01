/**
 * Plain-node smoke run of the public engine API (no `--experimental-transform-types`):
 *   node packages/engine/scripts/smoke.ts
 * Loads the published Global bundle read-only, builds two schema-valid roster veterans and runs
 * `inheritanceExpectation`, `planInheritance` and `sampleInheritance`. Exits non-zero on failure.
 */
import {
  IllegalPairError,
  inheritanceExpectation,
  loadContext,
  mulberry32,
  planInheritance,
  legacyFromVeteran,
  sampleInheritance,
} from '../src/index.ts';
import { loadPublishedBundle, makeRosterVeteran } from './published-bundle.ts';

const master = loadPublishedBundle();
const ctx = loadContext(master, master.rules);
const common = {
  outfitId: 'outfit:special-dreamer',
  cardId: master.cards[0]!.id,
  scenarioId: 'scenario:ura-finale',
};
const p1 = makeRosterVeteran({
  ...common,
  id: '01J8Z3K4M5N6P7Q8R9S0T1V2W3',
  characterId: 'character:special-week',
  outfitId: 'outfit:special-dreamer',
  self: [
    { sparkId: 'spark:speed', type: 'blue', stars: 3 },
    { sparkId: 'spark:turf', type: 'pink', stars: 2 },
  ],
  parent1: [
    { sparkId: 'spark:stamina', type: 'blue', stars: 2 },
    { sparkId: 'spark:mile', type: 'pink', stars: 1 },
  ],
  parent2: [],
  parents: [
    { characterId: 'character:tokai-teio' },
    { characterId: 'character:gold-ship', isGuest: true },
  ],
});
const p2 = makeRosterVeteran({
  ...common,
  id: '01J8Z3K4M5N6P7Q8R9S0T1V2W4',
  characterId: 'character:silence-suzuka',
  outfitId: 'outfit:innocent-silence',
  self: [
    { sparkId: 'spark:power', type: 'blue', stars: 1 },
    { sparkId: 'spark:medium', type: 'pink', stars: 3 },
  ],
  parent1: [],
  parent2: [],
  parents: [{ characterId: 'character:vodka' }, { characterId: 'character:daiwa-scarlet' }],
});

const trainee = 'outfit:frontline-elegance'; // Mejiro McQueen
const r = inheritanceExpectation(ctx, trainee, [p1, p2], 'scenario:ura-finale');
const sum = [0, 0, 0, 0, 0];
for (const c of r.contributions)
  c.expectedEffect.stats.forEach((x, k) => (sum[k] = (sum[k] ?? 0) + x));
console.log(
  'master',
  r.provenance.masterVersion,
  'rules',
  r.provenance.rulesVersion,
  'validated',
  r.provenance.validated,
  'eventsKnown',
  r.provenance.eventsKnown,
);
console.log('placeholderRules', r.provenance.placeholderRules.join(','));
console.log('affinity total', r.affinity.total, 'perSource', JSON.stringify(r.affinity.perSource));
console.log(
  'expectedStatGain',
  JSON.stringify(r.expectedStatGain),
  'sum(contributions.stats)',
  JSON.stringify(sum),
);
console.log('contributions', r.contributions.map((c) => `${c.from}:${c.sparkId}`).join(' '));
const plan = planInheritance(
  ctx,
  trainee,
  [legacyFromVeteran(p1), legacyFromVeteran(p2)],
  'scenario:ura-finale',
);
console.log('sample', JSON.stringify(sampleInheritance(plan, mulberry32(1)).statGain));
try {
  inheritanceExpectation(ctx, trainee, [p1, p1], 'scenario:ura-finale');
  throw new Error('same veteran was accepted');
} catch (e) {
  if (!(e instanceof IllegalPairError)) throw e;
  console.log('same veteran ->', e.reasons.join(','));
}
if (sum.some((x, k) => Math.abs(x - (r.expectedStatGain[k] ?? NaN)) > 1e-9)) {
  throw new Error('sum(contributions.stats) != expectedStatGain');
}
console.log('smoke ok');
