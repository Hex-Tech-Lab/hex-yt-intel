import { test as base, expect } from '@playwright/test';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'http://localhost:3000';
const DEV_BYPASS_TOKEN = process.env.DEV_BYPASS_TOKEN || 'test-token';

/**
 * Extended test fixture with authenticated context and utility methods
 */
export const test = base.extend({
  authenticatedPage: async ({ page, context }, use) => {
    // Set bypass token header for all requests
    if (DEV_BYPASS_TOKEN) {
      await context.setExtraHTTPHeaders({
        'X-Hex-Test-Secret': DEV_BYPASS_TOKEN,
      });
    }

    // Navigate to home page
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Verify we're authenticated (should be redirected to dashboard if not)
    await expect(page).not.toHaveURL(/auth\/signin/);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },

  waitForAnalysisStream: async ({ page }, use) => {
    /**
     * Wait for streaming response and return the analysis ID
     */
    const waitForStream = async (timeout = 5000): Promise<string | null> => {
      try {
        // Listen for responses to /api/analyses
        const response = await page.waitForResponse(
          (resp) => resp.url().includes('/api/analyses') && resp.status() === 202,
          { timeout }
        );
        const data = await response.json();
        return data.analysisId || null;
      } catch (e) {
        console.error('Failed to capture analysis stream:', e);
        return null;
      }
    };

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(waitForStream);
  },

  // eslint-disable-next-line react-hooks/rules-of-hooks
  waitForAnalysisComplete: async ({ page }, use) => {
    /**
     * Poll /api/analyses/[id]/overview until status is "complete" or timeout
     */
    const waitForComplete = async (analysisId: string, maxWaitMs = 60000): Promise<boolean> => {
      const startTime = Date.now();
      const pollInterval = 1000; // 1 second

      while (Date.now() - startTime < maxWaitMs) {
        try {
          const response = await page.request.get(
            `${DEPLOYMENT_URL}/api/analyses/${analysisId}/overview`
          );
          const data = await response.json();

          console.log(`[Analysis ${analysisId}] Status: ${data.status}`);

          if (data.status === 'complete') {
            return true;
          }
          if (data.status === 'error' || data.status === 'failed') {
            console.error(`Analysis failed with status: ${data.status}`);
            return false;
          }
        } catch (e) {
          console.error('Failed to check analysis status:', e);
        }

        await page.waitForTimeout(pollInterval);
      }

      console.warn(`Analysis ${analysisId} did not complete within ${maxWaitMs}ms`);
      return false;
    };

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(waitForComplete);
  },

  submitAnalysis: async ({ page }, use) => {
    /**
     * Submit a YouTube URL for analysis
     */
    const submit = async (url: string): Promise<{ analysisId: string; response: Response } | null> => {
      try {
        // Wait for response
        const responsePromise = page.waitForResponse(
          (resp) => resp.url().includes('/api/analyses'),
          { timeout: 10000 }
        );

        // Fill in URL
        const urlInput = page.locator('input[aria-label="YouTube video URL"]');
        await urlInput.fill(url);
        await expect(urlInput).toHaveValue(url);

        // Click Analyze button
        const analyzeBtn = page.locator('button', { hasText: /Analyze/ }).first();
        await analyzeBtn.click();

        // Get response
        const response = await responsePromise;
        const data = await response.json();

        console.log(`[Submit] Status: ${response.status()}, Analysis ID: ${data.analysisId}`);

        return {
          analysisId: data.analysisId,
          response,
        };
      } catch (e) {
        console.error('Failed to submit analysis:', e);
        return null;
      }
    };

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(submit);
  },
});

export { expect };

// Test data
export const TEST_YOUTUBE_URLS = {
  // Short educational videos work best for testing
  testVideo1: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Rick Roll (everyone knows it)
  testVideo2: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', // Me at the zoo (first YouTube video)
  testVideo3: 'https://www.youtube.com/watch?v=9bZkp7q19f0', // Bitcoin explained
};

export const TEST_MOBILE_VIEWPORTS = {
  mobile_iphone: { width: 375, height: 667 },
  mobile_android: { width: 412, height: 915 },
  tablet: { width: 768, height: 1024 },
};
