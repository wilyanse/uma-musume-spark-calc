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
import { HttpError, NetworkError, type Problem } from './errors.ts';
import type { CmTargetInput, DataSource, OwnedCardRow, RosterResult } from './types.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function problemOf(res: Response): Promise<Problem | null> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Problem) : null;
  } catch {
    return null;
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
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
    return res;
  }
  async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await call(method, path, body);
    if (!res.ok) throw new HttpError(res.status, await problemOf(res), `${method} ${path}`);
    return (await res.json()) as T;
  }
  async function empty(method: string, path: string): Promise<void> {
    const res = await call(method, path);
    if (!res.ok) throw new HttpError(res.status, await problemOf(res), `${method} ${path}`);
  }

  return {
    kind: 'api',
    health: () => json<HealthResponse>('GET', '/health'),
    async roster(cached): Promise<RosterResult> {
      const res = await call('GET', '/roster', undefined, cached ? { 'If-None-Match': cached.etag } : {});
      if (res.status === 304 && cached) return { etag: cached.etag, roster: cached.roster, notModified: true };
      if (!res.ok) throw new HttpError(res.status, await problemOf(res), 'GET /roster');
      return { etag: res.headers.get('ETag'), roster: (await res.json()) as RosterVeteran[], notModified: false };
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
