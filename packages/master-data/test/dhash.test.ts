import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dhash, hamming, type CropBox } from '../src/dhash.ts';

interface Gen {
  kind: string;
  width: number;
  height: number;
  seed?: number;
  alpha?: boolean;
}
const vectors = JSON.parse(readFileSync(new URL('./dhash.vectors.json', import.meta.url), 'utf8')) as {
  vectors: { name: string; generator: Gen; crop: CropBox; hash: string }[];
};

/** Same generators as scripts/dhash_ref.py (re-implemented; the expected hashes come from Python). */
function gen(g: Gen): Uint8Array {
  const { width: w, height: h } = g;
  const out = new Uint8Array(w * h * 4);
  if (g.kind === 'lcg') {
    let s = (g.seed as number) >>> 0;
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 4; c++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        out[i * 4 + c] = s >>> 24;
      }
      if (!g.alpha) out[i * 4 + 3] = 255;
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number;
      if (g.kind === 'gradient-x-asc') v = Math.floor((x * 255) / (w - 1));
      else if (g.kind === 'gradient-x-desc') v = 255 - Math.floor((x * 255) / (w - 1));
      else if (g.kind === 'gradient-y') v = Math.floor((y * 255) / (h - 1));
      else if (g.kind === 'checker') v = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0 ? 255 : 0;
      else throw new Error(g.kind);
      out.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return out;
}

describe('dhash', () => {
  it('has at least 8 vectors', () => expect(vectors.vectors.length).toBeGreaterThanOrEqual(8));

  for (const v of vectors.vectors) {
    it(`matches the Python reference: ${v.name}`, () => {
      const image = { width: v.generator.width, height: v.generator.height, data: gen(v.generator) };
      expect(dhash(image, v.crop)).toBe(v.hash);
    });
  }

  it('hard-coded spec examples: ascending gradient is all 0, descending all 1', () => {
    const asc = { width: 90, height: 80, data: gen({ kind: 'gradient-x-asc', width: 90, height: 80 }) };
    const desc = { width: 90, height: 80, data: gen({ kind: 'gradient-x-desc', width: 90, height: 80 }) };
    expect(dhash(asc)).toBe('0000000000000000');
    expect(dhash(desc)).toBe('ffffffffffffffff');
  });

  it('MSB-first row-major: a single bright cell at row 0, col 0 sets exactly the top bit', () => {
    const w = 9;
    const h = 8;
    const data = new Uint8Array(w * h * 4).fill(0);
    for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
    data.set([255, 255, 255, 255], 0); // pixel (0,0) is cell (0,0)
    expect(dhash({ width: w, height: h, data })).toBe('8000000000000000');
  });

  it('rejects wrong buffer length and too-small crops', () => {
    expect(() => dhash({ width: 9, height: 8, data: new Uint8Array(3) })).toThrow();
    expect(() => dhash({ width: 8, height: 8, data: new Uint8Array(256) })).toThrow();
  });

  it('hamming counts differing bits', () => {
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('8000000000000001', '0000000000000000')).toBe(2);
  });
});
