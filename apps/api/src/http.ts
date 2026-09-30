import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError, validationError, zodProblems } from './problem.ts';
import type { Deps } from './deps.ts';

export type AppEnv = { Bindings: Env; Variables: { deps: Deps } };
export type Ctx = Context<AppEnv>;

/** Parses the JSON body with a zod schema; 400 for non-JSON, 422 (with per-field errors) otherwise. */
export async function parseBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'Bad Request', 'Request body is not valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(zodProblems(parsed.error));
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(c: Ctx, schema: S): z.infer<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw validationError(zodProblems(parsed.error), 'Invalid query string');
  return parsed.data;
}

export const nowIso = (c: Ctx): string => c.var.deps.now().toISOString();
