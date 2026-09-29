import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  fingerprint,
  fingerprintCanonical,
  sha256Hex,
  VeteranCapture,
  Veteran,
} from '../src/index.ts';
import vectorFile from './fingerprint.vectors.json' with { type: 'json' };
import { baseCapture } from './fixtures.ts';

const vectors = vectorFile.vectors as unknown as {
  name: string;
  input: Veteran;
  canonical: string;
  sha256: string;
}[];
const byName = (n: string) => vectors.find((v) => v.name === n)!;

describe('fingerprint vectors (shared with the C# suite)', () => {
  it('has at least 5 vectors', () => expect(vectors.length).toBeGreaterThanOrEqual(5));

  it.each(vectors.map((v) => [v.name, v] as const))('%s: canonical JSON matches', (_n, v) => {
    expect(fingerprintCanonical(v.input)).toBe(v.canonical);
  });
  it.each(vectors.map((v) => [v.name, v] as const))('%s: sha256 matches', async (_n, v) => {
    expect(await fingerprint(v.input)).toBe(v.sha256);
  });
  it.each(vectors.map((v) => [v.name, v] as const))('%s: input is a valid Veteran', (_n, v) => {
    const capture = { ...baseCapture(), veteran: v.input, fingerprint: v.sha256 };
    const r = VeteranCapture.safeParse(capture);
    expect(r.error?.issues ?? []).toEqual([]);
    // round trip
    expect(VeteranCapture.parse(JSON.parse(JSON.stringify(r.data)))).toEqual(r.data);
  });

  it('spark order does not change the hash', () => {
    expect(byName('baseline-sparks-permuted').sha256).toBe(byName('baseline').sha256);
    expect(byName('baseline-sparks-permuted').input.sparks).not.toEqual(
      byName('baseline').input.sparks,
    );
  });
  it('star count changes the hash', () => {
    const hashes = new Set(vectors.map((v) => v.sha256));
    expect(byName('blue-2-star').sha256).not.toBe(byName('baseline').sha256);
    expect(byName('pink-3-star-vs-2-star').sha256).not.toBe(byName('baseline').sha256);
    expect(hashes.size).toBe(vectors.length - 2); // only the permutation and skill vectors collide with baseline
  });
  it('a guest parent still hashes by character id', () => {
    expect(byName('guest-parent').canonical).toContain('character:guest-example');
  });
  it('skills (including the ◯ suffix) are not part of the fingerprint', () => {
    expect(byName('skill-circle-suffix').sha256).toBe(byName('baseline').sha256);
  });
  it('parent slot order, not array order, decides p', () => {
    const v = structuredClone(byName('baseline').input);
    v.parents.reverse();
    expect(fingerprintCanonical(v)).toBe(byName('baseline').canonical);
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively with no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
  it('emits non-ASCII (◯) as raw UTF-8, not \\u escapes', () => {
    expect(canonicalJson({ k: 'Concentration ◯' })).toBe('{"k":"Concentration ◯"}');
  });
  it('keeps array order and escapes strings', () => {
    expect(canonicalJson(['b', 'a', 'x"y'])).toBe('["b","a","x\\"y"]');
  });
});

describe('sha256Hex', () => {
  it('matches the well-known digest of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('hashes UTF-8 bytes (expected from `printf ◯ | shasum -a 256`)', async () => {
    expect(await sha256Hex('◯')).toBe(
      'fad17ba43501bf33e3dbe2d85225e00266f31a7956568130c6f726aed95fa2f0',
    );
  });
});
