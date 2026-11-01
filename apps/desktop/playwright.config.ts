// End-to-end tests of the desktop app: Playwright drives the real Electron app (built with
// `pnpm build && pnpm --filter @wirewright/desktop build`). On Linux without a display run them
// with `xvfb-run -a pnpm --filter @wirewright/desktop e2e`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]] : 'list',
  outputDir: 'e2e-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
