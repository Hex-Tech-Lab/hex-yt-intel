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

  webServer: (() => {
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    return {
      command: isCI
        ? 'pnpm --filter @hex-yt-intel/web run build && pnpm --filter @hex-yt-intel/web run start'
        : 'pnpm run dev',
      cwd: isCI ? '..' : '.',
      url: 'http://localhost:3000',
      reuseExistingServer: !isCI,
      timeout: 180000,
    };
  })(),

  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
});
