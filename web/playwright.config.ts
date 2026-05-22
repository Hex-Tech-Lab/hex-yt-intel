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
      env: {
        NODE_ENV: 'production',
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpLW1vY2stcHJvamVjdCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjIwMDAwMDAwLCJleHAiOjE5MzA3NjU5OTl9.mock_anon_key_string_long_enough_for_validation',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpLW1vY2stcHJvamVjdCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE2MjAwMDAwMDAsImV4cCI6MTkzMDc2NTk5OX0.mock_service_role_key_string_long_enough_for_validation',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || 'sk-or-v1-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz5',
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'mock-nextauth-secret-32-characters-long-minimum-requirement',
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_mock_stripe_secret_key_long_enough_for_validation_requirements',
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_mock_webhook_secret_key_long_enough_for_validation_gates',
      },
    };
  })(),

  timeout: 30 * 1000,
  expect: {
    timeout: 5 * 1000,
  },
});
