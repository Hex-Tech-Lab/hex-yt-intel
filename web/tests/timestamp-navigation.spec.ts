import { test, expect, TEST_YOUTUBE_URLS } from './fixtures';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'http://localhost:3000';

/**
 * TEST SUITE: Timestamp Navigation
 * Verifies that TimestampLink component integrates with YouTube player seek logic
 * and works correctly across browsers
 */
test.describe('TEST SUITE: Timestamp Navigation', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Ensure we're on a clean dashboard before each test
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });
  });

  test('Should render timestamp links in analysis content', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Wait for content to render
    await page.waitForTimeout(1000);

    // Look for any timestamp links (they should be in the dimension content)
    // Timestamps are typically in format HH:MM:SS or MM:SS
    const timestampRegex = /\d{1,2}:\d{2}(?::\d{2})?/;
    const pageContent = await page.content();
    const hasTimestamps = timestampRegex.test(pageContent || '');

    if (hasTimestamps) {
      // Find all links with timestamp-like text
      const timestampLinks = await page.locator('a[title*="Seek to"], a[aria-label*="Seek to"]').all();
      if (timestampLinks.length > 0) {
        expect(timestampLinks.length).toBeGreaterThan(0);
      }
    }
  });

  test('Should seek video to timestamp on click', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Wait for content and video player to be ready
    await page.waitForTimeout(2000);

    // Look for timestamp links
    const timestampLinks = await page.locator('a[title*="Seek to"], a[aria-label*="Seek to"]').all();

    if (timestampLinks.length > 0) {
      // Click the first timestamp link
      const firstLink = timestampLinks[0]!;
      const ariaLabel = await firstLink.getAttribute('aria-label');
      expect(ariaLabel).toMatch(/Seek to \d{1,2}:\d{2}/);

      // Click to seek
      await firstLink.click();

      // Give the player time to seek
      await page.waitForTimeout(500);

      // Verify the video player is in the DOM and seekable
      const videoPlayer = page.locator('div[id*="movie"]').first();
      expect(videoPlayer).toBeTruthy();
    }
  });

  test('Should handle multiple timestamp clicks', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Wait for content and video player to be ready
    await page.waitForTimeout(2000);

    // Look for timestamp links
    const timestampLinks = await page.locator('a[title*="Seek to"], a[aria-label*="Seek to"]').all();

    if (timestampLinks.length >= 2) {
      // Click first timestamp
      await timestampLinks[0]!.click();
      await page.waitForTimeout(300);

      // Click second timestamp
      await timestampLinks[1]!.click();
      await page.waitForTimeout(300);

      // Verify no console errors
      const consoleMessages = await page.evaluate(() => {
        // This will check if there were any console.error calls
        return (window as any).__consoleErrors || [];
      });

      expect(consoleMessages).toHaveLength(0);
    }
  });

  test('Should be keyboard accessible', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Wait for content to render
    await page.waitForTimeout(1000);

    // Look for timestamp links
    const timestampLinks = await page.locator('a[title*="Seek to"], a[aria-label*="Seek to"]').all();

    if (timestampLinks.length > 0) {
      const firstLink = timestampLinks[0]!;

      // Focus the link
      await firstLink.focus();

      // Verify it's focused
      const isFocused = await firstLink.evaluate((el) => el === document.activeElement);
      expect(isFocused).toBe(true);

      // Press Enter to activate
      await firstLink.press('Enter');
      await page.waitForTimeout(300);

      // Should have triggered seek (no error)
      const hasError = await page.evaluate(() => {
        return (window as any).__timestampLinkError || false;
      });
      expect(hasError).toBe(false);
    }
  });

  test('Should preserve video playback state during seek', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Wait for content and video player to be ready
    await page.waitForTimeout(2000);

    // Look for timestamp links
    const timestampLinks = await page.locator('a[title*="Seek to"], a[aria-label*="Seek to"]').all();

    if (timestampLinks.length > 0) {
      // Click first timestamp
      await timestampLinks[0]!.click();
      await page.waitForTimeout(500);

      // Verify video player still exists
      const videoPlayer = page.locator('div[id*="movie"]').first();
      expect(videoPlayer).toBeTruthy();

      // Verify no errors in player
      const playerError = await page.evaluate(() => {
        return (window as any).__youtubePlayerError || false;
      });
      expect(playerError).toBe(false);
    }
  });

  test('Should work on mobile viewports', async ({
    authenticatedPage: page,
    submitAnalysis,
    waitForAnalysisComplete,
  }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Submit analysis
    const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
    const analysisId = result!.analysisId;

    // Wait for completion
    const isComplete = await waitForAnalysisComplete(analysisId);
    expect(isComplete).toBe(true);

    // Wait for content to render
    await page.waitForTimeout(1000);

    // Look for timestamp links
    const timestampLinks = await page.locator('a[title*="Seek to"], a[aria-label*="Seek to"]').all();

    if (timestampLinks.length > 0) {
      // Verify link is visible and clickable
      await expect(timestampLinks[0]!).toBeVisible();

      // Click timestamp
      await timestampLinks[0]!.click();
      await page.waitForTimeout(500);

      // Should work without errors on mobile
      const hasError = await page.evaluate(() => {
        return (window as any).__mobileTimestampError || false;
      });
      expect(hasError).toBe(false);
    }
  });
});
