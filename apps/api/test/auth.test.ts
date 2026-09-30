import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import wranglerConfig from '../wrangler.jsonc?raw';
import { resolveAuthMode } from '../src/auth.ts';
import { makeHarness, problem } from './helpers/harness.ts';

const TEAM = 'myteam.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const b64 = (b: ArrayBuffer | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

async function keyPair() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { priv: pair.privateKey, jwk };
}

// makeDeps() fixes the injected clock at 2026-09-30T00:00:00Z.
const NOW_S = Math.floor(Date.parse('2026-09-30T00:00:00Z') / 1000);
async function sign(
  priv: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  const h = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header }));
  const p = b64(JSON.stringify(claims));
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    priv,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64(sig)}`;
}
const good = { iss: `https://${TEAM}`, aud: [AUD], exp: NOW_S + 300, nbf: NOW_S - 10 };

const prodEnv = (over: Record<string, unknown> = {}) =>
  ({
    ...env,
    AUTH_DISABLED: undefined,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...over,
  }) as unknown as Env;

async function setup(over: Record<string, unknown> = {}) {
  const { priv, jwk } = await keyPair();
  const urls: string[] = [];
  const h = makeHarness(
    {
      fetchJson: async (url) => {
        urls.push(url);
        return { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] };
      },
    },
    prodEnv(over),
  );
  return { h, priv, urls };
}

const withJwt = (t: string) => ({ headers: { 'Cf-Access-Jwt-Assertion': t } });

describe('Access JWT verification (40 §3)', () => {
  it('health is open; every other route 401s without a token', async () => {
    const { h } = await setup();
    expect((await h.call('GET', '/health')).status).toBe(200);
    for (const [m, p] of [
      ['GET', '/roster'],
      ['POST', '/veterans'],
      ['GET', '/veterans/x'],
      ['PATCH', '/veterans/x'],
      ['DELETE', '/veterans/x'],
      ['GET', '/review-items'],
      ['POST', '/review-items/x/resolve'],
      ['GET', '/owned-cards'],
      ['PUT', '/owned-cards'],
      ['GET', '/cm-targets'],
      ['POST', '/cm-targets'],
      ['GET', '/model-snapshots'],
      ['POST', '/model-snapshots'],
      ['PUT', '/crops/x'],
      ['GET', '/crops/x'],
      ['GET', '/does-not-exist'],
    ] as const) {
      const res = await h.call(m, p);
      expect(res.status, `${m} ${p}`).toBe(401);
    }
  });

  it('accepts a valid token, fetching the JWKS from the team domain once (cached)', async () => {
    const { h, priv, urls } = await setup();
    const t = await sign(priv, good);
    expect((await h.call('GET', '/roster', undefined, withJwt(t))).status).toBe(200);
    expect((await h.call('GET', '/roster', undefined, withJwt(t))).status).toBe(200);
    expect(urls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });

  it('accepts a string aud claim', async () => {
    const { h, priv } = await setup();
    const t = await sign(priv, { ...good, aud: AUD });
    expect((await h.call('GET', '/roster', undefined, withJwt(t))).status).toBe(200);
  });

  it.each([
    ['wrong audience', { ...good, aud: ['other'] }],
    ['wrong issuer', { ...good, iss: 'https://evil.cloudflareaccess.com' }],
    ['expired', { ...good, exp: NOW_S - 3600 }],
    ['not yet valid', { ...good, nbf: NOW_S + 3600 }],
    ['no exp', { iss: good.iss, aud: good.aud }],
  ])('rejects a token with %s', async (_n, claims) => {
    const { h, priv } = await setup();
    const res = await h.call('GET', '/roster', undefined, withJwt(await sign(priv, claims)));
    await problem(res, 401);
  });

  it('rejects a bad signature, an unknown kid, alg none/HS256 and garbage', async () => {
    const { h, priv } = await setup();
    const other = await keyPair();
    const rejected = async (t: string) =>
      problem(await h.call('GET', '/roster', undefined, withJwt(t)), 401);
    await rejected(await sign(other.priv, good));
    await rejected(await sign(priv, good, { kid: 'zzz' }));
    await rejected(await sign(priv, good, { alg: 'none' }));
    await rejected(await sign(priv, good, { alg: 'HS256' }));
    await rejected('a.b.c');
    await rejected('garbage');
    const tampered = (await sign(priv, good)).split('.');
    tampered[1] = b64(JSON.stringify({ ...good, exp: NOW_S + 99999 }));
    await rejected(tampered.join('.'));
  });

  it('answers 503 (not 200) when the JWKS cannot be fetched', async () => {
    const { priv } = await keyPair();
    const h = makeHarness(
      {
        fetchJson: async () => {
          throw new Error('offline');
        },
      },
      prodEnv(),
    );
    await problem(await h.call('GET', '/roster', undefined, withJwt(await sign(priv, good))), 503);
  });
});

describe('fail-closed configuration (T02 review N5; 40 §3)', () => {
  it.each([
    ['empty ACCESS_TEAM_DOMAIN', { ACCESS_TEAM_DOMAIN: '' }],
    ['missing ACCESS_AUD', { ACCESS_AUD: undefined }],
    ['empty ACCESS_AUD', { ACCESS_AUD: '' }],
    [
      'team domain that is not a cloudflareaccess.com host',
      { ACCESS_TEAM_DOMAIN: 'evil.example.com' },
    ],
    ['team domain with a path', { ACCESS_TEAM_DOMAIN: `${TEAM}/x` }],
    ['AUTH_DISABLED next to a production config', { AUTH_DISABLED: '1' }],
    [
      'AUTH_DISABLED with a value other than 1',
      { AUTH_DISABLED: 'true', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' },
    ],
  ])('%s → 500 problem, even with a token', async (_n, over) => {
    const { h, priv } = await setup(over);
    const res = await h.call('GET', '/roster', undefined, withJwt(await sign(priv, good)));
    const p = await problem(res, 500);
    expect(p.detail).toContain('misconfigured');
    // Health stays reachable so a broken deploy can still be diagnosed.
    expect((await h.call('GET', '/health')).status).toBe(200);
  });

  it('the shipped wrangler vars (empty team domain, no AUD, no AUTH_DISABLED) fail closed', () => {
    const shipped = {
      ...env,
      AUTH_DISABLED: undefined,
      ACCESS_AUD: undefined,
      ACCESS_TEAM_DOMAIN: '',
    } as unknown as Env;
    expect(resolveAuthMode(shipped, 'localhost').kind).toBe('misconfigured');
  });

  it('AUTH_DISABLED=1 alone on a local host (dev / tests) disables the check', () => {
    const e = { AUTH_DISABLED: '1', ACCESS_TEAM_DOMAIN: '' } as unknown as Env;
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'dev.localhost']) {
      expect(resolveAuthMode(e, host).kind).toBe('disabled');
    }
  });

  it('AUTH_DISABLED=1 on any non-local host fails closed (S4: a stray var in production)', async () => {
    const e = { AUTH_DISABLED: '1', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } as unknown as Env;
    for (const host of [
      'uma.example.workers.dev',
      'example.com',
      'localhost.evil.com',
      'notlocalhost',
    ]) {
      expect(resolveAuthMode(e, host).kind).toBe('misconfigured');
    }
    // End to end: the same env served under a public host name answers 500, not data.
    const h = makeHarness({}, e);
    const res = await h.app.fetch(new Request('https://uma.example.workers.dev/api/v1/roster'), e);
    expect((await problem(res, 500)).detail).toContain('misconfigured');
  });

  it('wrangler.jsonc never defines AUTH_DISABLED (no production path, 40 §3)', () => {
    const code = wranglerConfig.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('AUTH_DISABLED');
  });
});

describe('problem+json for unknown routes (T02 review N2)', () => {
  it('unknown /api/v1 paths return 404 problem+json (auth disabled here)', async () => {
    const h = makeHarness();
    const p = await problem(await h.call('GET', '/nope'), 404);
    expect(p.title).toBe('Not Found');
  });
});
