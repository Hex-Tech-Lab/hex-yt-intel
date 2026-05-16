import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../docs/testing',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'https://yt-intel.getmytestdrive.com',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No local webServer — all tests run against Vercel production
  timeout: 60 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
});
