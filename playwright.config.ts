import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  reporter: [['list']],
  use: {
    baseURL: process.env.WF_DEGIRO_E2E_BASE_URL ?? 'http://127.0.0.1:18088',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
