/* global process, console */
// Generates apps/web/src/styles/tokens.css from docs/design/tokens.json (60 §1: `pnpm --filter web tokens`).
// Same mapping as docs/design/build.mjs (dots -> dashes), so the app and the approved prototypes share
// one token source. `--check` exits 1 when the committed file is stale (used by a unit test too).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = join(here, '../../../docs/design/tokens.json');
const outPath = join(here, '../src/styles/tokens.css');

export function renderTokensCss(tokens) {
  const cssName = (k) => k.replaceAll('.', '-');
  const colorVars = (c) =>
    Object.entries(c)
      .map(([k, v]) => `--${cssName(k)}:${v};`)
      .join('');
  const shadowVars = (s) =>
    Object.entries(s)
      .map(([k, v]) => `--shadow-${k}:${v};`)
      .join('');
  const staticVars = [
    ...Object.entries(tokens.space).map(([k, v]) => `--space-${k}:${v};`),
    ...Object.entries(tokens.radius).map(([k, v]) => `--radius-${k}:${v};`),
    ...Object.entries(tokens.font).map(([k, v]) => `--font-${k}:${v};`),
    ...Object.entries(tokens.type).map(([k, v]) => `--type-${k}:${v};`),
    ...Object.entries(tokens.layout).map(([k, v]) => `--${k}:${v};`),
  ].join('');
  const dark = `${colorVars(tokens.color.dark)}${shadowVars(tokens.shadow.dark)}`;
  return `/* GENERATED from docs/design/tokens.json by apps/web/scripts/tokens.mjs. Do not edit. */
:root{${staticVars}${colorVars(tokens.color.light)}${shadowVars(tokens.shadow.light)}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${dark}}}
:root[data-theme=dark]{${dark}}
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const css = renderTokensCss(JSON.parse(readFileSync(tokensPath, 'utf8')));
  if (process.argv.includes('--check')) {
    const current = readFileSync(outPath, 'utf8');
    if (current !== css) {
      console.error('tokens.css is stale: run `pnpm --filter web tokens`');
      process.exit(1);
    }
    console.log('tokens.css is up to date');
  } else {
    writeFileSync(outPath, css);
    console.log(`wrote ${outPath}`);
  }
}
