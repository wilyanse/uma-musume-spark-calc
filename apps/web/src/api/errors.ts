/** Typed HTTP failure carrying the RFC 9457 problem body the API returns (40 §4). */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: { path?: string; message: string; [k: string]: unknown }[];
}

export class HttpError extends Error {
  override name = 'HttpError';
  readonly status: number;
  readonly problem: Problem | null;
  constructor(status: number, problem: Problem | null, what: string) {
    super(`${what}: HTTP ${status}${problem?.detail ? ` — ${problem.detail}` : ''}`);
    this.status = status;
    this.problem = problem;
  }
}

/** Fetch rejected without a response (offline, DNS, CORS/network failure). */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/**
 * A response that is not the API's: an opaque manual redirect (no readable status/Location/body)
 * or an HTML page on an API path (the SPA fallback / a login page). Treated as an expired
 * session. The body is never read into the error, so a login page's content can't leak into logs.
 */
export class AuthRedirectError extends Error {
  override name = 'AuthRedirectError';
  readonly status: number;
  constructor(status: number, what: string, reason: 'redirected' | 'html') {
    super(`${what}: HTTP ${status} ${reason === 'redirected' ? 'redirected' : 'HTML response'} (sign-in required?)`);
    this.status = status;
  }
}

/** The API answered with a JSON content type (or none) whose body does not parse as JSON. */
export class MalformedResponseError extends Error {
  override name = 'MalformedResponseError';
  readonly status: number;
  constructor(status: number, what: string) {
    super(`${what}: HTTP ${status} response body is not valid JSON`);
    this.status = status;
  }
}

/** copy.md global error keys. */
export function errorText(e: unknown): string {
  if (e instanceof NetworkError) return "Couldn't reach the server. Check your connection and retry.";
  if (e instanceof AuthRedirectError) return 'Your session has expired. Reload the page to sign in again.';
  // Not a copy.md key: copy.md has no text for an unreadable success body, so this is new UI copy.
  if (e instanceof MalformedResponseError)
    return 'The server sent a response the app could not read. Retry, or reload the page.';
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403)
      return 'Your session has expired. Reload the page to sign in again.';
    if (e.status === 422 && e.problem?.errors?.length) {
      return e.problem.errors.map((x) => (x.path ? `${x.path}: ${x.message}` : x.message)).join('; ');
    }
  }
  return 'Something went wrong. Retry, or reload the page.';
}

export const isStatus = (e: unknown, status: number): e is HttpError =>
  e instanceof HttpError && e.status === status;
