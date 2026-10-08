/**
 * T15b S07 calibration in a REAL browser: the real Vite worker + Comlink + `calibrateRules`.
 * Nothing here fabricates an engine response.
 *
 * - Fixture mode (port 5200, SYNTHETIC golden context): `/fixtures/roster.json` is served with the
 *   committed, unchanged T08 planted ×1.3 roster file (packages/engine/test/golden/
 *   roster.calibration-x1.3.json, bytes passed through). The planted multiplier lives only in
 *   truth.json and is never passed to the estimator; the golden context comes from
 *   golden-truth.json `syntheticInheritance` exactly as the app already loads it.
 * - API mode (port 5201, production context, published placeholder rules): MOCK HTTP routes give
 *   the SYNTHETIC golden roster; no live API, no Cloudflare Access.
 *
 * Evidence: by default the ignored apps/web/test-results/t15b-assets; set T15B_E2E_ASSETS_DIR to
 * export (docs/changelog/assets/T15b).
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { goldenRoster, goldenTargets, masterBundle } from '../test/fixtures.ts';

const assets = resolve(process.env.T15B_E2E_ASSETS_DIR ?? resolve(import.meta.dirname, '../test-results/t15b-assets'));
console.log(`T15b E2E assets → ${assets}`);
const out = (name: string) => (mkdirSync(assets, { recursive: true }), resolve(assets, name));
const X13 = resolve(import.meta.dirname, '../../../packages/engine/test/golden/roster.calibration-x1.3.json');
const clock = '2026-10-08T00:00:00.000Z';
const CAL_TIMEOUT = 90_000;

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
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
}
/**
 * Viewport screenshot with the calibration panel scrolled into view, plus `-full`: the app scrolls
 * inside `main.content`, so the viewport is temporarily grown to the content height to capture the
 * whole report (evidence only; restored afterwards).
 */
async function shot(page: Page, name: string, full = true) {
  await page.locator('section[aria-labelledby="cal-t"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: out(`${name}.png`), animations: 'disabled' });
  if (!full) return;
  const vp = page.viewportSize()!;
  const h = await page.evaluate(() => {
    const m = document.getElementById('content')!;
    return Math.ceil(m.scrollHeight + m.getBoundingClientRect().top + 80);
  });
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 12000) });
  await page.evaluate(() => document.getElementById('content')!.scrollTo(0, 0));
  await page.screenshot({ path: out(`${name}-full.png`), animations: 'disabled' });
  await page.setViewportSize(vp);
}
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.getByRole('combobox', { name: 'Theme', exact: true }).first().selectOption(theme);
}
async function runCalibration(page: Page) {
  const btn = page.getByRole('button', { name: 'Run calibration', exact: true });
  await expect(btn).toBeEnabled();
  const t0 = Date.now();
  await btn.click();
  await expect(page.getByTestId('calib-running')).toBeVisible();
  await expect(page.getByTestId('calib-running')).not.toContainText('%');
  await expect(page.getByTestId('calibration-report')).toBeVisible({ timeout: CAL_TIMEOUT });
  return Date.now() - t0;
}
const text = (page: Page, id: string) => page.getByTestId(id).innerText();

test('fixture: real worker calibrates the unchanged ×1.3 roster; cancel/retry/navigation/stale; axe + screenshots', async ({ page }) => {
  test.setTimeout(600_000);
  await deterministic(page);
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(`${r.method()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  const x13 = readFileSync(X13);
  await page.route('**/fixtures/roster.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: x13 }));

  await page.goto('/health');
  await expect(page.getByRole('heading', { name: 'Model health', exact: true })).toBeVisible();
  await expect(page.getByText(/No model yet/)).toBeVisible();
  await expect(page.getByText("Calibration hasn't been run.")).toBeVisible();

  // Cancel (terminates the worker), then Retry on a fresh worker.
  await page.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect(page.getByTestId('calib-running')).toBeVisible();
  await shot(page, 'S07-calibration-running-desktop-light', false);
  await page.getByRole('button', { name: 'Cancel calibration' }).click();
  await expect(page.getByText('Calibration cancelled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry calibration' })).toBeEnabled();

  // Navigation while running: the route owns the job and cancels it; nothing paints afterwards.
  await page.getByRole('button', { name: 'Retry calibration' }).click();
  await expect(page.getByTestId('calib-running')).toBeVisible();
  await page.getByRole('link', { name: 'Targets', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'CM targets', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Health', exact: true }).first().click();
  await expect(page.getByText("Calibration hasn't been run.")).toBeVisible();
  await expect(page.getByTestId('calib-running')).toHaveCount(0);

  const ms = await runCalibration(page);
  const sel = await text(page, 'calib-selection');
  const m = Number(/×(\d+\.\d+)/.exec(sel)![1]);
  console.log(`REAL BROWSER calibration (fixture ×1.3 roster): ${ms} ms; selection: ${sel.replace(/\s+/g, ' ')}`);
  expect(m).toBeGreaterThanOrEqual(1.2);
  expect(m).toBeLessThanOrEqual(1.4);
  await expect(page.getByTestId('calib-status')).toContainText('complete');
  await expect(page.getByText(/SYNTHETIC golden fixture context/)).toBeVisible();
  await expect(page.getByText(/checks available.*not verified/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply suggested multipliers' })).toBeDisabled();
  await expect(page.getByText(/apply-and-refit integration not yet available \(separate task T15c\)/)).toBeVisible();
  await expect(page.getByText(/No model yet/)).toBeVisible(); // calibration stored no model
  const report = await page.getByTestId('calibration-report').innerText();
  writeFileSync(out('fixture-x1.3-report.txt'), report);
  writeFileSync(out('fixture-x1.3-summary.json'), JSON.stringify({ context: 'SYNTHETIC golden fixture context, real browser Worker/Comlink, unchanged roster.calibration-x1.3.json', ms, multiplier: m, selection: sel, reportId: await text(page, 'calib-id') }, null, 2));

  await axe(page, 'S07-calibration-fixture-light');
  await shot(page, 'S07-calibration-fixture-desktop-light');
  await setTheme(page, 'dark');
  await axe(page, 'S07-calibration-fixture-dark');
  await shot(page, 'S07-calibration-fixture-desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'S07-calibration-fixture-mobile-dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The theme control lives in the desktop rail: switch there, then shrink again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'S07-calibration-fixture-mobile-light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Session report survives client navigation; a roster change marks it STALE (never current).
  const id = await text(page, 'calib-id');
  await page.getByRole('link', { name: 'Roster', exact: true }).first().click();
  await page.locator('tbody th a').first().click();
  await expect(page.getByRole('heading', { name: 'Veteran detail' })).toBeVisible();
  const manual = page.getByRole('radio', { name: 'Manual' });
  const independent = page.getByRole('radio', { name: 'Independent' });
  // Controlled radio (mock PATCH settles asynchronously): click, then wait for the override.
  await ((await manual.isChecked()) ? independent : manual).click();
  await expect(page.getByText(/\(overridden\)/)).toBeVisible();
  await page.getByRole('link', { name: 'Health', exact: true }).first().click();
  await expect(page.getByTestId('calibration-report')).toBeVisible();
  expect(await text(page, 'calib-id')).toBe(id);
  await expect(page.getByTestId('calib-stale')).toContainText(/Stale report: roster changed/);
  await expect(page.getByTestId('calibration-report')).toHaveAttribute('data-stale', 'true');
  await axe(page, 'S07-calibration-stale-light');
  await shot(page, 'S07-calibration-stale-desktop-light', false);

  // Refit remains functional and does not touch the calibration report.
  await page.getByRole('button', { name: 'Refit model' }).click();
  await expect(page.getByText(/From the fit run in this tab/)).toBeVisible({ timeout: CAL_TIMEOUT });
  expect(await text(page, 'calib-id')).toBe(id);

  // Dismiss clears the report only.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText("Calibration hasn't been run.")).toBeVisible();
  await expect(page.getByText(/From the fit run in this tab/)).toBeVisible();
  const stored = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter((k) => /calib/i.test(k)));
  expect(stored).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('production (API mode, MOCK HTTP): published placeholder rules give nonidentifiable diagnostics; axe both themes', async ({ page }) => {
  test.setTimeout(300_000);
  await deterministic(page);
  const roster = goldenRoster();
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${path}`); await route.fulfill({ status: 500, json: { title: 'MOCK: no writes expected' } }); return; }
    if (path === '/model-snapshots') { await route.fulfill({ status: 404, json: { status: 404, title: 'MOCK no model' } }); return; }
    const data = path === '/health' ? { ok: true, masterVersion: masterBundle().version, dbSchemaVersion: 'MOCK' }
      : path === '/roster' ? roster : path === '/review-items' ? [] : path === '/cm-targets' ? goldenTargets() : path === '/owned-cards' ? [] : {};
    await route.fulfill({ json: data, headers: path === '/roster' ? { ETag: '"MOCK-e1"' } : {} });
  });
  await page.goto('http://127.0.0.1:5201/health');
  await expect(page.getByRole('heading', { name: 'Model health', exact: true })).toBeVisible();
  await expect(page.getByText(/No model yet/)).toBeVisible();
  const ms = await runCalibration(page);
  const sel = await text(page, 'calib-selection');
  console.log(`REAL BROWSER calibration (production placeholder, API-mode MOCK HTTP): ${ms} ms; selection: ${sel.replace(/\s+/g, ' ')}`);
  expect(sel).toMatch(/No multiplier selected: stats status nonidentifiable/);
  expect(sel).toMatch(/placeholder/);
  await expect(page.getByText(/Production context: the published rules verbatim/)).toBeVisible();
  await expect(page.getByTestId('apt-full')).toContainText(/unavailable \(zero-probability-observed/);
  await expect(page.getByTestId('apt-conditional')).toContainText(/possible cells/);
  await expect(page.getByTestId('calib-status')).not.toContainText('complete');
  await expect(page.getByText(/Suggested blueStatGain/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply suggested multipliers' })).toHaveCount(0);
  await expect(page.getByText(/apply-and-refit integration not yet available/)).toBeVisible();
  writeFileSync(out('production-placeholder-report.txt'), await page.getByTestId('calibration-report').innerText());
  await page.evaluate(() => { const n = document.createElement('div'); n.className = 'synthetic'; n.textContent = 'TEST MOCK HTTP — SYNTHETIC golden roster under the production context; no live API'; document.querySelector('main')!.prepend(n); });
  await axe(page, 'S07-calibration-production-light');
  await shot(page, 'S07-calibration-production-desktop-light');
  await setTheme(page, 'dark');
  await axe(page, 'S07-calibration-production-dark');
  await shot(page, 'S07-calibration-production-desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'S07-calibration-production-mobile-dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The theme control lives in the desktop rail: switch there, then shrink again.
  await page.setViewportSize({ width: 1440, height: 900 });
  await setTheme(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'S07-calibration-production-mobile-light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
