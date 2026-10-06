import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 120_000, workers: 1, fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5200', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'VITE_FIXTURES=1 pnpm exec vite --host 127.0.0.1 --port 5200 --strictPort', url: 'http://127.0.0.1:5200', reuseExistingServer: false },
    { command: 'pnpm exec vite --host 127.0.0.1 --port 5201 --strictPort', url: 'http://127.0.0.1:5201', reuseExistingServer: false },
  ],
});
