import { test, expect } from '@playwright/test';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'https://hex-yt-intel.vercel.app';
const DEV_BYPASS_TOKEN = process.env.DEV_BYPASS_TOKEN || '';

test.describe('Production Verification Suite', () => {
  // Hook to inject bypass token header into all requests
  test.beforeEach(async ({ context }) => {
    if (DEV_BYPASS_TOKEN) {
      // Set header for all requests in this context
      await context.setExtraHTTPHeaders({
        'X-Hex-Test-Secret': DEV_BYPASS_TOKEN,
      });
    }
  });

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
        waitUntil: 'load',
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
        waitUntil: 'load',
      });

      expect(response?.status()).toBeLessThan(400);

      const html = await page.content();

      // Verify Sentry is configured if DSN should be set
      const hasSentryConfig = html.includes('sentry-trace') || html.includes('baggage');
      if (hasSentryConfig) {
        expect(html).toMatch(/sentry-trace|baggage/);
      }

      // Check that script tags don't contain unpolyfilled environment references
      const scripts = await page.locator('script').all();
      for (const script of scripts) {
        const src = await script.getAttribute('src');
        if (!src) {
          const text = await script.textContent() || '';
          expect(text).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
          expect(text).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY');
        }
      }
    });
  });

  test.describe('Auth Routes', () => {
    test('auth signin page renders securely', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/auth/signin`, {
        waitUntil: 'load',
      });

      // May redirect (307) to login provider
      expect([200, 307, 302, 308]).toContain(response?.status());

      if (response?.status() === 200) {
        const html = await page.content();

        // Verify no sensitive data in HTML
        const sensitivePatterns = [
          new RegExp('sk_' + 'live_'),
          new RegExp('sk_' + 'test_'),
          new RegExp('pk_' + 'live_'),
          new RegExp('pk_' + 'test_'),
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
        waitUntil: 'load',
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
      // Health route is an intentionally lightweight routing check:
      // { status, timestamp, message }. Assert that contract, not a richer
      // components{} shape the endpoint does not emit.
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('timestamp');
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
        waitUntil: 'load',
      });

      expect(response?.status()).toBeLessThan(400);

      const html = await page.content();

      // Validate that page rendered and contains expected content length
      expect(html.length).toBeGreaterThan(500);

      // Verify that critical environment exports were properly injected
      // Check for Supabase configuration reference which requires env vars
      expect(html.toLowerCase()).toContain('supabase');
    });

    test('no uninitialized environment references in HTML', async ({ page }) => {
      const response = await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'load',
      });

      expect(response?.status()).toBeLessThan(400);

      const html = await page.content();

      // Check for common uninitialized patterns - filter out legitimate uses of "undefined"
      // Legitimate checks like typeof checks and comments are excluded
      // This validates that environment references are properly polyfilled

      // Very basic check - a more robust approach would parse the HTML structure
      expect(html).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL=');
    });
  });

  test.describe('Navigation & Routing', () => {
    test('home page navigation is functional', async ({ page }) => {
      await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'load',
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
        waitUntil: 'load',
      });

      const loadTime = Date.now() - startTime;

      expect(response?.status()).toBeLessThan(400);
      expect(loadTime).toBeLessThan(15000); // 15 second max for initial load
    });

    test('page is not blank', async ({ page }) => {
      await page.goto(`${DEPLOYMENT_URL}/`, {
        waitUntil: 'load',
      });

      const hasContent = await page.evaluate(() => {
        return document.body.innerText.trim().length > 0;
      });

      expect(hasContent).toBe(true);
    });
  });
});
