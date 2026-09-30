const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID (01 §1): 48-bit ms timestamp + 80 random bits, Crockford base32. */
export function ulid(nowMs: number): string {
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = '';
  for (let i = 0; i < 16; i++) random += ALPHABET[bytes[i]! % 32];
  return time + random;
}
