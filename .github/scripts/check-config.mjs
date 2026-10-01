#!/usr/bin/env node
// Static checks on apps/api/wrangler.jsonc and committed master data (T12 review S3/S8).
//
//   node .github/scripts/check-config.mjs <repo-root>                       CI: structure + MASTER_VERSION
//   node .github/scripts/check-config.mjs <repo-root> --require-provisioned  deploy: also real IDs
//
// Reads files only. Never runs candidate code, never prints secrets (there are none in these files).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, flag] = process.argv.slice(2);
if (!root || (flag !== undefined && flag !== '--require-provisioned')) {
  console.error('usage: check-config.mjs <repo-root> [--require-provisioned]');
  process.exit(2);
}
const requireProvisioned = flag === '--require-provisioned';

/** Strips // and /* comments plus trailing commas, respecting string literals. */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated block comment');
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const errors = [];
const check = (ok, message) => {
  if (!ok) errors.push(message);
};

const wrangler = parseJsonc(readFileSync(join(root, 'apps/api/wrangler.jsonc'), 'utf8'));
const latest = JSON.parse(readFileSync(join(root, 'apps/web/public/master/latest.json'), 'utf8'));
const prod = wrangler.env?.production;

check(prod !== undefined, 'env.production is missing');
if (prod) {
  const d1 = prod.d1_databases ?? [];
  const r2 = prod.r2_buckets ?? [];
  const vars = prod.vars ?? {};
  check(prod.name === 'uma-spark-calc', 'env.production.name must be uma-spark-calc');
  check(
    prod.preview_urls === false,
    'env.production.preview_urls must be false (version URLs bypass the hostname Access app)',
  );
  check(
    d1.length === 1 && d1[0].binding === 'DB' && d1[0].database_name === 'uma-spark-calc',
    'env.production D1 must be DB -> uma-spark-calc',
  );
  check(
    r2.length === 1 && r2[0].binding === 'CROPS' && r2[0].bucket_name === 'uma-spark-calc-crops',
    'env.production R2 must be CROPS -> uma-spark-calc-crops',
  );
  check(!('AUTH_DISABLED' in vars), 'env.production must not define AUTH_DISABLED');
  check(!('ACCESS_AUD' in vars), 'ACCESS_AUD is a Worker secret, not a var');
  check(
    vars.MASTER_VERSION === latest.version,
    `env.production MASTER_VERSION (${vars.MASTER_VERSION}) must equal apps/web/public/master/latest.json version (${latest.version})`,
  );
  check(
    typeof latest.version === 'string' &&
      existsSync(join(root, 'apps/web/public/master', latest.version)),
    `apps/web/public/master/${latest.version}/ is missing`,
  );
  if (requireProvisioned) {
    const id = d1[0]?.database_id ?? '';
    check(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
        !/^[0-]+$/.test(id),
      'env.production D1 database_id is still the placeholder (H2 step 3)',
    );
    check(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(
        vars.ACCESS_TEAM_DOMAIN ?? '',
      ),
      'env.production ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com (H2 step 2)',
    );
  }
}

if (errors.length > 0) {
  for (const e of errors) console.log(`::error::config check: ${e}`);
  process.exit(1);
}
console.log(
  `config check ok (${requireProvisioned ? 'provisioned' : 'structure'}): MASTER_VERSION=${latest.version}`,
);
