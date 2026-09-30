/**
 * 64-bit dHash of an RGBA image. This is the ONE definition shared with the C# agent (T09), which must
 * reproduce it bit-for-bit. The whole algorithm is integer-only so there is no floating-point,
 * rounding-mode or library (bilinear vs. area) ambiguity between TypeScript and C#.
 *
 * Input: `width` x `height` pixels, RGBA, 8 bits per channel, row-major, NOT premultiplied.
 *
 * 1. CROP. The crop box is given in integer permille (1/1000) of the image size:
 *      x0 = floor(box.x0 * W / 1000)   x1 = floor(box.x1 * W / 1000)     (exclusive)
 *      y0 = floor(box.y0 * H / 1000)   y1 = floor(box.y1 * H / 1000)     (exclusive)
 *    Integer division. No box means the whole image (0,0,1000,1000). The region is w = x1-x0 by
 *    h = y1-y0 pixels and must be at least 9 x 8.
 * 2. FLATTEN ALPHA over white, per channel c (integer arithmetic):
 *      c' = floor((c * a + 255 * (255 - a) + 127) / 255)
 * 3. GREYSCALE, ITU-R BT.601 luma, scaled by 1000 so it stays an integer (range 0..255000):
 *      Y = 299 * R' + 587 * G' + 114 * B'
 * 4. RESIZE to 9 columns x 8 rows by AREA AVERAGE (box filter) with integer cell boundaries. Cell (i, j)
 *    covers columns [floor(i*w/9), floor((i+1)*w/9)) and rows [floor(j*h/8), floor((j+1)*h/8)) of the
 *    cropped region. Its value is the mean of Y over the cell = sum / count. Means are never divided:
 *    they are compared by cross-multiplication (step 5).
 * 5. BITS. For each row j = 0..7 and column i = 0..7 (row-major), bit = 1 when mean(i, j) is STRICTLY
 *    greater than mean(i + 1, j), i.e. sum(i,j) * count(i+1,j) > sum(i+1,j) * count(i,j). Otherwise 0.
 * 6. HEX. The 64 bits are packed MSB-first (bit for row 0 / column 0 is the most significant bit) and
 *    written as 16 lowercase hex digits.
 *
 * Test vectors: `test/dhash.vectors.json`, produced by the independent `scripts/dhash_ref.py`.
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major, length = width * height * 4. */
  data: Uint8Array | Uint8ClampedArray | Buffer;
}

/** Crop box in integer permille of the image size (see step 1). */
export interface CropBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const DHASH_COLS = 9;
export const DHASH_ROWS = 8;
/** Bump when the definition above changes; it invalidates cached hashes. */
export const DHASH_VERSION = 1;

export function cropPixels(width: number, height: number, box: CropBox) {
  const x0 = Math.floor((box.x0 * width) / 1000);
  const x1 = Math.floor((box.x1 * width) / 1000);
  const y0 = Math.floor((box.y0 * height) / 1000);
  const y1 = Math.floor((box.y1 * height) / 1000);
  return { x0, y0, x1, y1 };
}

export function dhash(image: RgbaImage, box: CropBox = { x0: 0, y0: 0, x1: 1000, y1: 1000 }): string {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new Error(`dhash: expected ${width * height * 4} RGBA bytes, got ${data.length}`);
  }
  const { x0, y0, x1, y1 } = cropPixels(width, height, box);
  const w = x1 - x0;
  const h = y1 - y0;
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || w < DHASH_COLS || h < DHASH_ROWS) {
    throw new Error(`dhash: crop ${w}x${h} is too small or outside the ${width}x${height} image`);
  }

  const sums = new Array<number>(DHASH_COLS * DHASH_ROWS).fill(0);
  const counts = new Array<number>(DHASH_COLS * DHASH_ROWS).fill(0);
  const colOf = (x: number) => Math.floor(((x + 1) * DHASH_COLS - 1) / w); // largest i with floor(i*w/9) <= x
  const rowOf = (y: number) => Math.floor(((y + 1) * DHASH_ROWS - 1) / h);
  for (let y = 0; y < h; y++) {
    const j = rowOf(y);
    for (let x = 0; x < w; x++) {
      const i = colOf(x);
      const p = ((y0 + y) * width + (x0 + x)) * 4;
      const a = data[p + 3] as number;
      const flat = (c: number) => Math.floor((c * a + 255 * (255 - a) + 127) / 255);
      const luma = 299 * flat(data[p] as number) + 587 * flat(data[p + 1] as number) + 114 * flat(data[p + 2] as number);
      sums[j * DHASH_COLS + i] += luma;
      counts[j * DHASH_COLS + i] += 1;
    }
  }

  let bits = 0n;
  for (let j = 0; j < DHASH_ROWS; j++) {
    for (let i = 0; i < DHASH_COLS - 1; i++) {
      const l = j * DHASH_COLS + i;
      const bit = (sums[l] as number) * (counts[l + 1] as number) > (sums[l + 1] as number) * (counts[l] as number);
      bits = (bits << 1n) | (bit ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** Hamming distance between two equal-length hex hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('hamming: hash length mismatch');
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i] as string, 16) ^ parseInt(b[i] as string, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
