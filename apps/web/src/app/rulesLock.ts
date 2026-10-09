import type { KeyValueStore } from '../lib/storage.ts';
import type { DataMode } from '../lib/rulesOverride.ts';

interface ExclusiveLocks {
  request<T>(name: string, options: { mode: 'exclusive' }, action: () => T | Promise<T>): Promise<T>;
}

/** Serialize ALL browser-local mutations across tabs, then recheck revision inside the lock.
 * localStorage is not a CAS primitive: an unlocked read-check-write can race another tab.
 * Unsupported browsers refuse mutation; isolated memory stores can execute directly in tests.
 */
export async function withRulesLock<T>(
  store: KeyValueStore,
  mode: DataMode,
  action: () => T | Promise<T>,
  locks: ExclusiveLocks | null = typeof navigator !== 'undefined' ? navigator.locks ?? null : null,
): Promise<T> {
  if (locks) return locks.request(`uma:${mode}:rules-transaction`, { mode: 'exclusive' }, action);
  let browser: boolean;
  try { browser = typeof localStorage !== 'undefined' && store === localStorage; } catch { browser = true; }
  if (browser) throw new Error('Exclusive cross-tab locks are unavailable; browser-local rules changes were not saved. Use a browser supporting Web Locks.');
  return action();
}
