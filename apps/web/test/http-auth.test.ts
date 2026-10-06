/**
 * S2 (round 2): manual opaqueredirect / same-origin HTML 200 / SPA fallback HTML on
 * a "successful" response are an auth problem, not a generic failure; a JSON-typed body that does
 * not parse is a malformed-response problem; ordinary 5xx stay server errors. MOCK HTTP only (an
 * in-test fetch double), not a live API or Cloudflare Access.
 */
import { describe, expect, it } from 'vitest';
import { httpSource } from '../src/api/http.ts';
import { AuthRedirectError, HttpError, MalformedResponseError, NetworkError, errorText } from '../src/api/errors.ts';

const AUTH = 'Your session has expired. Reload the page to sign in again.';
const SECRET_HTML = '<!doctype html><html><body>Cloudflare Access login SECRET-NONCE-123</body></html>';

/** Browser manual redirect: status 0, no readable Location/headers/body. Unit double only. */
function opaqueRedirect(): Response {
  return {
    type: 'opaqueredirect', status: 0, ok: false, redirected: false,
    get headers() { throw new Error('Opaque headers must not be inspected'); },
    text() { throw new Error('Opaque body must not be inspected'); },
    json() { throw new Error('Opaque body must not be inspected'); },
  } as unknown as Response;
}

describe('httpSource auth / malformed detection (MOCK HTTP)', () => {
  it('an opaque manual redirect is auth without inspecting unavailable headers/body', async () => {
    const calls: RequestInit[] = [];
    const s = httpSource(async (_u, init) => {
      calls.push(init!);
      return opaqueRedirect();
    });
    const err = await s.ownedCards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthRedirectError);
    expect(errorText(err)).toBe(AUTH);
    expect(String((err as Error).message)).not.toMatch(/SECRET-NONCE|cloudflareaccess/);
    expect(calls[0]!.credentials).toBe('include');
    expect(calls[0]!.redirect).toBe('manual');
  });

  it('a 200 HTML body without a redirect (SPA fallback) is also an auth error', async () => {
    const s = httpSource(async () => new Response(SECRET_HTML, { status: 200, headers: { 'content-type': 'text/html' } }));
    for (const call of [() => s.roster(), () => s.health(), () => s.deleteTarget('01KGQZ0000G01DENCM0000NEW1')]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthRedirectError);
      expect(errorText(err)).toBe(AUTH);
    }
  });

  it('every fetch-backed DataSource method uses manual redirects and credentials include', async () => {
    const s = httpSource(async (_u, init) => {
      expect(init?.redirect).toBe('manual');
      expect(init?.credentials).toBe('include');
      return opaqueRedirect();
    });
    const target = { name: 'MOCK', course: { surface: 'turf' as const, distance: 'long' as const }, style: 'end' as const, minStats: {}, minAptitudes: {}, requiredSkills: [], optionalSkills: [] };
    const methods = [() => s.health(), () => s.roster(), () => s.veteran('id'),
      () => s.patchVeteran('id', { trainMode: 'manual' }), () => s.deleteVeteran('id'),
      () => s.reviewItems('open'), () => s.resolveReviewItem('id', 1), () => s.ownedCards(),
      () => s.targets(), () => s.createTarget(target), () => s.updateTarget('id', target),
      () => s.deleteTarget('id'), () => s.latestSnapshot(),
      () => s.storeSnapshot({} as Parameters<typeof s.storeSnapshot>[0])];
    for (const call of methods) expect(await call().catch((e: unknown) => e)).toBeInstanceOf(AuthRedirectError);
  });

  it('an HTML error page with 401/403 is the auth text; with 500 it is a server error, not auth', async () => {
    for (const status of [401, 403]) {
      const s = httpSource(async () => new Response(SECRET_HTML, { status, headers: { 'content-type': 'text/html' } }));
      const err = await s.targets().catch((e: unknown) => e);
      expect(errorText(err)).toBe(AUTH);
    }
    const s = httpSource(async () => new Response(SECRET_HTML, { status: 502, headers: { 'content-type': 'text/html' } }));
    const err = await s.targets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
    expect((err as HttpError).problem).toBeNull();
    expect(errorText(err)).toBe('Something went wrong. Retry, or reload the page.');
    expect((err as Error).message).not.toMatch(/SECRET-NONCE/);
  });

  it('a JSON content-type whose body does not parse is a malformed response (no SyntaxError leak)', async () => {
    const s = httpSource(async () => new Response('{"broken": SECRET-NONCE', { status: 200, headers: { 'content-type': 'application/json' } }));
    const err = await s.ownedCards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MalformedResponseError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect((err as Error).message).not.toMatch(/SECRET-NONCE/);
    expect(errorText(err)).toBe('The server sent a response the app could not read. Retry, or reload the page.');
  });

  it('a 304 roster and a 204 delete are still fine', async () => {
    const s = httpSource(async (_u, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(null, { status: 304 }),
    );
    expect(await s.deleteTarget('01KGQZ0000G01DENCM0000NEW1')).toBeUndefined();
    const cached = { etag: '"e"', roster: [] };
    expect((await s.roster(cached)).roster).toBe(cached.roster);
  });

  it('a fetch TypeError rejection is network; pre-existing AbortError mapping is unchanged', async () => {
    for (const cause of [new TypeError('Failed to fetch'), new DOMException('Aborted', 'AbortError')]) {
      const s = httpSource(async () => { throw cause; });
      const e = await s.roster().catch((e: unknown) => e);
      expect(e).toBeInstanceOf(NetworkError);
      expect(e).not.toBeInstanceOf(AuthRedirectError);
      expect(errorText(e)).toBe("Couldn't reach the server. Check your connection and retry.");
    }
  });

  it('roster conditional request keeps If-None-Match and cached identity', async () => {
    const cached = { etag: '"original"', roster: [] };
    const s = httpSource(async (_url, init) => {
      expect(init).toMatchObject({ credentials: 'include', redirect: 'manual', headers: { 'If-None-Match': cached.etag } });
      return new Response(null, { status: 304 });
    });
    expect(await s.roster(cached)).toEqual({ ...cached, notModified: true });
    expect((await s.roster(cached)).roster).toBe(cached.roster);
  });
});
