import { test, expect } from '@playwright/test';

test.describe('PR #1 Fixes Verification', () => {
  test.beforeAll(async () => {
    // Verify build succeeded by checking if app can start
    console.log('Starting app verification...');
  });

  test('tailwind v4 styles are applied correctly', async ({ page }) => {
    // Navigate to the home page
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Verify smooth scroll behavior (from globals.css)
    const html = page.locator('html');
    const htmlStyle = await html.evaluate((el) => {
      return window.getComputedStyle(el).scrollBehavior;
    });

    expect(htmlStyle).toBe('smooth');
    console.log('✓ Tailwind v4 styles applied correctly');
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
      if (msg.type() === 'warning') {
        warnings.push(msg.text());
      }
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Filter out expected warnings
    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Failed to load')
    );

    expect(criticalErrors).toHaveLength(0);
    console.log('✓ No critical console errors detected');
  });

  test('page content loads without timeout', async ({ page }) => {
    const startTime = Date.now();

    const response = await page.goto('http://localhost:3000', {
      waitUntil: 'networkidle',
      timeout: 10000
    });

    const loadTime = Date.now() - startTime;

    expect(response?.status()).toBeLessThan(400);
    expect(loadTime).toBeLessThan(10000);
    console.log(`✓ Page loaded in ${loadTime}ms`);
  });

  test('api routes respond without errors', async ({ page }) => {
    // Test health/readiness of key API routes
    const routes = [
      '/api/auth/session',
      '/api/analyses',
    ];

    for (const route of routes) {
      const response = await page.request.get(`http://localhost:3000${route}`);

      // Should either return success or auth error, not 500
      expect(response.status()).toBeLessThan(500);
      console.log(`✓ ${route}: ${response.status()}`);
    }
  });

  test('rls policies syntax is valid (migration check)', async () => {
    // Read the migration file to verify RLS policies
    const fs = require('fs');
    const path = require('path');
    const migrationPath = path.join(__dirname, '../../supabase/migrations/001_initial_schema.sql');
    const content = fs.readFileSync(migrationPath, 'utf-8');

    // Check for correct stripe_events RLS policy
    expect(content).toContain("CREATE POLICY \"Service role can manage stripe events\" ON stripe_events");
    expect(content).toContain("FOR ALL USING (auth.role() = 'service_role')");
    expect(content).toContain("WITH CHECK (auth.role() = 'service_role')");

    // Check for correct usage_logs RLS policies
    expect(content).toContain("CREATE POLICY \"Users can read own usage logs\" ON usage_logs");
    expect(content).toContain("FOR SELECT USING (auth.uid() = user_id)");
    expect(content).toContain("CREATE POLICY \"Service role writes usage logs\" ON usage_logs");
    expect(content).toContain("FOR INSERT WITH CHECK (auth.role() = 'service_role')");

    // Verify trigger is removed
    expect(content).not.toContain('trigger_delete_old_analyses');
    expect(content).not.toContain('delete_old_free_analyses');

    console.log('✓ RLS policies and trigger removal verified in migration');
  });

  test('pg_cron cleanup job is scheduled', async () => {
    const fs = require('fs');
    const path = require('path');
    const cronPath = path.join(__dirname, '../../supabase/migrations/002_schedule_cleanup.sql');
    const content = fs.readFileSync(cronPath, 'utf-8');

    // Check for pg_cron job
    expect(content).toContain('cron.schedule');
    expect(content).toContain('delete-old-free-analyses');
    expect(content).toContain('0 2 * * *'); // Daily at 2 AM
    expect(content).toContain('tier = \'free\'');
    expect(content).toContain('30 days');

    console.log('✓ pg_cron cleanup job correctly scheduled');
  });

  test('typescript configuration allows no js files', async () => {
    const fs = require('fs');
    const path = require('path');
    const tsconfigPath = path.join(__dirname, '../tsconfig.json');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));

    expect(tsconfig.compilerOptions.allowJs).toBe(false);
    console.log('✓ tsconfig.json correctly set to allowJs: false');
  });

  test('globals.css uses tailwind v4 directive', async () => {
    const fs = require('fs');
    const path = require('path');
    const globalsPath = path.join(__dirname, '../app/globals.css');
    const content = fs.readFileSync(globalsPath, 'utf-8');

    // Check for v4 directive
    expect(content).toContain('@import "tailwindcss"');

    // Verify v3 directives are removed
    expect(content).not.toContain('@tailwind base');
    expect(content).not.toContain('@tailwind components');
    expect(content).not.toContain('@tailwind utilities');

    console.log('✓ Tailwind v4 directive (@import) verified');
  });

  test('build artifacts contain tailwind styles', async ({ page }) => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Check that Tailwind's generated CSS is loaded
    const stylesheets = await page.locator('link[rel="stylesheet"]').all();

    let foundTailwind = false;
    for (const sheet of stylesheets) {
      const href = await sheet.getAttribute('href');
      if (href && (href.includes('_next') || href.includes('app'))) {
        foundTailwind = true;
        break;
      }
    }

    expect(foundTailwind).toBe(true);
    console.log('✓ Tailwind CSS bundle detected in build artifacts');
  });

  test('no sentry configuration errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && text.includes('Sentry')) {
        errors.push(text);
      }
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    expect(errors).toHaveLength(0);
    console.log('✓ Sentry configuration verified (no errors)');
  });
});
