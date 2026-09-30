import type { MiddlewareHandler } from 'hono';
import { ApiError } from './problem.ts';
import type { Deps } from './deps.ts';

const TEAM_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i;
const JWKS_TTL_MS = 60 * 60 * 1000; // 40 §3: cache the JWKS for 1 h
const JWKS_MIN_REFETCH_MS = 60 * 1000; // unknown `kid` (rotation): refetch at most once a minute
const CLOCK_LEEWAY_S = 60;
const MAX_VERIFIED_TOKENS = 32;

type Jwk = JsonWebKey & { kid?: string };
interface KeyCache {
  fetchedAt: number;
  keys: Map<string, CryptoKey>;
}

export type AuthMode =
  | { kind: 'disabled' }
  | { kind: 'enforce'; teamDomain: string; aud: string }
  | { kind: 'misconfigured'; reason: string };

/**
 * Decides how to authenticate (40 §3), failing closed:
 *  - `AUTH_DISABLED` is honoured only when no Access config is present at all (local dev/tests).
 *    Set next to a team domain or AUD (i.e. production-shaped config) it's a misconfiguration.
 *  - An empty `ACCESS_TEAM_DOMAIN` or a missing `ACCESS_AUD` is a misconfiguration, never a
 *    reason to skip the issuer/audience checks (T02 review N5).
 */
export function resolveAuthMode(env: Env): AuthMode {
  const team = (env.ACCESS_TEAM_DOMAIN ?? '').trim();
  const aud = (env.ACCESS_AUD ?? '').trim();
  const disabledFlag = (env.AUTH_DISABLED ?? '') !== '';
  if (disabledFlag) {
    if (env.AUTH_DISABLED === '1' && team === '' && aud === '') return { kind: 'disabled' };
    return {
      kind: 'misconfigured',
      reason: 'AUTH_DISABLED must not be set when ACCESS_TEAM_DOMAIN or ACCESS_AUD is configured',
    };
  }
  if (team === '') return { kind: 'misconfigured', reason: 'ACCESS_TEAM_DOMAIN is not set' };
  if (!TEAM_DOMAIN_RE.test(team)) {
    return {
      kind: 'misconfigured',
      reason: 'ACCESS_TEAM_DOMAIN must be a bare <team>.cloudflareaccess.com host name',
    };
  }
  if (aud === '') return { kind: 'misconfigured', reason: 'ACCESS_AUD is not set' };
  return { kind: 'enforce', teamDomain: team.toLowerCase(), aud };
}

const b64urlBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

const unauthorized = (detail: string) => new ApiError(401, 'Unauthorized', detail);

/** Verifies `Cf-Access-Jwt-Assertion` (RS256) against the team JWKS, `iss`, `aud`, `exp`, `nbf`. */
export function createJwtVerifier(deps: Pick<Deps, 'now' | 'fetchJson'>) {
  const keyCaches = new Map<string, KeyCache>();
  const verified = new Map<string, number>(); // token key -> exp (s); skips repeat RSA verifies

  async function loadKeys(teamDomain: string): Promise<KeyCache> {
    const body = (await deps.fetchJson(`https://${teamDomain}/cdn-cgi/access/certs`)) as {
      keys?: Jwk[];
    };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA') continue;
      keys.set(
        jwk.kid,
        await crypto.subtle.importKey(
          'jwk',
          jwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      );
    }
    const cache = { fetchedAt: deps.now().getTime(), keys };
    keyCaches.set(teamDomain, cache);
    return cache;
  }

  async function keyFor(teamDomain: string, kid: string): Promise<CryptoKey | undefined> {
    const now = deps.now().getTime();
    let cache = keyCaches.get(teamDomain);
    if (!cache || now - cache.fetchedAt > JWKS_TTL_MS) cache = await loadKeys(teamDomain);
    let key = cache.keys.get(kid);
    if (!key && now - cache.fetchedAt > JWKS_MIN_REFETCH_MS) {
      cache = await loadKeys(teamDomain);
      key = cache.keys.get(kid);
    }
    return key;
  }

  return async function verify(token: string, teamDomain: string, aud: string): Promise<void> {
    const nowS = Math.floor(deps.now().getTime() / 1000);
    const cacheKey = `${teamDomain}|${aud}|${token}`;
    const cachedExp = verified.get(cacheKey);
    if (cachedExp !== undefined && cachedExp + CLOCK_LEEWAY_S > nowS) return;

    const parts = token.split('.');
    if (parts.length !== 3) throw unauthorized('Malformed Access token');
    let header: { alg?: unknown; kid?: unknown };
    let claims: { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown };
    try {
      header = b64urlJson(parts[0]!) as typeof header;
      claims = b64urlJson(parts[1]!) as typeof claims;
    } catch {
      throw unauthorized('Malformed Access token');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw unauthorized('Unsupported Access token algorithm');
    }

    let key: CryptoKey | undefined;
    try {
      key = await keyFor(teamDomain, header.kid);
    } catch {
      throw new ApiError(503, 'Service Unavailable', 'Could not fetch the Access signing keys');
    }
    if (!key) throw unauthorized('Unknown Access signing key');

    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlBytes(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) throw unauthorized('Invalid Access token signature');

    if (claims.iss !== `https://${teamDomain}`) throw unauthorized('Access token issuer mismatch');
    const audClaim = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audClaim.includes(aud)) throw unauthorized('Access token audience mismatch');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_LEEWAY_S <= nowS) {
      throw unauthorized('Access token expired');
    }
    if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_LEEWAY_S > nowS) {
      throw unauthorized('Access token not yet valid');
    }

    if (verified.size >= MAX_VERIFIED_TOKENS) verified.clear();
    verified.set(cacheKey, claims.exp);
  };
}

/** Middleware for every `/api/v1/*` route except health (40 §3). */
export function accessAuth(deps: Pick<Deps, 'now' | 'fetchJson'>): MiddlewareHandler<{
  Bindings: Env;
}> {
  const verify = createJwtVerifier(deps);
  return async (c, next) => {
    if (c.req.path === '/api/v1/health') return next();
    const mode = resolveAuthMode(c.env);
    if (mode.kind === 'disabled') return next();
    if (mode.kind === 'misconfigured') {
      throw new ApiError(
        500,
        'Server misconfigured',
        `Authentication is misconfigured: ${mode.reason}`,
      );
    }
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) throw unauthorized('Missing Cf-Access-Jwt-Assertion header');
    await verify(token, mode.teamDomain, mode.aud);
    return next();
  };
}
