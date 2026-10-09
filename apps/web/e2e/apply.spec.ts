/**
 * T15c explicit browser-local apply/refit in a REAL browser: the real Vite worker + Comlink +
 * `calibrateRules` / `fitTrainingModelDetailed` / `rankPairsDetailed`. Nothing fabricates an
 * engine response.
 *
 * - Fixture mode (port 5200, SYNTHETIC golden context): `/fixtures/roster.json` is served with the
 *   committed, unchanged T08 planted ×1.3 roster file (bytes passed through). The planted value is
 *   never an input: calibration recovers ~×1.32 from the roster, and that REAL proposal is applied.
 *   The fixture snapshot store is an in-memory MOCK in the tab (never a server); its received ids
 *   are exposed by the fixture-only wiring as `__umaFixtureStoredSnapshots`.
 * - API mode (port 5201, production context): MOCK HTTP routes (labelled), no live API, no
 *   Cloudflare Access. Proves the placeholder report has no Apply and a stored fixture override is
 *   never applied to production; every non-GET request is recorded and must be none.
 * - One storage-failure path injects a throwing `localStorage.setItem` for the override key (a
 *   labelled fault injection, not a real quota event).
 *
 * Evidence: by default the ignored apps/web/test-results/t15c-assets; set T15C_E2E_ASSETS_DIR to
 * export (docs/changelog/assets/T15c).
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { goldenRoster, goldenTargets, goldenTruth, masterBundle } from '../test/fixtures.ts';

const assets = resolve(process.env.T15C_E2E_ASSETS_DIR ?? resolve(import.meta.dirname, '../test-results/t15c-assets'));
console.log(`T15c E2E assets → ${assets}`);
const out = (name: string) => (mkdirSync(assets, { recursive: true }), resolve(assets, name));
const X13 = resolve(import.meta.dirname, '../../../packages/engine/test/golden/roster.calibration-x1.3.json');
const clock = '2026-10-08T00:00:00.000Z';
const LONG = 120_000;
const OVR = 'uma:fixture:rules-override';
const LMODEL = 'uma:fixture:rules-override-model';
const log: Record<string, unknown> = {};

async function deterministic(page: Page, theme = 'light') {
  await page.addInitScript(({ clock, theme }) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: [] | [string | number]) { super(args.length ? args[0]! : clock); }
      static override now() { return RealDate.parse(clock); }
    }
    window.Date = FixedDate as DateConstructor;
    // Test-only deterministic browser ULID entropy. Worker fit/rank still use real seeded engine
    // algorithms; this does not modify a proposal, golden input, or production application code.
    let entropy = 0x15c;
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (array: ArrayBufferView) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i++) { entropy = (Math.imul(entropy, 1664525) + 1013904223) >>> 0; bytes[i] = entropy >>> 24; }
      return array;
    } });
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
async function shot(page: Page, name: string, selector?: string) {
  if (selector) await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: out(`${name}.png`), animations: 'disabled' });
}
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('combobox', { name: 'Theme', exact: true }).first().selectOption(theme);
}
async function themesAndViewports(page: Page, screen: string, selector: string) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await axe(page, `${screen}-${theme}`);
    await shot(page, `${screen}-desktop-${theme}`, selector);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, `${screen}-mobile-${theme}`, selector);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await setTheme(page, 'light');
}
const storedIds = (page: Page) => page.evaluate(() => [...((globalThis as { __umaFixtureStoredSnapshots?: string[] }).__umaFixtureStoredSnapshots ?? [])]);
const ls = (page: Page, k: string) => page.evaluate((k) => localStorage.getItem(k), k);
const attr = (page: Page, id: string, a: string) => page.getByTestId(id).getAttribute(a);

async function runCalibration(page: Page) {
  const btn = page.getByRole('button', { name: /^(Run|Retry) calibration$/ }).first();
  await expect(btn).toBeEnabled();
  const t0 = Date.now();
  await btn.click();
  await expect(page.getByTestId('calibration-report')).toBeVisible({ timeout: LONG });
  await expect(page.getByTestId('calib-stale')).toHaveCount(0);
  return Date.now() - t0;
}
async function rank(page: Page) {
  await page.getByRole('link', { name: 'Planner', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Rank pairs', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Rank pairs', exact: true }).click();
  await expect(page.getByTestId('rank-done')).toBeVisible({ timeout: LONG });
  return {
    snapshot: await attr(page, 'model-line', 'data-snapshot'),
    context: await attr(page, 'model-line', 'data-context'),
    local: await attr(page, 'model-line', 'data-local'),
    top: await page.locator('table tbody tr').first().locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.split('/').pop()).sort()),
  };
}
async function openApply(page: Page) {
  await page.getByRole('button', { name: 'Apply suggested multipliers' }).click();
  const dlg = page.getByRole('dialog', { name: 'Apply the suggested blueStatGain?' });
  await expect(dlg).toBeVisible();
  return dlg;
}

test('fixture: real calibrate → confirm → candidate fit → apply → Planner rank; cancel/fault/cross-tab/reload/recalibrate/reset; no overridden snapshot stored', async ({ page, context }) => {
  test.setTimeout(900_000);
  await deterministic(page);
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(`${r.method()} ${r.url()}`); });
  page.on('pageerror', (e) => errors.push(e.message));
  const x13 = readFileSync(X13);
  await context.route('**/fixtures/roster.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: x13 }));

  // 1) Base-context ranking first (its results must later read as stale under the override).
  await page.goto('/planner');
  await page.getByRole('button', { name: 'Use golden plan (SYNTHETIC)' }).click();
  const before = await rank(page);
  expect(before.local).toBe('false');
  const baseStored = await storedIds(page);
  expect(baseStored).toEqual([before.snapshot]); // base fit → MOCK snapshot store (allowed)
  log.baseRank = before;

  // 2) Health: REAL calibration of the unchanged ×1.3 roster.
  await page.getByRole('link', { name: 'Health', exact: true }).first().click();
  await expect(page.getByTestId('override-none')).toContainText(/SYNTHETIC golden fixture base context/);
  const baseFp = await attr(page, 'rules-override', 'data-context');
  const ms = await runCalibration(page);
  const sel = await page.getByTestId('calib-selection').innerText();
  const m = Number(/×(\d+\.\d+)/.exec(sel)![1]);
  console.log(`REAL BROWSER calibration (fixture ×1.3 roster): ${ms} ms; ${sel.replace(/\s+/g, ' ')}`);
  expect(m).toBeGreaterThanOrEqual(1.2);
  expect(m).toBeLessThanOrEqual(1.4);
  log.calibration = { ms, selection: sel, multiplier: m };

  // 3) Dialog shows old/new absolute tables; Cancel in the dialog changes nothing.
  let dlg = await openApply(page);
  const oldRow = (await dlg.getByTestId('apply-old').locator('td').allInnerTexts()).map(Number);
  const newRow = (await dlg.getByTestId('apply-new').locator('td').allInnerTexts()).map(Number);
  for (let i = 0; i < 3; i++) expect(newRow[i]! / oldRow[i]!).toBeCloseTo(m, 3);
  log.dialog = { old: oldRow, proposed: newRow };
  await expect(dlg).toContainText('Unverified');
  await expect(dlg).toContainText('THIS browser');
  await axe(page, 'S07-apply-dialog-light');
  await shot(page, 'S07-apply-dialog-desktop-light');
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await ls(page, OVR)).toBeNull();

  // 4) Cancel during the candidate job: nothing committed, the active context unchanged. The
  //    ISOLATED candidate worker's script load is held (route delay) so the cancel deterministically
  //    lands while the candidate is in flight; the active worker already exists and is unaffected.
  let held = 0;
  const hold = async (route: import('@playwright/test').Route) => { held++; await new Promise((r) => setTimeout(r, 4000)); await route.continue().catch(() => undefined); };
  await context.route(/engine\.worker\.ts/, hold);
  dlg = await openApply(page);
  await dlg.getByRole('button', { name: 'Fit and apply' }).click();
  await expect(page.getByTestId('apply-running')).toBeVisible();
  await shot(page, 'S07-apply-running-desktop-light', '[data-testid="apply-running"]');
  await expect.poll(() => held).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Cancel apply' }).click();
  await context.unroute(/engine\.worker\.ts/, hold);
  await expect(page.getByTestId('apply-result')).toContainText('Apply cancelled. Nothing was applied');
  expect(await ls(page, OVR)).toBeNull();
  expect(await ls(page, LMODEL)).toBeNull();
  expect(await attr(page, 'rules-override', 'data-context')).toBe(baseFp);

  // 5) Storage fault injection (labelled): the override write throws → rollback, truthful failure.
  await page.evaluate((key) => {
    const real = Storage.prototype.setItem;
    (window as { __restoreSetItem?: () => void }).__restoreSetItem = () => { Storage.prototype.setItem = real; };
    Storage.prototype.setItem = function (k: string, v: string) { if (k === key) throw new DOMException('INJECTED TEST FAULT', 'QuotaExceededError'); return real.call(this, k, v); };
  }, OVR);
  dlg = await openApply(page);
  await dlg.getByRole('button', { name: 'Fit and apply' }).click();
  await expect(page.getByTestId('apply-result')).toContainText(/override couldn't be saved.*INJECTED TEST FAULT.*Nothing was applied/, { timeout: LONG });
  await page.evaluate(() => (window as { __restoreSetItem?: () => void }).__restoreSetItem!());
  expect(await ls(page, OVR)).toBeNull();
  expect(await ls(page, LMODEL)).toBeNull();
  await expect(page.getByTestId('override-none')).toBeVisible();

  // 6) Second tab on Health (same browser storage): it must follow the apply via the storage event.
  const tab2 = await context.newPage();
  await deterministic(tab2);
  await tab2.goto('/health');
  await expect(tab2.getByTestId('override-none')).toBeVisible();

  // Tab 2 holds the REAL browser exclusive lock. Candidate fitting proceeds, but the commit
  // queues until that tab releases it (localStorage alone cannot implement an atomic CAS).
  await tab2.evaluate(() => {
    void navigator.locks.request('uma:fixture:rules-transaction', { mode: 'exclusive' }, async () => {
      (window as { __lockHeld?: boolean }).__lockHeld = true;
      await new Promise<void>((resolve) => { (window as { __releaseRulesLock?: () => void }).__releaseRulesLock = resolve; });
    });
  });
  await expect.poll(() => tab2.evaluate(() => (window as { __lockHeld?: boolean }).__lockHeld)).toBe(true);
  // 7) Apply for real.
  dlg = await openApply(page);
  const t0 = Date.now();
  await dlg.getByRole('button', { name: 'Fit and apply' }).click();
  await expect.poll(() => tab2.evaluate(async () => (await navigator.locks.query()).pending?.filter((l) => l.name === 'uma:fixture:rules-transaction').length ?? 0), { timeout: LONG }).toBe(1);
  expect(await ls(page, OVR)).toBeNull();
  expect(await ls(page, LMODEL)).toBeNull();
  await tab2.evaluate(() => (window as { __releaseRulesLock?: () => void }).__releaseRulesLock!());
  log.crossTabExclusiveLock = 'REAL Web Locks: isolated candidate fit queued; neither model nor override persisted until other tab released exclusive lock';
  await expect(page.getByTestId('apply-result')).toContainText('Applied in this browser only', { timeout: LONG });
  const applyMs = Date.now() - t0;
  const stored = JSON.parse((await ls(page, OVR))!);
  let env = JSON.parse((await ls(page, LMODEL))!);
  expect(stored).toMatchObject({ schema: 'uma-browser-rules-override', v: 1, mode: 'fixture', revision: 1 });
  expect(stored.active.verified).toBe(false);
  expect(stored.active.proposed.map((x: number) => Math.round(x * 1e4) / 1e4)).toEqual(newRow);
  await expect(page.getByTestId('override-active')).toBeVisible();
  const ovFp = await attr(page, 'rules-override', 'data-context');
  expect(ovFp).not.toBe(baseFp);
  expect(await attr(page, 'rules-override', 'data-base-context')).toBe(baseFp);
  expect(env.contextFingerprint).toBe(ovFp);
  expect(env.baseFingerprint).toBe(baseFp);
  await expect(page.getByTestId('model-origin')).toContainText('browser-local model');
  expect(await attr(page, 'model-origin', 'data-snapshot')).toBe(env.snapshot.id);
  // The effective rules table shows the applied values and source, not the published ones.
  const row = page.locator('tr', { has: page.locator('th', { hasText: /^blueStatGain$/ }) });
  const rowText = await row.innerText();
  for (const x of newRow) expect(rowText).toContain(String(x));
  expect(rowText).toMatch(/BROWSER-LOCAL override/);
  await expect(page.getByTestId('calib-stale')).toContainText(/rules changed/);
  await expect(page.getByRole('button', { name: 'Apply suggested multipliers' })).toBeDisabled();
  expect(await storedIds(page)).toEqual(baseStored); // the overridden model was NOT stored
  await expect(tab2.getByTestId('override-active')).toBeVisible({ timeout: 30_000 });
  expect(await attr(tab2, 'rules-override', 'data-context')).toBe(ovFp);
  console.log(`REAL BROWSER apply (candidate fit + commit): ${applyMs} ms; context ${baseFp!.slice(0, 19)}… → ${ovFp!.slice(0, 19)}…; local snapshot ${env.snapshot.id}`);
  log.apply = { ms: applyMs, baseFp, ovFp, override: stored.active, localSnapshot: env.snapshot.id, storedSnapshots: await storedIds(page) };
  // REAL Health refit under the override must also stay browser-only.
  const candidateSnapshot = env.snapshot.id;
  await page.getByRole('button', { name: 'Refit model', exact: true }).click();
  await expect.poll(() => attr(page, 'model-origin', 'data-snapshot'), { timeout: LONG }).not.toBe(candidateSnapshot);
  env = JSON.parse((await ls(page, LMODEL))!);
  expect(env.contextFingerprint).toBe(ovFp);
  expect(await attr(page, 'model-origin', 'data-snapshot')).toBe(env.snapshot.id);
  expect(await storedIds(page)).toEqual(baseStored);
  log.healthRefit = { candidateSnapshot, refittedSnapshot: env.snapshot.id, context: env.contextFingerprint, storedSnapshots: await storedIds(page) };
  await themesAndViewports(page, 'S07-applied', '[data-testid="rules-override"]');
  writeFileSync(out('applied-health.txt'), await page.locator('main').innerText());

  // 8) Planner: earlier results stale; ranking uses the committed local model and new identity.
  await page.getByRole('link', { name: 'Planner', exact: true }).first().click();
  await expect(page.getByTestId('planner-override')).toBeVisible();
  await expect(page.getByTestId('rank-stale')).toHaveCount(0); // results do not survive route remount
  const after = await rank(page);
  expect(after).toMatchObject({ local: 'true', context: ovFp, snapshot: env.snapshot.id });
  await expect(page.getByText(/Model fitted because/)).toHaveCount(0); // reused the candidate model
  expect(await storedIds(page)).toEqual(baseStored);
  console.log(`REAL BROWSER ranking under override: top pair ${after.top.join(' + ')} (base: ${before.top.join(' + ')})`);
  log.overrideRank = after;
  await themesAndViewports(page, 'S06-override', '[data-testid="planner-override"]');

  // 9) Reload: the override persists, the same identity is rebuilt; recalibrate on it (no compounding).
  await page.reload();
  await page.getByRole('link', { name: 'Health', exact: true }).first().click();
  await expect(page.getByTestId('override-active')).toBeVisible();
  expect(await attr(page, 'rules-override', 'data-context')).toBe(ovFp);
  await expect(page.getByTestId('model-origin')).toContainText('browser-local model');
  await runCalibration(page);
  const sel2 = await page.getByTestId('calib-selection').innerText();
  const m2 = Number(/×(\d+\.\d+)/.exec(sel2)?.[1] ?? 'NaN');
  console.log(`REAL BROWSER recalibration on the applied context: ${sel2.replace(/\s+/g, ' ')}`);
  expect(Math.abs(m2 - 1)).toBeLessThanOrEqual(0.05);
  log.recalibration = { selection: sel2, multiplier: m2, suggestions: await page.getByTestId('calib-suggestions').innerText() };
  writeFileSync(out('recalibration-on-applied-report.txt'), await page.getByTestId('calibration-report').innerText());

  // 10) After reload the Planner reuses the committed local model (no refit, nothing stored).
  const reloaded = await rank(page);
  expect(reloaded).toMatchObject({ local: 'true', context: ovFp, snapshot: env.snapshot.id });
  await expect(page.getByText(/Model fitted because/)).toHaveCount(0);
  expect(await storedIds(page)).toEqual([]); // fresh tab MOCK store: still nothing stored
  log.reloadRank = reloaded;

  // REAL Planner auto-fit after loss of its browser-local snapshot: never fall back to a server model.
  await page.evaluate((key) => localStorage.removeItem(key), LMODEL);
  await page.reload();
  const auto = await rank(page);
  expect(auto).toMatchObject({ local: 'true', context: ovFp });
  expect(auto.snapshot).not.toBe(env.snapshot.id);
  expect(await storedIds(page)).toEqual([]);
  env = JSON.parse((await ls(page, LMODEL))!);
  expect(env.snapshot.id).toBe(auto.snapshot);
  log.plannerAutoFit = auto;
  // Reload intentionally cleared session-only reports. Produce a fresh effective-context report
  // before reset so the stale-report assertion tests an existing report, not an absent cache entry.
  await page.getByRole('link', { name: 'Health', exact: true }).first().click();
  await runCalibration(page);
  await rank(page);

  // 11) Reset from tab 2 while tab 1 shows override rankings: tab 1's results turn stale; the
  //     labelled FIXTURE base (never the published rules) is in force again.
  await tab2.reload();
  await tab2.getByRole('button', { name: 'Reset to fixture base rules' }).click();
  const rdlg = tab2.getByRole('dialog', { name: 'Reset to fixture base rules?' });
  await expect(rdlg).toContainText('SYNTHETIC golden fixture base context');
  await axe(tab2, 'S07-reset-dialog-light');
  await shot(tab2, 'S07-reset-dialog-desktop-light');
  await rdlg.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(tab2.getByTestId('rules-note')).toContainText('Reset done. The SYNTHETIC golden fixture base context');
  expect(JSON.parse((await ls(tab2, OVR))!)).toMatchObject({ revision: 2, active: null });
  expect(await ls(tab2, LMODEL)).toBeNull();
  await expect(page.getByTestId('rank-stale')).toContainText('ranked under a different rules context', { timeout: 30_000 });
  await expect(page.getByTestId('planner-override')).toHaveCount(0);
  await shot(page, 'S06-stale-after-reset-desktop-light', '[data-testid="rank-stale"]');
  await page.getByRole('link', { name: 'Health', exact: true }).first().click();
  await expect(page.getByTestId('override-none')).toBeVisible();
  expect(await attr(page, 'rules-override', 'data-context')).toBe(baseFp);
  await expect(page.getByTestId('calib-stale')).toContainText(/rules changed/);
  await shot(page, 'S07-reset-desktop-light', '[data-testid="rules-override"]');
  const afterReset = await rank(page);
  expect(afterReset).toMatchObject({ local: 'false', context: baseFp });
  expect(afterReset.snapshot).not.toBe(env.snapshot.id);
  expect(await storedIds(page)).toEqual([afterReset.snapshot]); // base-context refit, stored as before
  log.resetRank = afterReset;
  writeFileSync(out('t15c-browser-run.json'), JSON.stringify({ note: 'REAL browser Worker/Comlink, SYNTHETIC golden fixture context, unchanged roster.calibration-x1.3.json; MOCK in-tab snapshot store; not real-game evidence', ...log }, null, 2));
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('production (API mode, MOCK HTTP): no Apply for placeholder; a fixture-bound stored override is refused; no writes; axe both themes', async ({ page }) => {
  test.setTimeout(300_000);
  await deterministic(page);
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const roster = goldenRoster();
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${path}`); await route.fulfill({ status: 500, json: { title: 'MOCK: no writes expected' } }); return; }
    if (path === '/model-snapshots') { await route.fulfill({ status: 404, json: { status: 404, title: 'MOCK no model' } }); return; }
    const data = path === '/health' ? { ok: true, masterVersion: masterBundle().version, dbSchemaVersion: 'MOCK' }
      : path === '/roster' ? roster : path === '/review-items' ? [] : path === '/cm-targets' ? goldenTargets() : path === '/owned-cards' ? [] : {};
    await route.fulfill({ json: data, headers: path === '/roster' ? { ETag: '"MOCK-e1"' } : {} });
  });
  // A record under the api key that is bound to the SYNTHETIC fixture context (e.g. hand-copied storage).
  const t = goldenTruth() as unknown as { syntheticInheritance: { rulesOverrides: { blueStatGain: Record<'1' | '2' | '3', number> } } };
  const g = t.syntheticInheritance.rulesOverrides.blueStatGain;
  await page.addInitScript(({ rec }) => { if (!localStorage.getItem('uma:api:rules-override')) localStorage.setItem('uma:api:rules-override', rec); }, {
    rec: JSON.stringify({ schema: 'uma-browser-rules-override', v: 1, mode: 'api', revision: 1, active: {
      id: '01KGQZ0000G01DENCM00T15CE1', appliedAt: clock, rule: 'blueStatGain', proposed: [g['1'] * 1.32, g['2'] * 1.32, g['3'] * 1.32], verified: false, source: 'TEST record bound to the fixture context',
      sourceReport: { id: '01KGQZ0000G01DENCM00T15CE2', generatedAt: clock, multiplier: 1.32, contextFingerprint: `sha256:${'1'.repeat(64)}`, current: [g['1'], g['2'], g['3']], rosterEtag: null, rosterIdentity: 'x' },
      base: { contextKind: 'golden-fixture', masterVersion: masterBundle().version, rulesVersion: 'rules-1', fingerprint: `sha256:${'1'.repeat(64)}` } } }),
  });
  await page.goto('http://127.0.0.1:5201/health');
  await expect(page.getByTestId('override-problem')).toContainText(/golden-fixture context, but this app runs the production context/);
  await expect(page.getByTestId('override-none')).toContainText('the published rules');
  const row = page.locator('tr', { has: page.locator('th', { hasText: /^blueStatGain$/ }) });
  await expect(row).toContainText('1★ 0 · 2★ 0 · 3★ 0');
  await runCalibration(page);
  await expect(page.getByTestId('calib-selection')).toContainText(/No multiplier selected: stats status nonidentifiable/);
  await expect(page.getByRole('button', { name: 'Apply suggested multipliers' })).toHaveCount(0);
  await page.evaluate(() => { const n = document.createElement('div'); n.className = 'synthetic'; n.textContent = 'TEST MOCK HTTP — SYNTHETIC golden roster under the production context; no live API'; document.querySelector('main')!.prepend(n); });
  await themesAndViewports(page, 'S07-production', '[data-testid="rules-override"]');
  // Explicit clear of the unusable record (local only; no request).
  await page.getByRole('button', { name: 'Clear the stored override' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear it' }).click();
  await expect(page.getByTestId('rules-note')).toContainText('The stored override record was cleared');
  await expect(page.getByTestId('override-problem')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
