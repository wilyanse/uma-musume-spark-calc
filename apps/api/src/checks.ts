import type { CaptureField, Veteran } from '@uma/schema';
import type { ProblemError as Problem } from './problem.ts';
import { CROP_KEY_RE } from './routes/crops.ts';

const unescapePointer = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
export const OWNER_PSEUDO = /^\/sparks\/(parent1|parent2)$/;

/** Walks a JSON pointer; returns the parent container and last key when the target exists. */
export function locate(
  root: Record<string, unknown>,
  pointer: string,
): { node: Record<string, unknown>; key: string } | null {
  const segs = pointer.split('/').slice(1).map(unescapePointer);
  if (segs.length === 0 || segs.some((s) => UNSAFE.has(s))) return null;
  let node: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return null;
    if (Array.isArray(node) ? !/^\d+$/.test(seg) : !Object.hasOwn(node, seg)) return null;
    node = (node as Record<string, unknown>)[seg];
  }
  const last = segs[segs.length - 1]!;
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(last) || Number(last) >= node.length) return null;
  } else if (!Object.hasOwn(node, last)) return null;
  return { node: node as Record<string, unknown>, key: last };
}

/** Sets `value` at a JSON pointer inside `root`; the target must already exist (no creation). */
export function setAtPointer(root: Record<string, unknown>, pointer: string, value: unknown) {
  const at = locate(root, pointer);
  if (!at) return false;
  at.node[at.key] = value;
  return true;
}

/**
 * Checks the database would otherwise trip over (primary keys) that zod doesn't express. Shared by
 * ingest and review-resolve so both answer 422 rather than a misleading 409 (T04 review S2).
 * `prefix` is the JSON pointer of the veteran inside the request body.
 */
export function extraVeteranChecks(veteran: Veteran, prefix: string): Problem[] {
  const out: Problem[] = [];
  const skills = new Set<string>();
  veteran.skills.forEach((s, i) => {
    if (skills.has(s.skillId)) {
      out.push({ path: `${prefix}/skills/${i}/skillId`, message: 'the same skill appears twice' });
    }
    skills.add(s.skillId);
  });
  const sparks = new Set<string>();
  veteran.sparks.forEach((s, i) => {
    const k = `${s.owner}|${s.sparkId}`;
    if (sparks.has(k)) {
      out.push({
        path: `${prefix}/sparks/${i}/sparkId`,
        message: `${s.owner} lists the same spark twice`,
      });
    }
    sparks.add(k);
  });
  return out;
}

/**
 * Field-path checks for ingest: no duplicates, well-formed crop keys, and every path must resolve
 * in the veteran (or be the `/sparks/<owner>` pseudo-pointer) so a review item can always be
 * resolved (T04 review S3c). `/trainMode` can't be corrected through a review item (use PATCH).
 */
export function captureFieldChecks(fields: CaptureField[], veteran: Veteran): Problem[] {
  const out: Problem[] = [];
  const seen = new Set<string>();
  const root = veteran as unknown as Record<string, unknown>;
  fields.forEach((f, i) => {
    if (seen.has(f.path)) {
      out.push({ path: `/fields/${i}/path`, message: 'the same field path appears twice' });
    }
    seen.add(f.path);
    if (f.cropKey !== null && !CROP_KEY_RE.test(f.cropKey)) {
      out.push({
        path: `/fields/${i}/cropKey`,
        message: 'cropKey is not a crops/<ULID>/<path>.png key',
      });
    }
    if (f.path === '/trainMode' || (!OWNER_PSEUDO.test(f.path) && !locate(root, f.path))) {
      out.push({
        path: `/fields/${i}/path`,
        message: 'the field path does not point at a correctable part of the veteran',
      });
    }
  });
  return out;
}
