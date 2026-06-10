import { defineConfig, devices } from '@playwright/test';

// Production verification runs against a live deployment (DEPLOYMENT_URL), so it
// must NOT boot a local `pnpm dev` server. Booting one is slow and fragile and
// was the cause of the "frontend rendering check" hang/failure. When DEPLOYMENT_URL
// is set we skip the webServer entirely and target the deployment directly.
const deploymentUrl = process.env.DEPLOYMENT_URL;

export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.RUN_PAIRWISE === 'true' ? [] : ['**/pairwise_matrix/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [['list'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL: deploymentUrl || process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },

  // Only spin up a local dev server for local/CI suites that target localhost.
  // Skipped for production verification (DEPLOYMENT_URL set).
  webServer: deploymentUrl ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'production',
      CI: process.env.CI || 'false',
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS || 'false',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || 'placeholder',
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'placeholder',
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'placeholder',
      NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
      CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev',
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
      UPSTASH_VECTOR_REST_URL: process.env.UPSTASH_VECTOR_REST_URL || '',
      UPSTASH_VECTOR_REST_TOKEN: process.env.UPSTASH_VECTOR_REST_TOKEN || '',
      QSTASH_URL: process.env.QSTASH_URL || '',
      QSTASH_TOKEN: process.env.QSTASH_TOKEN || '',
      QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY || '',
      QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY || '',
      DEV_BYPASS_TOKEN: process.env.DEV_BYPASS_TOKEN || 'test-token',
      VERCEL_TOKEN: process.env.VERCEL_TOKEN || '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_placeholder',
    },
    timeout: 180000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
});
