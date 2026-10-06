// Reproducible local HTTP boundary probe: serves the real production dist and controlled test
// API responses. NOT the real API, NOT Cloudflare Access. Synthetic data is test-server-only.
import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import type { ReviewItem, RosterVeteran, RosterVeteranDetail } from '@uma/schema';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  return `http://127.0.0.1:${address.port}`;
}
const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
};

export async function reviewR2Server() {
  const hits: string[] = [];
  const login = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    // Deliberately no CORS headers, like a cross-origin login that isn't readable by the SPA.
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>SECRET-LOGIN-BODY</html>');
  });
  const loginOrigin = await listen(login);
  const roster = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/roster.json'), 'utf8')) as RosterVeteran[];
  let veteran: RosterVeteranDetail = { ...roster[0]!, fields: [], trainMode: 'independent' };
  const clock = '2026-10-01T00:00:00.000Z';
  const makeItem = (id: string, path: string): ReviewItem => ({
    id, veteranId: veteran.id, path, status: 'open', resolvedValue: null, createdAt: clock, resolvedAt: null, cropKey: null,
    field: { path, rawText: 'SYNTHETIC TEST', value: 559, confidence: 0.4, status: 'low_confidence', candidates: [{ value: 559, score: 0.9 }], cropKey: null },
  });
  const state = {
    scenario: 'cross-302', hits, roster304: 0, requests: [] as { method: string; path: string; cookie: string; etag?: string }[],
    posts: [] as string[], patches: [] as string[], resolveStatus: 200, patchStatus: 200,
    open: [makeItem('first', '/stats/gut'), makeItem('second', '/stats/wit')],
    resetItems() { this.open = [makeItem('first', '/stats/gut'), makeItem('second', '/stats/wit')]; this.posts = []; },
  };
  const dist = resolve(import.meta.dirname, '../dist');
  const app = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (u.pathname === '/login') { hits.push('same-origin GET /login'); res.writeHead(200, { 'content-type': 'text/html' }); res.end('SECRET-LOGIN-BODY'); return; }
    if (u.pathname.startsWith('/api/v1/')) {
      const path = u.pathname.slice('/api/v1'.length);
      state.requests.push({ method: req.method ?? 'GET', path, cookie: req.headers.cookie ?? '', etag: req.headers['if-none-match'] });
      if (path === '/health') { json(res, { ok: true, masterVersion: 'global-20260930', dbSchemaVersion: 3 }); return; }
      if (path === '/roster') {
        const scenario = state.scenario;
        if (scenario.endsWith('302')) { res.writeHead(302, { location: scenario === 'cross-302' ? `${loginOrigin}/login` : '/login' }); res.end(); return; }
        if (scenario === 'network') { res.destroy(); return; }
        if (scenario === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{SECRET-INVALID-JSON'); return; }
        if (scenario === 'problem') { json(res, { title: 'SECRET-PROBLEM', status: 500 }, 500); return; }
        if (scenario.startsWith('html')) { res.writeHead(Number(scenario.slice(4)), { 'content-type': 'text/html' }); res.end('<html>SECRET-HTML-BODY</html>'); return; }
        if (req.headers['if-none-match'] === '"test-r2"') { state.roster304++; res.writeHead(304); res.end(); return; }
        res.writeHead(200, { 'content-type': 'application/json', etag: '"test-r2"' }); res.end(JSON.stringify(roster.map((v) => v.id === veteran.id ? veteran : v))); return;
      }
      if (path.endsWith('/resolve')) {
        state.posts.push(path);
        const id = path.split('/')[2]!;
        const item = state.open.find((i) => i.id === id);
        // Genuine duplicate sends get 409; this catches success followed by a spurious stale alert.
        if (state.resolveStatus !== 200 || !item) { json(res, { status: item ? state.resolveStatus : 409, detail: 'Review item changed elsewhere' }, item ? state.resolveStatus : 409); return; }
        state.open = state.open.filter((i) => i.id !== id);
        json(res, { ...item, status: 'resolved', resolvedAt: clock }); return;
      }
      if (path.startsWith('/veterans/')) {
        if (req.method === 'PATCH') {
          state.patches.push(path);
          let body = ''; for await (const chunk of req) body += String(chunk);
          if (state.patchStatus !== 200) { json(res, { status: state.patchStatus }, state.patchStatus); return; }
          veteran = { ...veteran, ...JSON.parse(body), modeSource: 'override' } as RosterVeteranDetail;
        }
        json(res, veteran); return;
      }
      if (path === '/review-items') { json(res, u.searchParams.get('status') === 'open' ? state.open : []); return; }
      if (path === '/model-snapshots') { json(res, { status: 404 }, 404); return; }
      json(res, []); return;
    }
    const file = resolve(dist, `.${u.pathname}`);
    if (!file.startsWith(`${dist}${sep}`)) { res.writeHead(404); res.end(); return; }
    const actual = existsSync(file) && statSync(file).isFile() ? file : resolve(dist, 'index.html');
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
    res.writeHead(200, { 'content-type': mime[extname(actual)] ?? 'application/octet-stream' }); res.end(readFileSync(actual));
  });
  const origin = await listen(app);
  return { origin, loginOrigin, state, veteranId: veteran.id,
    async close() { for (const server of [app, login]) { server.closeAllConnections(); await new Promise<void>((ok, fail) => server.close((err) => err ? fail(err) : ok())); } },
  };
}
