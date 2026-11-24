import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL_WEB;
if (!baseURL) {
  throw new Error('BASE_URL_WEB is required for Playwright');
}

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  workers: 1,
});
