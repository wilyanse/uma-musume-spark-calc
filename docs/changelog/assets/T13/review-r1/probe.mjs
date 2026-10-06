// T13 fix-1 real-browser probe of the PRODUCTION build (apps/web/dist) served by LOCAL `wrangler dev`
// running the real API routes on local D1/R2 with AUTH_DISABLED=1 on 127.0.0.1. NOT live Cloudflare.
// Checks: B1 epithet resolve via UI search → stored epithet text + epithet-derived independent mode;
// B1 override semantics; S1 409 after a concurrent resolve → screen-level alert survives refresh;
// S3 radios disabled while PATCH pending; S2 an API path answered with SPA HTML → auth text.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../../../../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
// Outputs go to T13_PROBE_OUT (default: the current directory), never to tracked evidence.
const S = process.env.T13_PROBE_OUT ?? process.cwd();
const BASE = process.env.T13_PROBE_BASE ?? 'http://127.0.0.1:8799';
const out = {};
const log = (k, v) => { out[k] = v; console.log(k, JSON.stringify(v)); };
const api = async (p, init) => { const r = await fetch(`${BASE}/api/v1${p}`, init); return { status: r.status, body: r.status === 204 ? null : await r.json() }; };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const reqs = []; const errors = [];
page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) reqs.push(`${r.request().method()} ${u.pathname} ${r.status()}${r.request().postData() ? ' ' + r.request().postData() : ''}`); });
page.on('pageerror', (e) => errors.push(e.message));

const items = (await api('/review-items?status=open')).body;
const epiItems = items.filter((i) => i.path === '/epithet');
const [vA, vB] = [epiItems[0].veteranId, epiItems[1].veteranId];
log('before.A', (({ epithet, trainMode, modeSource }) => ({ epithet, trainMode, modeSource }))((await api(`/veterans/${vA}`)).body));
// B gets a manual override first (real PATCH) → epithet fix must keep trainMode=manual (override)
await api(`/veterans/${vB}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trainMode: 'manual' }) });
log('before.B', (({ epithet, trainMode, modeSource }) => ({ epithet, trainMode, modeSource }))((await api(`/veterans/${vB}`)).body));

async function fixEpithet(vid) {
  await page.goto(`${BASE}/review?veteran=${vid}&path=%2Fepithet`);
  await page.getByText('/epithet', { exact: true }).waitFor();
  const search = page.getByRole('combobox', { name: 'None of these? Search the game vocabulary' });
  await search.fill('independent lea');
  await page.getByRole('option', { name: /Independent Learner/ }).click();
  await page.getByRole('button', { name: /^Apply “Independent Learner”/ }).click();
  await page.getByRole('status').filter({ hasText: /^Fixed\./ }).waitFor();
}
await fixEpithet(vA);
log('after.A', (({ epithet, trainMode, modeSource }) => ({ epithet, trainMode, modeSource }))((await api(`/veterans/${vA}`)).body));
await fixEpithet(vB);
log('after.B', (({ epithet, trainMode, modeSource }) => ({ epithet, trainMode, modeSource }))((await api(`/veterans/${vB}`)).body));
log('resolvePosts', reqs.filter((r) => r.startsWith('POST') && r.includes('/resolve')));

// S1: resolve the /stats/gut item of A out-of-band, then press "1" in the stale UI
const gut = (await api('/review-items?status=open')).body.find((i) => i.veteranId === vA && i.path === '/stats/gut');
await page.goto(`${BASE}/review?veteran=${vA}&path=%2Fstats%2Fgut`);
await page.getByText('/stats/gut', { exact: true }).first().waitFor();
const oob = await api(`/review-items/${gut.id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: gut.field.value }) });
log('outOfBandResolve', oob.status);
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('1');
await page.getByRole('alert').waitFor();
await page.waitForTimeout(800);
log('alertAfter409', await page.getByRole('alert').allTextContents());
log('openItemsForA', (await api('/review-items?status=open')).body.filter((i) => i.veteranId === vA).map((i) => i.path));
log('queueGutButtonsAll_isVeteranB', await page.locator('.queue button').filter({ hasText: 'Stats · Gut' }).count());
await page.screenshot({ path: `${S}/probe-409-alert.png` });

// S3: mode radios disabled while PATCH pending (delay the real PATCH by 1.5 s in the browser)
await page.route('**/api/v1/veterans/*', async (route) => { if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
await page.goto(`${BASE}/veterans/${vA}`);
const ind = page.getByRole('radio', { name: 'Independent' }); const man = page.getByRole('radio', { name: 'Manual' });
await ind.waitFor();
await (await ind.isChecked() ? man : ind).click();
const t0 = Date.now();
await page.waitForFunction(() => [...document.querySelectorAll('input[name=mode]')].every((i) => i.disabled), null, { timeout: 1000 });
log('disabledWhilePending', { independent: await ind.isDisabled(), manual: await man.isDisabled(), seenAfterMs: Date.now() - t0 });
await man.click({ force: true, timeout: 500 }).catch(() => undefined); await ind.click({ force: true, timeout: 500 }).catch(() => undefined);
await page.waitForFunction(() => [...document.querySelectorAll('input[name=mode]')].every((i) => !i.disabled), null, { timeout: 5000 });
log('afterPatch', { modeLabel: await page.locator('#mode-l').textContent(), server: (({ trainMode, modeSource }) => ({ trainMode, modeSource }))((await api(`/veterans/${vA}`)).body) });
log('patchReqs', reqs.filter((r) => r.startsWith('PATCH')));
await page.unroute('**/api/v1/veterans/*');

// S2: an API call answered by the real SPA fallback HTML (non-/api path served through the source base)
const spa = await fetch(`${BASE}/roster`); log('spaFallback', { status: spa.status, contentType: spa.headers.get('content-type') });
await page.route('**/api/v1/roster', (route) => route.continue({ url: `${BASE}/roster` }));
await page.goto(`${BASE}/roster`);
await page.getByText('Your session has expired. Reload the page to sign in again.').first().waitFor({ timeout: 5000 });
log('authTextShownForHtml', true);
log('genericShown', await page.getByText('Something went wrong. Retry, or reload the page.').count());
log('pageErrors', errors);
writeFileSync(`${S}/probe-result.json`, JSON.stringify(out, null, 2));
await browser.close();
