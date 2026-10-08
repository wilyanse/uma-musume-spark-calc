/**
 * T15c: the browser-local rules override as seen by this tab.
 *
 * - The stored override string (mode-namespaced, lib/rulesOverride.ts) is read through
 *   `useSyncExternalStore`, so the engine-context query is keyed by the EXACT stored value. A write
 *   in this tab (`notifyRulesChanged`) or in another tab (the `storage` event) changes the key,
 *   which reconfigures the worker; nothing reuses a context configured for an older value.
 * - `storedOverrideRaw` is also re-read right before fit/rank/apply/reset writes, so stale local
 *   state is detected and refused even if an event was missed.
 */
import { useSyncExternalStore } from 'react';
import type { AppServices } from './services.ts';
import { overrideKey } from '../lib/rulesOverride.ts';

/** Sentinel for a storage that throws on read (shown as an invalid record, never as "none"). */
export const UNREADABLE = '\u0000unreadable-storage';

export function storedOverrideRaw(services: Pick<AppServices, 'store' | 'source'>): string | null {
  try {
    return services.store.getItem(overrideKey(services.source.kind));
  } catch {
    return UNREADABLE;
  }
}

const listeners = new WeakMap<object, Set<() => void>>();
const setOf = (owner: object) => {
  let s = listeners.get(owner);
  if (!s) {
    s = new Set();
    listeners.set(owner, s);
  }
  return s;
};

/** Call after this tab wrote the override state (the `storage` event only fires in OTHER tabs). */
export function notifyRulesChanged(owner: object): void {
  for (const l of [...setOf(owner)]) l();
}

export function useStoredOverrideRaw(services: AppServices): string | null {
  return useSyncExternalStore(
    (l) => {
      const s = setOf(services.store);
      s.add(l);
      const key = overrideKey(services.source.kind);
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) l();
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        s.delete(l);
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    () => storedOverrideRaw(services),
  );
}
