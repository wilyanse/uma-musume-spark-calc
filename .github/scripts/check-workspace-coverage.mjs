#!/usr/bin/env node
// Fails unless every pnpm workspace package defines lint, typecheck and test (T12 review B3).
// `pnpm -r <script>` silently skips a package that lacks the script, so without this check a new
// package (for example @uma/engine) could be green in CI without running anything.
//
//   node .github/scripts/check-workspace-coverage.mjs <repo-root>
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = realpathSync(resolve(process.argv[2] ?? '.'));
const required = ['lint', 'typecheck', 'test'];
const listed = JSON.parse(
  execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: root, encoding: 'utf8' }),
);
const packages = listed.filter((p) => realpathSync(p.path) !== root);
if (packages.length === 0) {
  console.log('::error::workspace coverage: no workspace packages found');
  process.exit(1);
}
let failed = false;
for (const p of packages) {
  const scripts = JSON.parse(readFileSync(join(p.path, 'package.json'), 'utf8')).scripts ?? {};
  const missing = required.filter(
    (s) => typeof scripts[s] !== 'string' || scripts[s].trim() === '',
  );
  if (missing.length > 0) {
    failed = true;
    console.log(
      `::error::workspace coverage: ${p.name} is missing script(s): ${missing.join(', ')}`,
    );
  } else {
    console.log(`covered: ${p.name}`);
  }
}
if (failed) process.exit(1);
console.log(`workspace coverage ok: ${packages.length} packages run lint, typecheck and test`);
