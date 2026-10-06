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

/** Fetch never got a response (offline, DNS, CORS, Access redirect blocked…). */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/** copy.md global error keys. */
export function errorText(e: unknown): string {
  if (e instanceof NetworkError) return "Couldn't reach the server. Check your connection and retry.";
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
