// Verifies docs/design deliverables: files exist, PNG dimensions match, contrast pairs pass AA.
// Usage: node verify.mjs   (exit code 1 on any failure)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const fail = (m) => { failures++; console.log('FAIL', m); };

// ---- required files
const required = ['tokens.json', 'tokens.css', 'manifest.json', 'components.md', 'bindings.md', 'copy.md', 'index.html'];
for (const f of required) if (!existsSync(join(dir, f))) fail(`missing ${f}`);
const screens = ['S01-roster', 'S02-veteran', 'S03-review', 'S04-cards', 'S05-targets', 'S06-planner', 'S07-health'];
for (const s of screens) if (!existsSync(join(dir, 'screens', s + '.html'))) fail(`missing screens/${s}.html`);
console.log(`files: ${required.length} top-level + ${screens.length} screen html checked`);

// ---- manifest + PNG dimensions
const manifest = existsSync(join(dir, 'manifest.json')) ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) : [];
const expectedCombos = new Set();
for (const s of screens) {
  expectedCombos.add(`${s}|light|1440x900`); expectedCombos.add(`${s}|dark|1440x900`); expectedCombos.add(`${s}|light|390x844`);
}
if (manifest.length !== 21) fail(`manifest has ${manifest.length} entries, expected 21`);
const seen = new Set();
function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
for (const e of manifest) {
  const key = `${e.screen}|${e.theme}|${e.viewport}`;
  if (seen.has(key)) fail(`duplicate manifest entry ${key}`);
  seen.add(key);
  if (!expectedCombos.has(key)) fail(`unexpected manifest entry ${key}`);
  const p = join(dir, e.file);
  if (!existsSync(p)) { fail(`missing png ${e.file}`); continue; }
  const size = pngSize(readFileSync(p));
  const want = e.viewport.split('x').map(Number);
  if (!size || size[0] !== want[0] || size[1] !== want[1]) fail(`${e.file} is ${size} expected ${want}`);
}
for (const k of expectedCombos) if (!seen.has(k)) fail(`manifest lacks ${k}`);
console.log(`manifest: ${manifest.length} PNGs checked for existence and exact dimensions`);

// ---- contrast
const tokens = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let n = 0;
for (const pair of tokens['contrast-pairs']) {
  for (const theme of pair.themes) {
    const c = tokens.color[theme];
    const fg = c[pair.fg], bg = c[pair.bg];
    if (!fg || !bg) { fail(`unknown token in pair ${pair.fg}/${pair.bg} (${theme})`); continue; }
    const r = ratio(fg, bg); n++;
    if (r < pair.min) fail(`${theme} ${pair.fg} on ${pair.bg}: ${r.toFixed(2)} < ${pair.min} (${pair.note})`);
    else console.log(`ok   ${theme.padEnd(5)} ${pair.fg} on ${pair.bg}: ${r.toFixed(2)} >= ${pair.min}`);
  }
}
console.log(`contrast: ${n} pair checks`);
console.log(failures ? `RESULT: ${failures} failure(s)` : 'RESULT: all checks passed');
process.exit(failures ? 1 : 0);
