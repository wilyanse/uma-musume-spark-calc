// Playwright probe at 390x844: every visible header cell must sit over a visible body cell (same x-range, same count), and no cell may clip.
// Usage: node probe-mobile.mjs [S07-health ...]   (default: S07-health, S01-roster, S06-planner)
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['S07-health', 'S01-roster', 'S06-planner'];
const browser = await chromium.launch();
let bad = 0;
for (const n of names) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('file://' + join(dir, 'screens', n + '.html'));
  const res = await page.evaluate(() => {
    const vis = (e) => getComputedStyle(e).display !== 'none';
    return [...document.querySelectorAll('table')].map((t) => {
      const wrap = t.closest('.tbl-wrap');
      const heads = [...t.querySelectorAll('thead th')].filter(vis);
      const row = [...t.querySelector('tbody tr').children].filter(vis);
      const cells = [...t.querySelectorAll('th,td')].filter(vis);
      const clipped = cells.filter((c) => c.scrollWidth > c.clientWidth + 1).length;
      const misaligned = heads.filter((h, i) => !row[i] || Math.abs(h.getBoundingClientRect().left - row[i].getBoundingClientRect().left) > 1 || Math.abs(h.getBoundingClientRect().width - row[i].getBoundingClientRect().width) > 1).length;
      return { caption: (t.querySelector('caption')?.textContent || '').trim(), heads: heads.length, bodyCells: row.length, misaligned, clipped, wrapOverflow: wrap.scrollWidth - wrap.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth };
    });
  });
  for (const r of res) { const ok = r.heads === r.bodyCells && !r.misaligned && !r.clipped && r.wrapOverflow <= 0 && r.pageOverflow <= 0; if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', n, JSON.stringify(r)); }
  await page.close();
}
await browser.close();
console.log(bad ? `RESULT: ${bad} table(s) failed` : 'RESULT: all tables aligned, nothing clipped');
process.exit(bad ? 1 : 0);
