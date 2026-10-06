/**
 * Deck draft (S04 → S06). No API contract exists for it (Q-77), so it lives in local storage,
 * namespaced per data mode. Shape = the 01 §3 `DeckSlot` (slot 1..6, slot 6 borrowed Friend).
 */
import type { RosterVeteran } from '@uma/schema';
import { readJson, storageKey, writeJson, type KeyValueStore } from './storage.ts';

export type DeckSlot = RosterVeteran['deck'][number];
export type DeckDraft = (DeckSlot | null)[]; // index 0..5 = slot 1..6

export const emptyDeck = (): DeckDraft => [null, null, null, null, null, null];

const isSlot = (v: unknown, i: number): v is DeckSlot => {
  if (v === null || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    d.slot === i + 1 &&
    typeof d.cardId === 'string' &&
    Number.isInteger(d.lb) &&
    (d.lb as number) >= 0 &&
    (d.lb as number) <= 4 &&
    Number.isInteger(d.level) &&
    (d.level as number) >= 1 &&
    typeof d.borrowed === 'boolean'
  );
};
/**
 * The S04 builder always puts the borrowed Friend in slot 6, but a deck copied from elsewhere (the
 * fixture golden plan deck, a veteran's recorded deck) may borrow none or another slot; at most
 * one slot may be borrowed.
 */
export const isDeckDraft = (v: unknown): v is DeckDraft =>
  Array.isArray(v) &&
  v.length === 6 &&
  v.every((s, i) => s === null || isSlot(s, i)) &&
  v.filter((s) => (s as DeckSlot | null)?.borrowed).length <= 1;

export const deckKey = (mode: 'api' | 'fixture') => storageKey(mode, 'deck');

export const loadDeck = (store: KeyValueStore, mode: 'api' | 'fixture') =>
  readJson(store, deckKey(mode), isDeckDraft, emptyDeck());
export const saveDeck = (store: KeyValueStore, mode: 'api' | 'fixture', d: DeckDraft) =>
  writeJson(store, deckKey(mode), d);

/** Adds an owned card to the first free owned slot (1–5). Returns null when they are full. */
export function addOwned(d: DeckDraft, card: { cardId: string; lb: number; level: number }): DeckDraft | null {
  if (d.slice(0, 5).some((s) => s?.cardId === card.cardId)) return d;
  const i = d.slice(0, 5).findIndex((s) => s === null);
  if (i < 0) return null;
  const next = [...d];
  next[i] = { slot: i + 1, cardId: card.cardId, lb: card.lb, level: card.level, borrowed: false };
  return next;
}

export function setFriend(d: DeckDraft, card: { cardId: string; lb: number; level: number } | null): DeckDraft {
  const next = [...d];
  next[5] = card ? { slot: 6, cardId: card.cardId, lb: card.lb, level: card.level, borrowed: true } : null;
  return next;
}

export function removeSlot(d: DeckDraft, i: number): DeckDraft {
  const next = [...d];
  next[i] = null;
  return next;
}

export const isComplete = (d: DeckDraft): d is DeckSlot[] => d.every((s) => s !== null);
export const missing = (d: DeckDraft) => d.filter((s) => s === null).length;

/** The engine rejects a repeated card id in a plan deck (T06 S2); flag it before ranking. */
export function duplicateCards(d: DeckDraft): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of d) {
    if (!s) continue;
    if (seen.has(s.cardId)) dup.add(s.cardId);
    seen.add(s.cardId);
  }
  return [...dup];
}
