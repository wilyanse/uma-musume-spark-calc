/**
 * Browser-local persistence (Q-77: deck draft and planner settings have no API contract, so they
 * live in local storage on one device). Every read is validated by the caller-supplied guard and a
 * corrupt value falls back to the default instead of throwing.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export function defaultStore(): KeyValueStore {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access denied (privacy mode): fall through to memory.
  }
  return memoryStore();
}

export function readJson<T>(
  store: KeyValueStore,
  key: string,
  guard: (v: unknown) => v is T,
  fallback: T,
): T {
  const raw = store.getItem(key);
  if (raw === null) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return guard(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  store.setItem(key, JSON.stringify(value));
}

/** Storage keys, namespaced per data mode so fixture-mode state never leaks into API mode. */
export const storageKey = (mode: 'api' | 'fixture', name: string): string => `uma:${mode}:${name}`;
