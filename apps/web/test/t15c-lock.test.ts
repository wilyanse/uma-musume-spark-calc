import { describe, expect, it } from 'vitest';
import { withRulesLock } from '../src/app/rulesLock.ts';
import { memoryStore } from '../src/lib/storage.ts';

describe('browser-local commit serialization', () => {
  it('uses the same exclusive mode lock for apply, reset and local refit writes', async () => {
    const calls: unknown[] = [];
    const locks = { request: async <T,>(name: string, options: unknown, action: () => T | Promise<T>): Promise<T> => { calls.push([name, options]); return action(); } };
    expect(await withRulesLock(memoryStore(), 'fixture', () => 42, locks)).toBe(42);
    expect(calls).toEqual([['uma:fixture:rules-transaction', { mode: 'exclusive' }]]);
  });
  it('refuses durable browser mutations when exclusive cross-tab locks are unavailable', async () => {
    let called = false;
    await expect(withRulesLock(localStorage, 'fixture', () => { called = true; }, null)).rejects.toThrow(/cross-tab locks/);
    expect(called).toBe(false);
  });
  it('permits isolated in-memory test stores without claiming browser durability', async () => {
    expect(await withRulesLock(memoryStore(), 'api', () => 42, null)).toBe(42);
  });
});
