import type { CaptureField, Veteran } from '@uma/schema';
import type { ProblemError as Problem } from './problem.ts';
import { CROP_KEY_RE } from './routes/crops.ts';

const unescapePointer = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
export const OWNER_PSEUDO = /^\/sparks\/(parent1|parent2)$/;

/**
 * SQL expression for the array index in `/sparks/<n>…` and `/skills/<n>…` review paths. Both
 * prefixes are eight characters, so one parser is shared by resolve remapping and re-ingest.
 */
export const ARRAY_INDEX_SQL = `(CASE WHEN instr(substr(path, 9), '/') > 0
  THEN substr(path, 9, instr(substr(path, 9), '/') - 1) ELSE substr(path, 9) END)`;

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
  veteran.deck.forEach((d, i) => {
    if (d.slot !== i + 1) {
      out.push({ path: `${prefix}/deck/${i}/slot`, message: 'deck entries must be in slot order' });
    }
  });
  veteran.parents.forEach((p, i) => {
    if (p.slot !== i + 1) {
      out.push({
        path: `${prefix}/parents/${i}/slot`,
        message: 'parent entries must be in slot order',
      });
    }
  });
  return out;
}

/** Moving a spark between owner blocks requires the owner-block correction/remapping path. */
const SPARK_OWNER_LEAF = /^\/sparks\/\d+\/owner$/;

/**
 * Where a review correction at `path` would be written inside `root`, or null when `path` is not
 * correctable through a review item. This does the pointer resolution itself (via `locate`, which
 * also rejects unsafe segments such as `__proto__`); the `/sparks/<owner>` pseudo-pointer is not a
 * real pointer and is handled by callers. Not correctable:
 * - `/trainMode`: derived from the epithet (01 §6) and changed only through `PATCH /veterans/:id`;
 * - a pointer that does not resolve in `root`;
 * - a pointer whose target is a whole array or a whole array element (`/sparks`, `/sparks/3`,
 *   `/skills`, `/deck/0`, `/parents`, …), or `/sparks/<n>/owner`.
 *   Such a value could reorder or resize the array or move a spark to another owner.
 *   Other leaf values (including OCR-matched `/sparks/3/sparkId`) stay correctable: a label
 *   correction keeps the element at the same index, and duplicate IDs are separately rejected.
 *   The only array-restructuring correction is the
 *   `/sparks/<owner>` pseudo-pointer, whose index remapping the resolve route performs.
 * Ingest applies the same rule to `low_confidence` fields (the ones that open review items), so a
 * path refused here is refused before an item can be created (Q-110).
 */
export function correctionTarget(
  root: Record<string, unknown>,
  path: string,
): { node: Record<string, unknown>; key: string } | null {
  if (path === '/trainMode' || SPARK_OWNER_LEAF.test(path)) return null;
  const at = locate(root, path);
  if (!at || Array.isArray(at.node) || Array.isArray(at.node[at.key])) return null;
  return at;
}

/**
 * Field-path checks for ingest: no duplicate paths (primary key), well-formed crop keys, and every
 * `low_confidence` path (the ones that open review items) must be the `/sparks/<owner>`
 * pseudo-pointer or pass `correctionTarget` (T04 review S3c, T04b review r1 S2).
 * `ok`/`corrected` fields are provenance only: they never open a review item and the API never
 * writes their value into a veteran (resolve only applies an open item's path, and items are only
 * created from `low_confidence` fields). So any syntactically valid pointer (01 §3; e.g.
 * `/trainMode`, even `/__proto__/x`) is stored as-is for them (T04 review r2 S2, T04b r1 N4).
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
    if (
      f.status === 'low_confidence' &&
      !OWNER_PSEUDO.test(f.path) &&
      !correctionTarget(root, f.path)
    ) {
      out.push({
        path: `/fields/${i}/path`,
        message: 'a low_confidence field must point at a correctable part of the veteran',
      });
    }
  });
  return out;
}
