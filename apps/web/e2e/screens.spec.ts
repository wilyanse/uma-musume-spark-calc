import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { goldenRoster, goldenTargets, goldenTruth, masterBundle } from '../test/fixtures.ts';
import type { ReviewItem } from '@uma/schema';
/**
 * Evidence output (T13 review r1 S5): by default the ignored `apps/web/test-results/e2e-assets`, so
 * an ordinary `pnpm --filter web e2e` never rewrites the tracked, previously published evidence in
 * docs/changelog/assets/T13. Set `T13_E2E_ASSETS_DIR` explicitly to export somewhere else.
 */
const assets = resolve(process.env.T13_E2E_ASSETS_DIR ?? resolve(import.meta.dirname, '../test-results/e2e-assets'));
console.log(`E2E assets → ${assets}`);
// Created on every write: Playwright empties its output dir (test-results) at the start of a run.
const out = (name: string) => (mkdirSync(assets, { recursive: true }), resolve(assets, name));
const roster = goldenRoster();
const truth = goldenTruth();
const targets = goldenTargets();
const veteran = roster.find((v) => v.id === truth.golden.bestPair.parents[0])!;
const clock = '2026-10-04T00:00:00.000Z';
async function deterministic(page: Page, theme = 'light') {
  await page.addInitScript(({ clock, theme }) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: [] | [string | number]) { super(args.length ? args[0]! : clock); }
      static override now() { return RealDate.parse(clock); }
    }
    window.Date = FixedDate as DateConstructor;
    if (!localStorage.getItem('uma:theme')) localStorage.setItem('uma:theme', JSON.stringify(theme));
  }, { clock, theme });
}
async function axe(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).analyze();
  writeFileSync(out(`${name}-axe.json`), JSON.stringify({ url: page.url(), violations: r.violations }, null, 2));
  const severe = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`AXE ${name}: serious/critical=${severe.length}; all=${r.violations.length}`);
  expect(r.violations, JSON.stringify(r.violations, null, 2)).toEqual([]);
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: out(`${name}.png`), animations: 'disabled' });
}
async function rankGolden(page: Page) {
  await page.getByRole('button', { name: 'Use golden plan (SYNTHETIC)' }).click();
  await expect(page.getByRole('button', { name: 'Rank pairs' })).toBeEnabled();
  const start = performance.now();
  await page.getByRole('button', { name: 'Rank pairs', exact: true }).click();
  await expect(page.getByTestId('rank-progress')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rank pairs', exact: true })).toBeEnabled();
  await expect(page.getByTestId('rank-done')).toBeVisible();
  const wallMs = performance.now() - start;
  const rankMs = Number(await page.getByTestId('rank-done').getAttribute('data-ms'));
  console.log(`REAL BROWSER 260 ranking: ${rankMs} ms (fit+click+render wall ${wallMs.toFixed(0)} ms)`);
  expect(rankMs).toBeLessThan(5000);
  const first = page.locator('table tbody tr').first();
  const ids = await first.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.split('/').pop()).sort());
  expect(ids).toEqual([...truth.golden.bestPair.parents].sort());
  const top10 = await page.locator('table tbody tr').evaluateAll((rows) => rows.slice(0, 10).map((r) => [...r.querySelectorAll('a')].map((a) => a.getAttribute('href')!.split('/').pop()).sort().join('|')));
  expect(top10).not.toContain([...truth.golden.trapPair.parents].sort().join('|'));
  await page.getByRole('button', { name: 'Expand details for pair 1', exact: true }).click();
  await expect(page.getByText(/Predicted stats · mean and p10–p90/)).toBeVisible();
  return { rankMs, wallMs, ids };
}

test('fixture smoke, real Comlink ranking/cancel/recreate, both-theme axe and all seven exports', async ({ page }) => {
  await deterministic(page);
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/roster');
  await expect(page.getByText(/Showing 25 of 260 veterans/)).toBeVisible();
  await expect(page.getByText(/Fixture mode: SYNTHETIC/)).toBeVisible();
  await screenshot(page, 'S01-roster-desktop-light'); await axe(page, 'S01-light');
  await page.locator('tbody th a').first().click();
  await expect(page.getByRole('heading', { name: 'Veteran detail' })).toBeVisible();
  await screenshot(page, 'S02-veteran-desktop-light');
  await page.getByRole('link', { name: 'Planner', exact: true }).first().click();
  const benchmark = await rankGolden(page);
  writeFileSync(out('browser-ranking.json'), JSON.stringify({ context: 'SYNTHETIC golden, real browser Worker/Comlink, 260 veterans', ...benchmark }, null, 2));
  await axe(page, 'S06-light'); await screenshot(page, 'S06-planner-desktop-light');
  await page.getByRole('button', { name: 'Rank pairs', exact: true }).click();
  await expect(page.getByTestId('rank-progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/Ranking cancelled/)).toBeVisible();
  await rankGolden(page);
  await expect(page.getByTestId('model-line')).toContainText('training-v2');
  for (const [id, path, title] of [
    ['S03-review', '/review', 'Review queue'], ['S04-cards', '/cards', 'Support cards'], ['S05-targets', '/targets', 'CM targets'], ['S07-health', '/health', 'Model health'],
  ]) {
    await page.getByRole('link', { name: path!.slice(1) === 'health' ? 'Health' : path!.slice(1)[0]!.toUpperCase() + path!.slice(2), exact: true }).first().click();
    await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible();
    if (id === 'S03-review') { await expect(page.getByText(/Nothing to review/)).toBeVisible(); await axe(page, 'S03-empty-light'); }
    if (id === 'S07-health') await expect(page.getByText(/From the fit run in this tab/)).toBeVisible();
    await screenshot(page, `${id}-desktop-light`);
  }
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    for (const [id, path] of [['S01-roster', '/roster'], ['S02-veteran', `/veterans/${veteran.id}`], ['S03-review', '/review'], ['S04-cards', '/cards'], ['S05-targets', '/targets'], ['S06-planner', '/planner'], ['S07-health', '/health']]) {
      await page.goto(path!);
      await expect(page.locator('main [aria-busy=true]')).toHaveCount(0);
      if (id === 'S06-planner') await rankGolden(page);
      if (id === 'S07-health') {
        await expect(page.getByRole('button', { name: 'Refit model' })).toBeEnabled();
        await page.getByRole('button', { name: 'Refit model' }).click();
        await expect(page.getByText(/From the fit run in this tab/)).toBeVisible();
      }
      await screenshot(page, `${id}-desktop-${theme}`);
      if (theme === 'dark' && ['S01-roster','S03-review','S06-planner'].includes(id!)) await axe(page, `${id}-dark`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [id, path] of [['S01-roster', '/roster'], ['S02-veteran', `/veterans/${veteran.id}`], ['S03-review', '/review'], ['S04-cards', '/cards'], ['S05-targets', '/targets'], ['S06-planner', '/planner'], ['S07-health', '/health']]) {
    await page.goto(path!);
    await expect(page.locator('main [aria-busy=true]')).toHaveCount(0);
    if (id === 'S06-planner') await rankGolden(page);
    if (id === 'S07-health') {
      await expect(page.getByRole('button', { name: 'Refit model' })).toBeEnabled();
      await page.getByRole('button', { name: 'Refit model' }).click();
      await expect(page.getByText(/From the fit run in this tab/)).toBeVisible();
    }
    await screenshot(page, `${id}-mobile-light`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  expect(apiRequests).toEqual([]); expect(errors).toEqual([]);
});

/** MOCK HTTP for domains absent from golden data, not a live API/Cloudflare check. */
async function mockHttp(page: Page) {
  let items: ReviewItem[] = [1, 2].map((n) => ({
    id: `01KGQZ0000G01DENCM0000RV0${n}`, veteranId: veteran.id, path: `/stats/${n === 1 ? 'gut' : 'wit'}`, status: 'open', resolvedValue: null,
    createdAt: clock, resolvedAt: null, cropKey: null,
    field: { path: `/stats/${n === 1 ? 'gut' : 'wit'}`, rawText: 'MOCK OCR 559', value: 559, confidence: 0.62, status: 'low_confidence', candidates: [{ value: 559, score: 0.87 }, { value: 558, score: 0.8 }, { value: 557, score: 0.7 }], cropKey: null },
  }));
  const calls: { path: string; body: unknown }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const path = u.pathname.replace('/api/v1', '');
    if (req.method() === 'POST' && path.endsWith('/resolve')) {
      const id = path.split('/')[2]!; const body: unknown = req.postDataJSON(); calls.push({ path, body });
      const item = items.find((i) => i.id === id)!; items = items.filter((i) => i.id !== id);
      await route.fulfill({ json: { ...item, status: 'resolved', resolvedValue: (body as { value: number }).value, resolvedAt: clock } }); return;
    }
    if (path === '/model-snapshots') { await route.fulfill({ status: 404, json: { status: 404, title: 'MOCK no model' } }); return; }
    const data = path === '/health' ? { ok: true, masterVersion: masterBundle().version, dbSchemaVersion: 'MOCK' }
      : path === '/roster' ? roster : path === '/review-items' ? (u.searchParams.get('status') === 'open' ? items : [])
      : path === '/owned-cards' ? masterBundle().cards.slice(0, 20).map((c, i) => ({ cardId: c.id, lb: i % 5, level: 30, confidence: 1, syncedAt: clock }))
      : path === '/cm-targets' ? targets : { ...veteran, fields: [] };
    await route.fulfill({ json: data, headers: path === '/roster' ? { ETag: '"MOCK-e1"' } : {} });
  });
  return calls;
}
for (const theme of ['light', 'dark']) test(`S03 MOCK HTTP keyboard 1/2/3 J/K/D and populated axe ${theme}`, async ({ page }) => {
  await deterministic(page, theme); const calls = await mockHttp(page);
  await page.goto('http://127.0.0.1:5201/review');
  await expect(page.getByText('/stats/gut', { exact: true })).toBeVisible();
  await page.evaluate(() => { const n = document.createElement('div'); n.className = 'synthetic'; n.textContent = 'TEST MOCK HTTP — synthetic OCR/owned rows; no live API'; document.querySelector('main')!.prepend(n); });
  await axe(page, `S03-populated-${theme}`); await screenshot(page, `S03-review-MOCK-desktop-${theme}`);
  await page.keyboard.press('j'); await expect(page.getByText('/stats/wit', { exact: true })).toBeVisible();
  await page.keyboard.press('k'); await expect(page.getByText('/stats/gut', { exact: true })).toBeVisible();
  await page.keyboard.press('d'); await expect(page.getByText(/no dismiss endpoint/)).toBeVisible();
  expect(calls).toEqual([]);
  await page.keyboard.press('2'); await expect(page.getByText('1 open · 0 resolved this week')).toBeVisible();
  expect(calls[0]!.body).toEqual({ value: 558 });
  await page.keyboard.press('3'); await expect(page.getByText(/Nothing to review/)).toBeVisible();
  expect(calls[1]!.body).toEqual({ value: 557 });
  await page.goto('http://127.0.0.1:5201/cards');
  await expect(page.getByText('Showing 20 of 20 owned cards')).toBeVisible();
  await page.evaluate(() => { const n = document.createElement('div'); n.className = 'synthetic'; n.textContent = 'TEST MOCK HTTP — 20 synthetic owned-card rows'; document.querySelector('main')!.prepend(n); });
  await screenshot(page, `S04-cards-MOCK-desktop-${theme}`);
});
