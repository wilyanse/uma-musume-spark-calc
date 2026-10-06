// Real Chromium + real local HTTP (302 without route interception), production web bundle and
// production httpSource. Controlled TEST SERVER API responses, not real API/live Cloudflare.
import { test, expect, type Page } from '@playwright/test';

type FetchProbe = { path: string; redirect?: RequestRedirect; credentials?: RequestCredentials; type?: ResponseType; status?: number; error?: string };
async function observeFetch(page: Page) {
  await page.addInitScript(() => {
    const records: FetchProbe[] = [];
    (window as unknown as { r2Fetch: FetchProbe[] }).r2Fetch = records;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const record: FetchProbe = { path, redirect: init?.redirect, credentials: init?.credentials };
      try {
        const res = await original(input, init);
        if (path.includes('/api/v1/')) { record.type = res.type; record.status = res.status; records.push(record); }
        return res;
      } catch (e) {
        if (path.includes('/api/v1/')) { record.error = e instanceof Error ? e.name : String(e); records.push(record); }
        throw e;
      }
    };
  });
}
async function fetchRecords(page: Page) {
  return page.evaluate(() => (window as unknown as { r2Fetch: FetchProbe[] }).r2Fetch.filter((r) => r.path.endsWith('/roster')));
}
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewR2Server } from '../scripts/review-r2-server.ts';
const assets = resolve(process.env.T13_E2E_ASSETS_DIR ?? resolve(import.meta.dirname, '../test-results/e2e-assets'));
function save(name: string, data: unknown) { mkdirSync(assets, { recursive: true }); writeFileSync(resolve(assets, name), JSON.stringify(data, null, 2)); }
const AUTH = 'Your session has expired. Reload the page to sign in again.';

test('LOCAL HTTP production roster retains ETag/304 on refetch', async ({ page }) => {
  const s = await reviewR2Server(); s.state.scenario = 'json';
  try {
    await observeFetch(page);
    await page.goto(`${s.origin}/roster`);
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('link', { name: 'Cards', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Support cards', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Roster', exact: true }).click();
    await expect.poll(() => s.state.roster304).toBeGreaterThan(0);
    await expect(page.getByRole('table')).toBeVisible();
    expect(s.state.requests.some((r) => r.path === '/roster' && r.etag === '"test-r2"')).toBe(true);
    save('fix2-etag.json', { server304: s.state.roster304, records: await fetchRecords(page), requests: s.state.requests.filter((r) => r.path === '/roster') });
    console.log('LOCAL HTTP roster: If-None-Match sent, 304 retained populated table');
  } finally { await page.close(); await s.close(); }
});

test('LOCAL HTTP production bundle: actual cross-origin 302 is auth and neither redirect target is followed', async ({ page }) => {
  const s = await reviewR2Server();
  try {
    await observeFetch(page);
    const observed: unknown[] = [];
    await page.context().addCookies([{ name: 'TEST_COOKIE', value: 'not-a-credential', url: s.origin }]);
    for (const scenario of ['cross-302', 'same-302']) {
      s.state.scenario = scenario;
      await page.goto(`${s.origin}/roster`);
      await expect(page.getByText(AUTH).first()).toBeVisible();
      await expect(page.getByText("Couldn't reach the server. Check your connection and retry.")).toHaveCount(0);
      await expect(page.getByText(/SECRET-/)).toHaveCount(0);
      expect(s.state.hits).toEqual([]);
      const records = await fetchRecords(page);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) expect(record).toMatchObject({ type: 'opaqueredirect', status: 0, redirect: 'manual', credentials: 'include' });
      observed.push({ scenario, records });
      expect(s.state.requests.some((r) => r.path === '/roster' && r.cookie.includes('TEST_COOKIE='))).toBe(true);
      console.log(`LOCAL HTTP ${scenario}: auth=true targetHits=${s.state.hits.length}`);
    }
    save('fix2-redirect.json', { provenance: 'Local controlled HTTP servers; production dist; real browser fetch, not Cloudflare', observed, requests: s.state.requests, targetHits: s.state.hits });
  } finally { await page.close(); await s.close(); }
});

test('LOCAL HTTP production bundle: HTML 200/401/403 auth; 502/problem generic; malformed JSON distinct; real TypeError network', async ({ page }) => {
  const s = await reviewR2Server();
  try {
    await observeFetch(page);
    const results: unknown[] = [];
    for (const [scenario, text] of [
      ['html200', AUTH], ['html401', AUTH], ['html403', AUTH],
      ['html502', 'Something went wrong. Retry, or reload the page.'],
      ['problem', 'Something went wrong. Retry, or reload the page.'],
      ['malformed', 'The server sent a response the app could not read. Retry, or reload the page.'],
      ['network', "Couldn't reach the server. Check your connection and retry."],
    ]) {
      s.state.scenario = scenario!;
      await page.goto(`${s.origin}/roster`);
      await expect(page.getByText(text!).first()).toBeVisible();
      await expect(page.getByText(/SECRET-/)).toHaveCount(0);
      const records = await fetchRecords(page);
      if (scenario === 'network') { expect(records.length).toBeGreaterThan(0); expect(records.every((r) => r.error === 'TypeError')).toBe(true); }
      results.push({ scenario, text, records });
      console.log(`LOCAL HTTP ${scenario}: ${text}`);
    }
    save('fix2-response-categories.json', results);
  } finally { await page.close(); await s.close(); }
});

for (const input of ['keydown', 'click'] as const) {
  test(`LOCAL HTTP production Review: two same-task ${input}s send once, next item unlocks, no spurious alert`, async ({ page }) => {
    const s = await reviewR2Server(); s.state.scenario = 'json';
    try {
      await page.goto(`${s.origin}/review`);
      await expect(page.getByText('/stats/gut', { exact: true })).toBeVisible();
      if (input === 'keydown') await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      });
      else await page.getByRole('button', { name: /^Apply/ }).evaluate((el) => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await expect(page.getByText('/stats/wit', { exact: true })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('Fixed.');
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(s.state.posts).toHaveLength(1);
      await page.getByRole('button', { name: /^Apply/ }).click();
      await expect(page.getByText(/Nothing to review/)).toBeVisible();
      expect(s.state.posts).toHaveLength(2);
      await expect(page.getByRole('alert')).toHaveCount(0);
      console.log(`LOCAL HTTP Review ${input}: posts=2 (one per item), staleAlerts=0`);
    } finally { await page.close(); await s.close(); }
  });
}

test('LOCAL HTTP production Review: 500/404/409 persist, unlock retry, success clears error', async ({ page }) => {
  const s = await reviewR2Server(); s.state.scenario = 'json';
  try {
    for (const status of [500, 404, 409]) {
      s.state.resetItems(); s.state.resolveStatus = status;
      await page.goto(`${s.origin}/review`);
      await expect(page.getByText('/stats/gut', { exact: true })).toBeVisible();
      await page.evaluate(() => { for (let i = 0; i < 2; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })); });
      await expect(page.getByRole('alert')).toBeVisible();
      if (status !== 500) await expect(page.getByRole('alert')).toContainText('The queue was refreshed.');
      await expect(page.getByRole('button', { name: /^Apply/ })).toBeEnabled();
      expect(s.state.posts).toHaveLength(1);
      s.state.resolveStatus = 200;
      await page.getByRole('button', { name: /^Apply/ }).click();
      await expect(page.getByText('/stats/wit', { exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(s.state.posts).toHaveLength(2);
      console.log(`LOCAL HTTP Review ${status}: error retained; retry successful; posts=2`);
    }
  } finally { await page.close(); await s.close(); }
});

test('LOCAL HTTP production Veteran: two same-task clicks send once, 500 rolls back, retry unlocks', async ({ page }) => {
  const s = await reviewR2Server(); s.state.scenario = 'json'; s.state.patchStatus = 500;
  try {
    await page.goto(`${s.origin}/veterans/${s.veteranId}`);
    const manual = page.getByRole('radio', { name: 'Manual' });
    await expect(manual).toBeVisible();
    await manual.evaluate((el) => { for (let i = 0; i < 2; i++) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect(page.getByRole('alert')).toContainText('It has been reverted.');
    await expect(page.getByRole('radio', { name: 'Independent' })).toBeChecked();
    await expect(manual).toBeEnabled();
    expect(s.state.patches).toHaveLength(1);
    s.state.patchStatus = 200;
    await manual.evaluate((el) => { for (let i = 0; i < 2; i++) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect(manual).toBeEnabled();
    await expect(manual).toBeChecked();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(s.state.patches).toHaveLength(2);
    console.log('LOCAL HTTP Veteran: one PATCH per attempt, rollback + retry passed');
  } finally { await page.close(); await s.close(); }
});
