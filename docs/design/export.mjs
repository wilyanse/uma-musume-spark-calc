// Exports screens/*.png (1440x900 light+dark, 390x844 light) and writes manifest.json.
// Usage: npm install && npx playwright install chromium && node export.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const screens = ['S01-roster', 'S02-veteran', 'S03-review', 'S04-cards', 'S05-targets', 'S06-planner', 'S07-health'];
const shots = [
  { theme: 'light', w: 1440, h: 900, tag: 'desktop-light' },
  { theme: 'dark', w: 1440, h: 900, tag: 'desktop-dark' },
  { theme: 'light', w: 390, h: 844, tag: 'mobile-light' },
];
const browser = await chromium.launch();
const manifest = [];
for (const s of screens) {
  for (const sh of shots) {
    const ctx = await browser.newContext({ viewport: { width: sh.w, height: sh.h }, deviceScaleFactor: 1, colorScheme: sh.theme });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(join(dir, 'screens', `${s}.html`)).href);
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), sh.theme);
    const file = `screens/${s}-${sh.tag}.png`;
    await page.screenshot({ path: join(dir, file) });
    manifest.push({ screen: s, theme: sh.theme, viewport: `${sh.w}x${sh.h}`, file });
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`exported ${manifest.length} PNGs`);
