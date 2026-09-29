import { APT_KEYS, STAT_KEYS } from './enums.ts';
import type { Veteran } from './capture.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Canonical JSON (01 §5): object keys sorted recursively, no whitespace. */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const body = Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as Json)}`);
  return `{${body.join(',')}}`;
}

type FingerprintSource = Pick<
  Veteran,
  'characterId' | 'outfitId' | 'stats' | 'aptitudes' | 'sparks' | 'parents' | 'career'
>;

/** The object that gets hashed, per 01 §5. */
export function fingerprintPayload(v: FingerprintSource): Json {
  const parent = (slot: 1 | 2) => {
    const p = v.parents.find((x) => x.slot === slot);
    if (!p) throw new Error(`fingerprint: parent slot ${slot} missing`);
    return p.characterId;
  };
  return {
    c: v.characterId,
    o: v.outfitId,
    s: STAT_KEYS.map((k) => v.stats[k]),
    a: APT_KEYS.map((k) => v.aptitudes[k]),
    // Default sort is by UTF-16 code unit, which is ordinal for the ASCII strings used here.
    sp: v.sparks.map((s) => `${s.owner}|${s.sparkId}|${s.stars}`).sort(),
    p: [parent(1), parent(2)],
    d: v.career.dateAcquired,
  };
}

export function fingerprintCanonical(v: FingerprintSource): string {
  return canonicalJson(fingerprintPayload(v));
}

/** sha256 hex of a UTF-8 string via Web Crypto (Workers, browsers, Node 22). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fingerprint(v: FingerprintSource): Promise<string> {
  return sha256Hex(fingerprintCanonical(v));
}
