/**
 * T13 review round 1 browser regressions on the API-mode dev server (port 5201) with MOCK HTTP
 * (`page.route`, labelled; not a live API or Cloudflare): keyboard resolve flows for an epithet
 * (exact text body, B1), a 409 conflict whose item vanishes on refresh (S1), an HTML 200 auth wall
 * (S2) and the pending mode toggle (S3), plus axe in both themes on the populated review screen.
 * Evidence goes to the ignored test-results directory unless T13_E2E_ASSETS_DIR is set (S5).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { goldenRoster, masterBundle } from '../test/fixtures.ts';
import type { ReviewItem, RosterVeteranDetail } from '@uma/schema';

const assets = resolve(process.env.T13_E2E_ASSETS_DIR ?? resolve(import.meta.dirname, '../test-results/e2e-assets'));
const out = (name: string) => (mkdirSync(assets, { recursive: true }), resolve(assets, name));
const API = 'http://127.0.0.1:5201';
const clock = '2026-10-04T00:00:00.000Z';
const roster = goldenRoster();
const v = { ...roster.find((r) => r.trainMode === 'manual')!, epithet: 'Trickster', modeSource: 'epithet' as const };
const rosterOut = roster.map((r) => (r.id === v.id ? v : r));

const mkItem = (n: number, path: string, value: unknown, candidates: { value: unknown; score: number }[]): ReviewItem => ({
  id: `01KGQZ0000G01DENCM0000RX0${n}`, veteranId: v.id, path, status: 'open', resolvedValue: null, createdAt: clock, resolvedAt: null, cropKey: null,
  field: { path, rawText: `MOCK OCR ${n}`, value, confidence: 0.4, status: 'low_confidence', candidates, cropKey: null },
});

async function theme(page: Page, t: string) {
  await page.addInitScript((t) => localStorage.setItem('uma:theme', JSON.stringify(t)), t);
}

interface Api { items: ReviewItem[]; resolveBodies: { id: string; body: unknown }[]; patches: unknown[]; onResolve?: (id: string, route: Route) => Promise<boolean>; patchGate?: Promise<void> }
async function mockApi(page: Page, api: Api) {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const path = u.pathname.replace('/api/v1', '');
    if (req.method() === 'POST' && path.endsWith('/resolve')) {
      const id = path.split('/')[2]!; const body = req.postDataJSON() as { value: unknown };
      api.resolveBodies.push({ id, body });
      if (api.onResolve && (await api.onResolve(id, route))) return;
      const item = api.items.find((i) => i.id === id)!; api.items = api.items.filter((i) => i.id !== id);
      if (item.path === '/epithet') v.epithet = body.value as string;
      await route.fulfill({ json: { ...item, status: 'resolved', resolvedValue: body.value, resolvedAt: clock } }); return;
    }
    if (req.method() === 'PATCH') {
      api.patches.push(req.postDataJSON()); await api.patchGate;
      Object.assign(v, req.postDataJSON(), { modeSource: 'override' });
      await route.fulfill({ json: { ...v, fields: [] } }); return;
    }
    if (path === '/model-snapshots') { await route.fulfill({ status: 404, json: { status: 404, title: 'MOCK no model' } }); return; }
    const data = path === '/health' ? { ok: true, masterVersion: masterBundle().version, dbSchemaVersion: 'MOCK' }
      : path === '/roster' ? rosterOut : path === '/review-items' ? (u.searchParams.get('status') === 'open' ? api.items : [])
      : path === '/owned-cards' ? [] : path === '/cm-targets' ? [] : ({ ...v, fields: [] } satisfies RosterVeteranDetail);
    await route.fulfill({ json: data });
  });
}

for (const t of ['light', 'dark']) {
  test(`MOCK HTTP S03 keyboard: epithet text body (B1), 409 stale alert after refresh (S1), axe ${t}`, async ({ page }) => {
    await theme(page, t);
    const epi = mkItem(1, '/epithet', 'Trickster', []);
    const gut = mkItem(2, '/stats/gut', 559, [{ value: 559, score: 0.9 }, { value: 558, score: 0.5 }]);
    const api: Api = { items: [epi, gut], resolveBodies: [], patches: [] };
    api.onResolve = async (id, route) => {
      if (id !== gut.id) return false;
      api.items = api.items.filter((i) => i.id !== gut.id); // resolved elsewhere first
      await route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Review item is already resolved' }) });
      return true;
    };
    await mockApi(page, api);
    await page.goto(`${API}/review`);
    await expect(page.getByText('/epithet', { exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    writeFileSync(out(`fix1-S03-populated-${t}-axe.json`), JSON.stringify({ url: page.url(), note: 'MOCK HTTP', violations: axe.violations }, null, 2));
    console.log(`AXE fix1-S03-${t}: ${axe.violations.map((x) => `${x.id}:${x.impact}`).join(',') || 'none'}`);
    expect(axe.violations).toEqual([]);
    // B1 by keyboard: type in the search, Tab to the option, Enter, Tab to Apply, Enter
    const search = page.getByRole('combobox', { name: 'None of these? Search the game vocabulary' });
    await search.focus(); await page.keyboard.type('independent lea');
    await page.keyboard.press('Tab'); await expect(page.getByRole('option', { name: /Independent Learner/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^Apply “Independent Learner”/ }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByText('/stats/gut', { exact: true })).toBeVisible();
    expect(api.resolveBodies[0]).toEqual({ id: epi.id, body: { value: 'Independent Learner' } });
    // S1 by keyboard: "1" → 409, item disappears, the alert survives
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('1');
    await expect(page.getByText(/Nothing to review/)).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Review item is already resolved. The queue was refreshed.');
    await page.screenshot({ path: out(`fix1-S03-409-${t}.png`) });
  });
}

test('MOCK HTTP S2: an HTML 200 on an API call shows the auth message, not "Something went wrong"', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>MOCK Access login</title>' }));
  await page.goto(`${API}/roster`);
  await expect(page.getByText('Your session has expired. Reload the page to sign in again.').first()).toBeVisible();
  await expect(page.getByText('Something went wrong. Retry, or reload the page.')).toHaveCount(0);
});

test('MOCK HTTP S3: mode radios are disabled while the PATCH is pending (keyboard)', async ({ page }) => {
  let open!: () => void;
  const api: Api = { items: [], resolveBodies: [], patches: [], patchGate: new Promise<void>((r) => (open = r)) };
  v.trainMode = 'manual'; v.modeSource = 'epithet';
  await mockApi(page, api);
  await page.goto(`${API}/veterans/${v.id}`);
  const manual = page.getByRole('radio', { name: 'Manual' });
  await expect(manual).toBeChecked();
  await manual.focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Independent' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Independent' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Manual' })).toBeDisabled();
  expect(api.patches).toEqual([{ trainMode: 'independent' }]);
  open();
  await expect(page.getByRole('radio', { name: 'Manual' })).toBeEnabled();
  await expect(page.getByText('Train mode (overridden)')).toBeVisible();
  expect(api.patches).toHaveLength(1);
});
