import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

/**
 * Fixture-mode plumbing (60 §3, T08 S4/N3): `apps/web/fixtures/*.json` (the committed T08 golden
 * copies, read-only) are served at `/fixtures/<name>.json` by the dev/preview server and emitted
 * into the build ONLY when `VITE_FIXTURES=1`. A production build never contains them.
 */
function fixtures(enabled: boolean): Plugin {
  const serve: NonNullable<Plugin['configureServer']> = (server) => {
    if (!enabled) return;
    server.middlewares.use('/fixtures', (req, res, next) => {
      const name = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
      if (!/^[a-z0-9-]+\.json$/.test(name) || !existsSync(join(FIXTURES_DIR, name))) return next();
      res.setHeader('content-type', 'application/json');
      res.end(readFileSync(join(FIXTURES_DIR, name)));
    });
  };
  return {
    name: 'uma-fixtures',
    configureServer: serve,
    generateBundle() {
      if (!enabled) return;
      for (const name of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'))) {
        this.emitFile({
          type: 'asset',
          fileName: `fixtures/${name}`,
          source: readFileSync(join(FIXTURES_DIR, name)),
        });
      }
    },
  };
}

/**
 * Fixture-only modules (T13 review r1 N3): `src/fixture-only/<name>.ts` resolves to
 * `<name>.disabled.ts` (a null stub) unless fixture mode is on or Vitest is running, so the fixture
 * data source, the golden-truth loader and T08's `loadGoldenContext` are not compiled into the
 * production main or worker bundles at all. `pnpm --filter web check:dist` proves it on `dist/`.
 */
const FIXTURE_ONLY_DIR = resolve(import.meta.dirname, 'src/fixture-only');
function fixtureOnly(enabled: boolean): Plugin {
  return {
    name: 'uma-fixture-only',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (enabled || !importer) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || !r.id.startsWith(`${FIXTURE_ONLY_DIR}/`) || r.id.endsWith('.disabled.ts')) return null;
      return r.id.replace(/\.ts$/, '.disabled.ts');
    },
  };
}

export default defineConfig(() => {
  const fixtureMode = process.env.VITE_FIXTURES === '1';
  const keepFixtureOnly = fixtureMode || process.env.VITEST !== undefined;
  return {
    plugins: [fixtureOnly(keepFixtureOnly), react(), fixtures(fixtureMode)],
    worker: { format: 'es' as const, plugins: () => [fixtureOnly(keepFixtureOnly)] },
    build: { reportCompressedSize: true },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
      setupFiles: ['./test/setup.ts'],
      testTimeout: 30_000,
    },
  };
});
