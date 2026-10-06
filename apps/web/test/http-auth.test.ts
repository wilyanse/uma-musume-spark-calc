/**
 * S2 (T13 review round 1): Access login pages / same-origin HTML redirects / SPA fallback HTML on
 * a "successful" response are an auth problem, not a generic failure; a JSON-typed body that does
 * not parse is a malformed-response problem; ordinary 5xx stay server errors. MOCK HTTP only (an
 * in-test fetch double), not a live API or Cloudflare Access.
 */
import { describe, expect, it } from 'vitest';
import { httpSource } from '../src/api/http.ts';
import { AuthRedirectError, HttpError, MalformedResponseError, errorText } from '../src/api/errors.ts';

const AUTH = 'Your session has expired. Reload the page to sign in again.';
const SECRET_HTML = '<!doctype html><html><body>Cloudflare Access login SECRET-NONCE-123</body></html>';

/** A Response whose `redirected`/`url` are set like a followed redirect. */
function redirected(body: string, contentType: string, url = 'https://team.cloudflareaccess.com/cdn-cgi/access/login') {
  const r = new Response(body, { status: 200, headers: { 'content-type': contentType } });
  Object.defineProperty(r, 'redirected', { value: true });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

describe('httpSource auth / malformed detection (MOCK HTTP)', () => {
  it('a followed redirect to an HTML login page is an auth error with the copy.md auth text', async () => {
    const calls: RequestInit[] = [];
    const s = httpSource(async (_u, init) => {
      calls.push(init!);
      return redirected(SECRET_HTML, 'text/html; charset=utf-8');
    });
    const err = await s.ownedCards().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthRedirectError);
    expect(errorText(err)).toBe(AUTH);
    expect(String((err as Error).message)).not.toMatch(/SECRET-NONCE|cloudflareaccess/);
    expect(calls[0]!.credentials).toBe('include');
  });

  it('a 200 HTML body without a redirect (SPA fallback) is also an auth error', async () => {
    const s = httpSource(async () => new Response(SECRET_HTML, { status: 200, headers: { 'content-type': 'text/html' } }));
    for (const call of [() => s.roster(), () => s.health(), () => s.deleteTarget('01KGQZ0000G01DENCM0000NEW1')]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuthRedirectError);
      expect(errorText(err)).toBe(AUTH);
    }
  });

  it('a redirected JSON response is also treated as auth (not trusted as API data)', async () => {
    const s = httpSource(async () => redirected('[]', 'application/json', 'http://localhost/elsewhere'));
    expect(await s.ownedCards().catch((e: unknown) => e)).toBeInstanceOf(AuthRedirectError);
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
});
