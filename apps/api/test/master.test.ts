import { describe, expect, it } from 'vitest';
import { assetsMasterLoader, buildMasterIndex } from '../src/master.ts';
import { masterFiles } from './helpers/harness.ts';

const fakeAssets = (files: Record<string, unknown>, calls: string[] = []) =>
  ({
    fetch: async (url: string) => {
      calls.push(url);
      const body = files[new URL(url).pathname];
      return body === undefined
        ? new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) // SPA fallback
        : Response.json(body);
    },
  }) as unknown as Fetcher;

const served = (version: string) =>
  Object.fromEntries(
    Object.entries(masterFiles).map(([k, v]) => [`/master/${version}/${k}.json`, v]),
  );

describe('master index', () => {
  it('builds ID sets from the 01 §11 files', () => {
    const idx = buildMasterIndex(masterFiles);
    expect(idx.characters).toContain('character:mejiro-mcqueen');
    expect(idx.ranks).toContain('A+');
    expect(idx.scenarios).toContain('scenario:ura-finale');
  });

  it('loads /master/<version>/*.json through ASSETS and caches per version', async () => {
    const calls: string[] = [];
    const load = assetsMasterLoader();
    const env = { ASSETS: fakeAssets(served('test-1'), calls) } as unknown as Env;
    const a = await load('test-1', env);
    const b = await load('test-1', env);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(calls).toHaveLength(7); // one per file, none on the second call
    expect(calls[0]).toContain('/master/test-1/');
  });

  it('returns null for a missing version (SPA fallback answers HTML) and does not cache the miss', async () => {
    const load = assetsMasterLoader();
    const files: Record<string, unknown> = {};
    const env = { ASSETS: fakeAssets(files) } as unknown as Env;
    expect(await load('nope', env)).toBeNull();
    Object.assign(files, served('nope'));
    expect(await load('nope', env)).not.toBeNull();
  });

  it('refuses versions that are not a plain path segment', async () => {
    const load = assetsMasterLoader();
    const env = { ASSETS: fakeAssets({}) } as unknown as Env;
    for (const v of ['../x', 'a/b', '', '.hidden', 'a b']) expect(await load(v, env)).toBeNull();
  });
});
