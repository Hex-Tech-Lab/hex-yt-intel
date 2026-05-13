# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web/tests/pr1-fixes.spec.ts >> PR #1 Fixes Verification >> tailwind v4 styles are applied correctly
- Location: web/tests/pr1-fixes.spec.ts:9:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "smooth"
Received: "auto"
```

# Page snapshot

```yaml
- main [ref=e2]:
  - heading "Hex-YT-Intel" [level=1] [ref=e3]
  - paragraph [ref=e4]: YouTube synthesis engine
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('PR #1 Fixes Verification', () => {
  4   |   test.beforeAll(async () => {
  5   |     // Verify build succeeded by checking if app can start
  6   |     console.log('Starting app verification...');
  7   |   });
  8   | 
  9   |   test('tailwind v4 styles are applied correctly', async ({ page }) => {
  10  |     // Navigate to the home page
  11  |     await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  12  | 
  13  |     // Verify smooth scroll behavior (from globals.css)
  14  |     const html = page.locator('html');
  15  |     const htmlStyle = await html.evaluate((el) => {
  16  |       return window.getComputedStyle(el).scrollBehavior;
  17  |     });
  18  | 
> 19  |     expect(htmlStyle).toBe('smooth');
      |                       ^ Error: expect(received).toBe(expected) // Object.is equality
  20  |     console.log('✓ Tailwind v4 styles applied correctly');
  21  |   });
  22  | 
  23  |   test('no console errors during page load', async ({ page }) => {
  24  |     const errors: string[] = [];
  25  |     const warnings: string[] = [];
  26  | 
  27  |     page.on('console', (msg) => {
  28  |       if (msg.type() === 'error') {
  29  |         errors.push(msg.text());
  30  |       }
  31  |       if (msg.type() === 'warning') {
  32  |         warnings.push(msg.text());
  33  |       }
  34  |     });
  35  | 
  36  |     await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  37  | 
  38  |     // Filter out expected warnings
  39  |     const criticalErrors = errors.filter(e =>
  40  |       !e.includes('ResizeObserver') &&
  41  |       !e.includes('Failed to load')
  42  |     );
  43  | 
  44  |     expect(criticalErrors).toHaveLength(0);
  45  |     console.log('✓ No critical console errors detected');
  46  |   });
  47  | 
  48  |   test('page content loads without timeout', async ({ page }) => {
  49  |     const startTime = Date.now();
  50  | 
  51  |     const response = await page.goto('http://localhost:3000', {
  52  |       waitUntil: 'networkidle',
  53  |       timeout: 10000
  54  |     });
  55  | 
  56  |     const loadTime = Date.now() - startTime;
  57  | 
  58  |     expect(response?.status()).toBeLessThan(400);
  59  |     expect(loadTime).toBeLessThan(10000);
  60  |     console.log(`✓ Page loaded in ${loadTime}ms`);
  61  |   });
  62  | 
  63  |   test('api routes respond without errors', async ({ page }) => {
  64  |     // Test health/readiness of key API routes
  65  |     const routes = [
  66  |       '/api/auth/session',
  67  |       '/api/analyses',
  68  |     ];
  69  | 
  70  |     for (const route of routes) {
  71  |       const response = await page.request.get(`http://localhost:3000${route}`);
  72  | 
  73  |       // Should either return success or auth error, not 500
  74  |       expect(response.status()).toBeLessThan(500);
  75  |       console.log(`✓ ${route}: ${response.status()}`);
  76  |     }
  77  |   });
  78  | 
  79  |   test('rls policies syntax is valid (migration check)', async () => {
  80  |     // Read the migration file to verify RLS policies
  81  |     const fs = require('fs');
  82  |     const migrationPath = '/home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/001_initial_schema.sql';
  83  |     const content = fs.readFileSync(migrationPath, 'utf-8');
  84  | 
  85  |     // Check for correct stripe_events RLS policy
  86  |     expect(content).toContain("CREATE POLICY \"Service role can manage stripe events\" ON stripe_events");
  87  |     expect(content).toContain("FOR ALL USING (auth.role() = 'service_role')");
  88  |     expect(content).toContain("WITH CHECK (auth.role() = 'service_role')");
  89  | 
  90  |     // Check for correct usage_logs RLS policies
  91  |     expect(content).toContain("CREATE POLICY \"Users can read own usage logs\" ON usage_logs");
  92  |     expect(content).toContain("FOR SELECT USING (auth.uid() = user_id)");
  93  |     expect(content).toContain("CREATE POLICY \"Service role writes usage logs\" ON usage_logs");
  94  |     expect(content).toContain("FOR INSERT WITH CHECK (auth.role() = 'service_role')");
  95  | 
  96  |     // Verify trigger is removed
  97  |     expect(content).not.toContain('trigger_delete_old_analyses');
  98  |     expect(content).not.toContain('delete_old_free_analyses');
  99  | 
  100 |     console.log('✓ RLS policies and trigger removal verified in migration');
  101 |   });
  102 | 
  103 |   test('pg_cron cleanup job is scheduled', async () => {
  104 |     const fs = require('fs');
  105 |     const cronPath = '/home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/002_schedule_cleanup.sql';
  106 |     const content = fs.readFileSync(cronPath, 'utf-8');
  107 | 
  108 |     // Check for pg_cron job
  109 |     expect(content).toContain('cron.schedule');
  110 |     expect(content).toContain('delete-old-free-analyses');
  111 |     expect(content).toContain('0 2 * * *'); // Daily at 2 AM
  112 |     expect(content).toContain('tier = \'free\'');
  113 |     expect(content).toContain('30 days');
  114 | 
  115 |     console.log('✓ pg_cron cleanup job correctly scheduled');
  116 |   });
  117 | 
  118 |   test('typescript configuration allows no js files', async () => {
  119 |     const fs = require('fs');
```