import { test, expect } from '@playwright/test';

test.describe('E2E: Analysis Markdown Generation Fix', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  });

  test('Should generate non-empty markdown with all dimensions from 5 streams', async ({ page }) => {
    // Use a known video with transcript
    const testVideoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    // Find and fill URL input
    const urlInput = page.locator('input').filter({ hasText: /youtube|url|video/i }).first();
    await urlInput.click();
    await urlInput.fill(testVideoUrl);

    // Find and click analyze/submit button
    const submitBtn = page.locator('button').filter({ hasText: /analyze|submit|start/i }).first();
    await submitBtn.click();

    // Wait for analysis to progress
    await page.waitForLoadState('networkidle');

    // Monitor for completion - wait up to 120 seconds for 5 streams
    const maxWait = 120000;
    const pollInterval = 3000;
    const startTime = Date.now();

    let markdownContent = '';
    let isComplete = false;

    while (Date.now() - startTime < maxWait && !isComplete) {
      // Check for completion indicators
      const statusText = await page.locator('[class*="status"], [class*="complete"]').first().textContent().catch(() => '');

      // Look for analysis content
      const contentLocator = page.locator('[class*="synthesis"], [class*="markdown"], [class*="analysis"]').first();
      const content = await contentLocator.textContent().catch(() => '');

      if (content && content.includes('DIMENSION') && content.length > 1000) {
        markdownContent = content;
        isComplete = true;
        break;
      }

      if (statusText && statusText.toLowerCase().includes('complete')) {
        markdownContent = content;
        isComplete = true;
        break;
      }

      // Wait before next poll
      await page.waitForTimeout(pollInterval);
    }

    // Verify completion
    expect(isComplete, 'Analysis should complete within 2 minutes').toBe(true);

    // Verify markdown is not empty
    expect(markdownContent.length, 'Markdown must have substantial content (>2000 chars)').toBeGreaterThan(2000);

    // Count dimensions
    const dimensionMatches = markdownContent.match(/### DIMENSION \d+/g) || [];
    console.log(`📊 Found ${dimensionMatches.length} dimensions in output`);
    console.log(`📝 Total markdown length: ${markdownContent.length} characters`);

    // Verify minimum dimensions present (should have at least 3-5 from the 5 streams)
    expect(dimensionMatches.length, 'Should have multiple dimensions from streams').toBeGreaterThanOrEqual(3);

    // Verify no all-error state
    const errorOnlyMatch = markdownContent.match(/insufficient data|error/gi) || [];
    expect(markdownContent.length / Math.max(errorOnlyMatch.length, 1), 'Content should not be all errors').toBeGreaterThan(100);

    // Verify key sections present
    expect(markdownContent.toUpperCase()).toContain('DIMENSION');
    expect(markdownContent.length).toBeGreaterThan(100);

    console.log(`✅ SUCCESS: Analysis generated ${dimensionMatches.length} dimensions with ${markdownContent.length} chars`);
  });

  test('Should display markdown in UI without empty state', async ({ page }) => {
    const testVideoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    const urlInput = page.locator('input').filter({ hasText: /youtube|url|video/i }).first();
    await urlInput.click();
    await urlInput.fill(testVideoUrl);

    const submitBtn = page.locator('button').filter({ hasText: /analyze|submit|start/i }).first();
    await submitBtn.click();

    await page.waitForLoadState('networkidle');

    // Wait for completion (up to 2 min)
    const contentLocator = page.locator('[class*="synthesis"], [class*="content"], [class*="markdown"]').first();
    await contentLocator.waitFor({ timeout: 120000, state: 'visible' });

    const content = await contentLocator.textContent();

    // Verify content is visible and not empty
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(100);

    // Verify UI shows analysis content (not loading/empty state)
    expect(content).toMatch(/DIMENSION|analysis|content/i);

    console.log(`✅ UI correctly displays analysis content`);
  });
});
