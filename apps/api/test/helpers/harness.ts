import { env } from 'cloudflare:workers';
import { fingerprint, type VeteranCapture } from '@uma/schema';
import { createApp } from '../../src/app.ts';
import { buildMasterIndex } from '../../src/master.ts';
import type { Deps } from '../../src/deps.ts';
import mcqueen from '../fixtures/mcqueen.json' with { type: 'json' };
import characters from '../fixtures/master/test-1/characters.json' with { type: 'json' };
import outfits from '../fixtures/master/test-1/outfits.json' with { type: 'json' };
import skills from '../fixtures/master/test-1/skills.json' with { type: 'json' };
import sparks from '../fixtures/master/test-1/sparks.json' with { type: 'json' };
import cards from '../fixtures/master/test-1/cards.json' with { type: 'json' };
import ranks from '../fixtures/master/test-1/ranks.json' with { type: 'json' };
import scenarios from '../fixtures/master/test-1/scenarios.json' with { type: 'json' };

export const masterFiles = { characters, outfits, skills, sparks, cards, ranks, scenarios };
export const fixtureMaster = buildMasterIndex(masterFiles);

/** Deterministic clock + IDs (AGENTS.md: inject time, seed everything). */
export function makeDeps(overrides: Partial<Deps> = {}) {
  let ms = Date.parse('2026-09-30T00:00:00Z');
  let n = 0;
  const deps: Deps = {
    now: () => new Date(ms),
    newId: () => {
      n += 1;
      // Crockford base32 of a counter, padded into the 26-char ULID shape.
      return `01J8Z3K4M5N6P7Q8R9${n
        .toString(32)
        .toUpperCase()
        .padStart(8, '0')
        .replace(/[ILOU]/g, '0')}`;
    },
    master: async (v) => (v === 'test-1' ? fixtureMaster : null),
    fetchJson: async () => {
      throw new Error('fetchJson not stubbed');
    },
    ...overrides,
  };
  return { deps, tick: (delta = 1000) => (ms += delta) };
}

export type Harness = ReturnType<typeof makeHarness>;

export function makeHarness(overrides: Partial<Deps> = {}, testEnv: Env = env) {
  const { deps, tick } = makeDeps(overrides);
  const app = createApp(deps);
  const call = (method: string, path: string, body?: unknown, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    let payload: BodyInit | undefined;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers.set('content-type', 'application/json');
    }
    return app.fetch(
      new Request(`https://localhost/api/v1${path}`, { ...init, method, headers, body: payload }),
      testEnv,
    );
  };
  return { app, deps, tick, call };
}

export const clone = <T>(v: T): T => structuredClone(v);

/** The fixture capture with a valid fingerprint; `edit` mutates a copy before it is re-fingerprinted. */
export async function makeCapture(
  edit?: (c: VeteranCapture) => void,
  opts: { refingerprint?: boolean } = {},
): Promise<VeteranCapture> {
  const c = clone(mcqueen) as unknown as VeteranCapture;
  edit?.(c);
  if (opts.refingerprint !== false) c.fingerprint = await fingerprint(c.veteran);
  return c;
}

export async function resetDb(): Promise<void> {
  const tables = [
    'veterans',
    'veteran_skills',
    'veteran_sparks',
    'veteran_deck',
    'veteran_parents',
    'capture_fields',
    'review_items',
    'owned_cards',
    'cm_targets',
    'model_snapshots',
  ];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const listed = await env.CROPS.list();
  if (listed.objects.length > 0) await env.CROPS.delete(listed.objects.map((o) => o.key));
}

export const ULID_A = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { path?: string; message: string; [k: string]: unknown }[];
}

/** Asserts an RFC 9457 response and returns its body. */
export async function problem(res: Response, status: number): Promise<Problem> {
  if (res.status !== status)
    throw new Error(`expected ${status}, got ${res.status}: ${await res.clone().text()}`);
  if (!(res.headers.get('content-type') ?? '').startsWith('application/problem+json')) {
    throw new Error(`content-type is ${res.headers.get('content-type')}, not problem+json`);
  }
  const body = (await res.json()) as Problem;
  if (body.status !== status || typeof body.title !== 'string' || typeof body.type !== 'string') {
    throw new Error(`not a problem document: ${JSON.stringify(body)}`);
  }
  return body;
}

/** Wraps D1 so tests can count executed statements (a batch counts each statement, as D1 bills it). */
export function countingEnv(base: Env): { env: Env; count: () => number; reset: () => void } {
  let n = 0;
  class Stmt {
    constructor(readonly inner: D1PreparedStatement) {}
    bind(...v: unknown[]) {
      return new Stmt(this.inner.bind(...v));
    }
    first(col?: string) {
      n += 1;
      return col === undefined ? this.inner.first() : this.inner.first(col);
    }
    all() {
      n += 1;
      return this.inner.all();
    }
    run() {
      n += 1;
      return this.inner.run();
    }
    raw() {
      n += 1;
      return this.inner.raw();
    }
  }
  const db = {
    prepare: (sql: string) => new Stmt(base.DB.prepare(sql)),
    batch: (stmts: Stmt[]) => {
      n += stmts.length;
      return base.DB.batch(stmts.map((s) => s.inner));
    },
  };
  return {
    env: { ...base, DB: db as unknown as D1Database } as Env,
    count: () => n,
    reset: () => {
      n = 0;
    },
  };
}
