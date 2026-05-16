import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm run dev',
    cwd: '.',
    url: "http://localhost:3005",
    reuseExistingServer: false,
    timeout: 120000,
  },

  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
});
