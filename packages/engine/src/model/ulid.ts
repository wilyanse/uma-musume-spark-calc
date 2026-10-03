/**
 * Minimal ULID (01 §1) for snapshot ids: 48-bit millisecond time + 80 random bits, Crockford
 * base32. Browser-safe (`globalThis.crypto.getRandomValues`). Callers that need determinism
 * inject `FitOptions.id` / `FitOptions.now` instead.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function encodeUlid(timeMs: number, random: Uint8Array): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 2 ** 48 - 1) {
    throw new RangeError(`ULID time out of range: ${timeMs}`);
  }
  if (random.length !== 10) throw new RangeError('ULID needs 10 random bytes');
  let t = timeMs;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  // 80 bits -> 16 base32 chars, big-endian.
  let rand = '';
  let acc = 0;
  let bits = 0;
  for (const byte of random) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += ALPHABET[(acc >>> bits) & 31]!;
    }
    acc &= (1 << bits) - 1;
  }
  return time + rand;
}

export function newUlid(timeMs: number): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return encodeUlid(timeMs, bytes);
}
