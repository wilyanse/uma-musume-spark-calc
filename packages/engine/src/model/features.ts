/**
 * 50 §4 design matrix. Feature names are self-describing so a stored snapshot can rebuild the
 * vector of any plan without the training rows:
 *
 * - `cell:<scenarioId>|<trainMode>`: one-hot scenario × train mode (cells seen in training);
 * - `growth:<stat>`: the trainee outfit's growth % (5);
 * - `card:<cardId>`: indicator × (1 + lb/4), aggregated by card id (ids seen in training),
 *   penalised with λ_id;
 * - `type:<cardType>`: the same quantity pooled by card type (7, always present) so an unseen card
 *   borrows strength from its type;
 * - `deck:<key>`: scenario plugin `deckFeatures` (keys seen in training).
 *
 * The intercept is separate (`perStat.intercept`) and is penalised with λ_base like every other
 * non-card-id coefficient ("everything else", 50 §4). The intercept is collinear with the full
 * cell one-hot; the ridge penalty resolves it and every prediction is unaffected.
 */
import { STAT_KEYS } from '@uma/schema';
import type { CardType, TrainMode } from '@uma/schema';
import type { EngineContext } from '../context.ts';
import type { DeckSlot } from '../types.ts';
import { ModelInputError } from './errors.ts';

export const CARD_TYPES: readonly CardType[] = [
  'speed',
  'stamina',
  'power',
  'guts',
  'wit',
  'friend',
  'group',
];

export interface FeaturePlan {
  traineeOutfitId: string;
  deck: readonly DeckSlot[];
  trainMode: TrainMode;
  scenarioId: string;
}

export const cellName = (scenarioId: string, mode: TrainMode) => `cell:${scenarioId}|${mode}`;
export const cardUnits = (lb: number) => 1 + lb / 4;

/** Columns a plan touches that the fitted model has never seen (reported, never guessed). */
export interface FeatureWarnings {
  unseenCell: boolean;
  unseenCards: string[];
  unseenDeckFeatures: string[];
}

/** Scenario plugin deck features, validated finite. */
export function deckFeatures(
  ctx: EngineContext,
  scenarioId: string,
  deck: readonly DeckSlot[],
): Record<string, number> {
  const plugin = ctx.scenarios.get(scenarioId);
  if (!plugin) throw new ModelInputError('unknown-scenario', scenarioId);
  const out = plugin.deckFeatures([...deck], ctx);
  for (const [k, v] of Object.entries(out)) {
    if (!Number.isFinite(v)) {
      throw new ModelInputError('non-finite-feature', `${scenarioId} deckFeatures.${k} = ${v}`);
    }
  }
  return out;
}

/**
 * The feature vector (without the intercept) of a plan in the column space `names`. Unknown
 * outfit / card / scenario ids throw `ModelInputError`.
 */
export function featureVector(
  ctx: EngineContext,
  names: readonly string[],
  index: ReadonlyMap<string, number>,
  plan: FeaturePlan,
): { x: Float64Array; warnings: FeatureWarnings } {
  const x = new Float64Array(names.length);
  const warnings: FeatureWarnings = { unseenCell: false, unseenCards: [], unseenDeckFeatures: [] };
  const cell = index.get(cellName(plan.scenarioId, plan.trainMode));
  if (cell === undefined) warnings.unseenCell = true;
  else x[cell] = 1;
  const outfit = ctx.outfits.get(plan.traineeOutfitId);
  if (!outfit) throw new ModelInputError('unknown-outfit', plan.traineeOutfitId);
  for (const k of STAT_KEYS) {
    const c = index.get(`growth:${k}`);
    if (c !== undefined) x[c] = outfit.growth[k];
  }
  for (const d of plan.deck) {
    const card = ctx.cards.get(d.cardId);
    if (!card) throw new ModelInputError('unknown-card', d.cardId);
    const u = cardUnits(d.lb);
    const c = index.get(`card:${d.cardId}`);
    if (c === undefined) warnings.unseenCards.push(d.cardId);
    else x[c] = x[c]! + u;
    const t = index.get(`type:${card.type}`);
    if (t !== undefined) x[t] = x[t]! + u;
  }
  for (const [k, v] of Object.entries(deckFeatures(ctx, plan.scenarioId, plan.deck))) {
    const c = index.get(`deck:${k}`);
    if (c === undefined) warnings.unseenDeckFeatures.push(k);
    else x[c] = v;
  }
  return { x, warnings };
}

/** Column names from the fit rows (sorted, deterministic). */
export function featureNames(ctx: EngineContext, plans: readonly FeaturePlan[]): string[] {
  const cells = new Set<string>();
  const cards = new Set<string>();
  const deckKeys = new Set<string>();
  for (const p of plans) {
    cells.add(cellName(p.scenarioId, p.trainMode));
    for (const d of p.deck) cards.add(d.cardId);
    for (const k of Object.keys(deckFeatures(ctx, p.scenarioId, p.deck))) deckKeys.add(k);
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return [
    ...sorted(cells),
    ...STAT_KEYS.map((k) => `growth:${k}`),
    ...sorted(cards).map((c) => `card:${c}`),
    ...CARD_TYPES.map((t) => `type:${t}`),
    ...sorted(deckKeys).map((k) => `deck:${k}`),
  ];
}

export const isCardIdFeature = (name: string) => name.startsWith('card:');
