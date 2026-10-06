// Proves a production build carries no fixture data or fixture-only code (T13 review r1 N3).
// Usage: node scripts/check-dist.mjs [dist-dir] [--expect-fixtures]
// Markers are string literals / property names that survive minification:
//   "(fixture mode)" (fixture data source), "/fixtures/golden-truth.json" (golden loader),
//   "syntheticInheritance" (T08 loadGoldenContext), plus any emitted fixtures/*.json file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const expectFixtures = args.includes('--expect-fixtures');
const dir = resolve(import.meta.dirname, '..', args.find((a) => !a.startsWith('--')) ?? 'dist');
const MARKERS = ['(fixture mode)', '/fixtures/golden-truth.json', 'syntheticInheritance'];

const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
if (!existsSync(dir)) {
  console.error(`check-dist: ${dir} does not exist; build first`);
  process.exit(2);
}
walk(dir);
const fixtureFiles = files.filter((f) => relative(dir, f).startsWith('fixtures/'));
const hits = {};
for (const m of MARKERS) hits[m] = [];
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(f, 'utf8');
  for (const m of MARKERS) if (text.includes(m)) hits[m].push(relative(dir, f));
}
const report = { dir: relative(process.cwd(), dir) || '.', jsFiles: files.filter((f) => f.endsWith('.js')).map((f) => relative(dir, f)), fixtureFiles: fixtureFiles.map((f) => relative(dir, f)), markers: hits };
console.log(JSON.stringify(report, null, 2));
const found = fixtureFiles.length > 0 || Object.values(hits).some((h) => h.length > 0);
const allFound = fixtureFiles.length > 0 && Object.values(hits).every((h) => h.length > 0);
if (expectFixtures ? !allFound : found) {
  console.error(expectFixtures ? 'check-dist: FAIL — fixture build is missing fixture code/data' : 'check-dist: FAIL — production build contains fixture code/data');
  process.exit(1);
}
console.log(expectFixtures ? 'check-dist: OK — fixture build contains fixture code and data' : 'check-dist: OK — no fixture code or data in the production build');
