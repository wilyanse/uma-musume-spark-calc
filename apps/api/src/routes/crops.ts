import { Hono } from 'hono';
import { Ulid } from '@uma/schema';
import { ApiError } from '../problem.ts';
import type { AppEnv } from '../http.ts';

export const crops = new Hono<AppEnv>();

const MAX_CROP_BYTES = 60 * 1024; // 01 §8
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const CROP_KEY_RE = /^crops\/[0-7][0-9A-HJKMNP-TV-Z]{25}\/[^/]+\.png$/;

// PUT /crops/:captureId?path=…  (raw PNG body) -> {cropKey}
crops.put('/crops/:captureId', async (c) => {
  const captureId = c.req.param('captureId');
  if (!Ulid.safeParse(captureId).success) {
    throw new ApiError(422, 'Unprocessable Content', 'captureId must be a ULID', [
      { path: '/captureId', message: 'expected a ULID' },
    ]);
  }
  const path = c.req.query('path');
  if (!path || !/^(\/[^/]+)+$/.test(path)) {
    throw new ApiError(
      422,
      'Unprocessable Content',
      'Query parameter "path" must be a JSON pointer',
      [{ path: '/path', message: 'expected a non-empty JSON pointer such as "/stats/spd"' }],
    );
  }
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CROP_BYTES) {
    throw new ApiError(413, 'Content Too Large', `A crop is at most ${MAX_CROP_BYTES} bytes`);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_CROP_BYTES) {
    throw new ApiError(413, 'Content Too Large', `A crop is at most ${MAX_CROP_BYTES} bytes`);
  }
  if (bytes.byteLength < PNG_MAGIC.length || !PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new ApiError(415, 'Unsupported Media Type', 'The body is not a PNG image');
  }
  const cropKey = `crops/${captureId}/${encodeURIComponent(path)}.png`;
  await c.env.CROPS.put(cropKey, bytes, { httpMetadata: { contentType: 'image/png' } });
  return c.json({ cropKey });
});

// GET /crops/<cropKey>  (the key is `crops/<id>/<urlencoded path>.png`, so the URL reads /crops/crops/…)
crops.get('/crops/*', async (c) => {
  const rest = new URL(c.req.url).pathname.slice('/api/v1/crops/'.length);
  let key = rest;
  if (!key.startsWith('crops/')) {
    try {
      key = decodeURIComponent(rest); // the whole key sent as one encoded segment
    } catch {
      throw new ApiError(400, 'Bad Request', 'Malformed crop key');
    }
  }
  if (!CROP_KEY_RE.test(key)) throw new ApiError(400, 'Bad Request', 'Malformed crop key');
  const obj = await c.env.CROPS.get(key);
  if (!obj) throw new ApiError(404, 'Not Found', 'No such crop');
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=3600',
      etag: obj.httpEtag,
    },
  });
});
