import type {
  CmTarget,
  HealthResponse,
  ModelSnapshot,
  ModelSnapshotKind,
  ReviewItem,
  RosterVeteran,
  RosterVeteranDetail,
  TrainMode,
} from '@uma/schema';
import { AuthRedirectError, HttpError, MalformedResponseError, NetworkError, type Problem } from './errors.ts';
import type { CmTargetInput, DataSource, OwnedCardRow, RosterResult } from './types.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const isHtml = (res: Response) => /^\s*text\/html\b/i.test(res.headers.get('content-type') ?? '');

/**
 * API fetches use manual redirects: browsers expose redirects (same/cross origin) as an
 * opaqueredirect with status 0 and no readable headers/body. Classify it before touching either;
 * never follow a login URL with credentials. HTML 2xx/401/403 is an auth wall / SPA fallback,
 * while HTML 5xx remains a server error. No response body is included in an error message.
 */
function authProblem(res: Response, what: string): AuthRedirectError | null {
  if (res.type === 'opaqueredirect' || res.redirected)
    return new AuthRedirectError(res.status, what, 'redirected');
  if (isHtml(res) && (res.ok || res.status === 401 || res.status === 403))
    return new AuthRedirectError(res.status, what, 'html');
  return null;
}

/** The problem+json body of an error response; null for non-JSON bodies (never echoed). */
async function problemOf(res: Response): Promise<Problem | null> {
  if (isHtml(res)) return null;
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Problem) : null;
  } catch {
    return null;
  }
}

async function failure(res: Response, what: string): Promise<Error> {
  return authProblem(res, what) ?? new HttpError(res.status, await problemOf(res), what);
}

async function parseJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MalformedResponseError(res.status, what);
  }
}

/** The real API (`/api/v1`, `credentials: 'include'` for the Access cookie; 60 §1). */
export function httpSource(fetchImpl: FetchLike = (i, init) => fetch(i, init), base = '/api/v1'): DataSource {
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        credentials: 'include',
        redirect: 'manual',
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
    return res;
  }
  async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const what = `${method} ${path}`;
    const res = await call(method, path, body);
    if (!res.ok || res.redirected || isHtml(res)) throw await failure(res, what);
    return parseJson<T>(res, what);
  }
  async function empty(method: string, path: string): Promise<void> {
    const what = `${method} ${path}`;
    const res = await call(method, path);
    if (!res.ok || res.redirected || isHtml(res)) throw await failure(res, what);
  }

  return {
    kind: 'api',
    health: () => json<HealthResponse>('GET', '/health'),
    async roster(cached): Promise<RosterResult> {
      const res = await call('GET', '/roster', undefined, cached ? { 'If-None-Match': cached.etag } : {});
      if (res.status === 304 && cached && !res.redirected) return { etag: cached.etag, roster: cached.roster, notModified: true };
      if (!res.ok || res.redirected || isHtml(res)) throw await failure(res, 'GET /roster');
      return { etag: res.headers.get('ETag'), roster: await parseJson<RosterVeteran[]>(res, 'GET /roster'), notModified: false };
    },
    veteran: (id) => json<RosterVeteranDetail>('GET', `/veterans/${encodeURIComponent(id)}`),
    patchVeteran: (id, body: { trainMode: TrainMode }) =>
      json<RosterVeteranDetail>('PATCH', `/veterans/${encodeURIComponent(id)}`, body),
    deleteVeteran: (id) => empty('DELETE', `/veterans/${encodeURIComponent(id)}`),
    reviewItems: (status) => json<ReviewItem[]>('GET', `/review-items?status=${status}`),
    resolveReviewItem: (id, value) =>
      json<ReviewItem>('POST', `/review-items/${encodeURIComponent(id)}/resolve`, { value }),
    // The key is `crops/<id>/<urlencoded path>.png` and is sent as-is (apps/api/src/routes/crops.ts).
    cropUrl: (key) => `${base}/crops/${key}`,
    ownedCards: () => json<OwnedCardRow[]>('GET', '/owned-cards'),
    targets: () => json<CmTarget[]>('GET', '/cm-targets'),
    createTarget: (input: CmTargetInput) => json<CmTarget>('POST', '/cm-targets', input),
    updateTarget: (id, input) => json<CmTarget>('PUT', `/cm-targets/${encodeURIComponent(id)}`, input),
    deleteTarget: (id) => empty('DELETE', `/cm-targets/${encodeURIComponent(id)}`),
    async latestSnapshot(kind?: ModelSnapshotKind) {
      try {
        return await json<ModelSnapshot>('GET', `/model-snapshots${kind ? `?kind=${kind}` : ''}`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
    },
    storeSnapshot: (s) => json<ModelSnapshot>('POST', '/model-snapshots', s),
  };
}
