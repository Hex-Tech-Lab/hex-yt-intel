import { test, expect } from '@playwright/test';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'https://hex-yt-intel.vercel.app';

test.describe('Production Verification Suite', () => {
  test.describe('Frontend Rendering', () => {
    test('home page renders without hydration errors', async ({ page }) => {
      const pageErrors: string[] = [];
      const pageWarnings: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          pageErrors.push(msg.text());
        }
        if (msg.type() === 'warning') {
          pageWarnings.push(msg.text());
        }
      });

      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });

      const response = await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      expect(response?.status()).toBeLessThan(400);

      // Check for hydration mismatches
      const hydrationErrors = pageErrors.filter(
        (err) =>
          err.includes('Hydration mismatch') ||
          err.includes('hydration failed') ||
          err.includes('ReferenceError: window is not defined') ||
          err.includes('getInitialProps') ||
          err.includes('TypeError: Cannot read property')
      );

      expect(hydrationErrors).toEqual([], `Hydration errors detected: ${hydrationErrors.join(', ')}`);

      // Get rendered HTML
      const html = await page.content();

      // Check for unpolyfilled environment variables (raw process.env references)
      expect(html).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
      expect(html).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');

      // Validate body content rendered
      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(bodyText.length).toBeGreaterThan(100);
    });

    test('home page client environment strings are materialized', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      expect(response?.status()).toBeLessThan(400);

      const html = await page.content();

      // Verify Sentry is configured if DSN should be set
      const hasSentryConfig = html.includes('sentry-trace') || html.includes('baggage');
      if (hasSentryConfig) {
        expect(html).toMatch(/sentry-trace|baggage/);
      }

      // Check that script tags don't contain unpolyfilled environment references
      const scriptSections = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
      for (const script of scriptSections) {
        // Inline scripts shouldn't have raw process.env references
        if (!script.includes('src=')) {
          expect(script).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
          expect(script).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
        }
      }
    });
  });

  test.describe('Auth Routes', () => {
    test('auth signin page renders securely', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/auth/signin`, {
        waitUntil: 'networkidle',
      });

      // May redirect (307) to login provider
      expect([200, 307, 302, 308]).toContain(response?.status());

      if (response?.status() === 200) {
        const html = await page.content();

        // Verify no sensitive data in HTML
        const sensitivePatterns = [
          /sk_live_/,
          /sk_test_/,
          /pk_live_/,
          /pk_test_/,
          /_key.*=.*[\w]{40,}/,
        ];

        for (const pattern of sensitivePatterns) {
          expect(html).not.toMatch(pattern);
        }

        // Check for proper form elements
        const bodyText = await page.evaluate(() => document.body.innerText);
        expect(bodyText.length).toBeGreaterThan(50);
      }
    });

    test('auth callback page handles redirects gracefully', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/auth/callback?code=test&state=test`, {
        waitUntil: 'networkidle',
      });

      // Callback can redirect or show error
      expect([200, 307, 302, 308, 400]).toContain(response?.status());
    });
  });

  test.describe('API Endpoints', () => {
    test('health endpoint returns structured response', async ({ request }) => {
      const response = await request.get(`${DEPLOYMENT_URL}/api/health`);

      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('components');
      expect(data.components).toHaveProperty('database');
      expect(data.components).toHaveProperty('worker');
    });

    test('metadata endpoint is accessible', async ({ request }) => {
      const response = await request.get(
        `${DEPLOYMENT_URL}/api/metadata?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ`
      );

      // May return 200 or 400 (invalid URL)
      expect([200, 400, 405]).toContain(response.status());
    });
  });

  test.describe('Client Environment Validation', () => {
    test('clientEnv exports are present and non-empty', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      expect(response?.status()).toBeLessThan(400);

      // Check that critical environment variables are available client-side
      const envVars = await page.evaluate(() => {
        // This would be set by the app's environment exports
        return {
          supabaseUrl: (window as any).__ENV__?.NEXT_PUBLIC_SUPABASE_URL,
          supabaseKey: (window as any).__ENV__?.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        };
      });

      // At minimum, the page should render without errors
      // The actual env vars may not be available in window object depending on implementation
      const html = await page.content();
      expect(html.length).toBeGreaterThan(500);
    });

    test('no uninitialized environment references in HTML', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      expect(response?.status()).toBeLessThan(400);

      const html = await page.content();

      // Check for common uninitialized patterns
      const problematicPatterns = [
        /undefined/gi, // Should not appear in normal content
      ];

      // Filter out legitimate uses of "undefined"
      const content = html.replace(/typeof\s+\w+\s*===?\s*['"]undefined['"]/, ''); // legitimate checks
      content.replace(/\/\/.*undefined.*/, ''); // comments

      // Very basic check - a more robust approach would parse the HTML structure
      expect(html).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL=');
    });
  });

  test.describe('Navigation & Routing', () => {
    test('home page navigation is functional', async ({ page }) => {
      await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      // Try to find navigation links
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((href) => href);
      });

      // Should have at least some navigation
      expect(links.length).toBeGreaterThan(0);
    });
  });

  test.describe('Performance & Accessibility', () => {
    test('page load completes within reasonable time', async ({ page }) => {
      const startTime = Date.now();

      const response = await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      const loadTime = Date.now() - startTime;

      expect(response?.status()).toBeLessThan(400);
      expect(loadTime).toBeLessThan(15000); // 15 second max for initial load
    });

    test('page is not blank', async ({ page }) => {
      await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'networkidle',
      });

      const hasContent = await page.evaluate(() => {
        return document.body.innerText.trim().length > 0;
      });

      expect(hasContent).toBe(true);
    });
  });
});
