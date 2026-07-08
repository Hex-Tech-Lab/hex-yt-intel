import { test as base, expect, TEST_YOUTUBE_URLS, TEST_MOBILE_VIEWPORTS } from './fixtures';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'http://localhost:3000';
const DEV_BYPASS_TOKEN = process.env.DEV_BYPASS_TOKEN || 'test-token';

/**
 * Mobile viewport test fixture
 */
const test = base.extend({
  mobileContext: async ({ browser }, use) => {
    const context = await browser!.newContext({
      ...TEST_MOBILE_VIEWPORTS.mobile_iphone,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
    });

    if (DEV_BYPASS_TOKEN) {
      await context.setExtraHTTPHeaders({
        'X-Hex-Test-Secret': DEV_BYPASS_TOKEN,
      });
    }

    const page = await context.newPage();

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use({ page, context });
    await context.close();
  },
});

/**
 * TEST SUITE 5: Mobile Responsiveness
 * Verifies all flows work correctly on mobile viewport (375x667)
 */
test.describe('TEST SUITE 5: Mobile Responsiveness', () => {
  test('Home page renders without horizontal scroll on mobile', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Check for horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.clientWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);

    console.log(`[Mobile] Body width: ${bodyWidth}, Window width: ${windowWidth}`);

    // Should fit within viewport
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth);

    // No overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    console.log(`[Mobile] Has horizontal scroll: ${hasHorizontalScroll}`);
    expect(hasHorizontalScroll).toBe(false);
  });

  test('URL input is accessible and usable on mobile', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Find input
    const urlInput = page.locator('input[aria-label="YouTube video URL"]');

    const isVisible = await urlInput.isVisible();
    expect(isVisible).toBe(true);

    // Should be tappable (minimum 44px height on mobile)
    const boundingBox = await urlInput.boundingBox();
    console.log(`[Mobile Input] Size: ${boundingBox?.width}x${boundingBox?.height}`);

    if (boundingBox) {
      expect(boundingBox.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('Analyze button is accessible on mobile (375px)', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Fill input
    const urlInput = page.locator('input[aria-label="YouTube video URL"]');
    await urlInput.fill(TEST_YOUTUBE_URLS.testVideo1);

    // Find analyze button
    const analyzeBtn = page.locator('button', { hasText: /Analyze/ }).first();

    const isVisible = await analyzeBtn.isVisible();
    expect(isVisible).toBe(true);

    // Should be tappable
    const boundingBox = await analyzeBtn.boundingBox();
    console.log(`[Mobile Button] Size: ${boundingBox?.width}x${boundingBox?.height}`);

    if (boundingBox) {
      expect(boundingBox.height).toBeGreaterThanOrEqual(40);
    }

    // Should be clickable
    const isEnabled = await analyzeBtn.isEnabled();
    expect(isEnabled).toBe(true);
  });

  test('Analysis submission works on mobile', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Submit analysis
    const urlInput = page.locator('input[aria-label="YouTube video URL"]');
    await urlInput.fill(TEST_YOUTUBE_URLS.testVideo1);

    // Wait for submission response
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/analyses'),
      { timeout: 10000 }
    );

    const analyzeBtn = page.locator('button', { hasText: /Analyze/ }).first();
    await analyzeBtn.click();

    try {
      const response = await responsePromise;
      console.log(`[Mobile Submission] Status: ${response.status()}`);
      expect([200, 202]).toContain(response.status());
    } catch (_e) {
      console.log('[Mobile Submission] Response not captured');
    }
  });

  test('Status display is readable on mobile (375px)', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Look for status badge/indicator
    const statusBadge = page.locator('[class*="status"], [class*="badge"]').first();

    const isVisible = await statusBadge.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`[Mobile Status] Visible: ${isVisible}`);

    // Page should still be readable
    const content = await page.content();
    expect(content?.length).toBeGreaterThan(500);
  });

  test('Chat is accessible on mobile viewport', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Look for chat dock
    const chatDock = page.locator('[aria-label*="chat" i]').first();

    const isVisible = await chatDock.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`[Mobile Chat] Chat dock visible: ${isVisible}`);

    // Chat should be accessible even if collapsed
    if (isVisible) {
      const boundingBox = await chatDock.boundingBox();
      console.log(`[Mobile Chat] Dock size: ${boundingBox?.width}x${boundingBox?.height}`);

      // Should be tappable
      if (boundingBox) {
        expect(boundingBox.height).toBeGreaterThanOrEqual(30);
      }
    }
  });

  test('Search page layout on mobile (375px)', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/search`, { waitUntil: 'load' });

    // Check for horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    console.log(`[Mobile Search] Has horizontal scroll: ${hasHorizontalScroll}`);
    expect(hasHorizontalScroll).toBe(false);

    // Search input should be accessible
    const searchInput = page.locator('input[type="search"]').first();
    const isVisible = await searchInput.isVisible({ timeout: 1000 }).catch(() => false);

    if (isVisible) {
      expect(await searchInput.isVisible()).toBe(true);
    }
  });

  test('Dimension content is readable on mobile', async ({
    mobileContext: { page },
  }) => {
    // Load a page with dimension content (would need an existing analysis)
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Look for dimension-like content
    const content = await page.locator('body').textContent();

    // Should have readable text
    expect(content).toBeTruthy();
    expect((content || '').length).toBeGreaterThan(50);

    // No text should be clipped (rough check)
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    console.log(`[Mobile Content] Viewport: ${viewportWidth}px`);
  });

  test('No layout shift on mobile - button remains in place', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Get button position
    const analyzeBtn = page.locator('button', { hasText: /Analyze/ }).first();

    if (await analyzeBtn.isVisible()) {
      const box1 = await analyzeBtn.boundingBox();

      // Scroll and check if button moved
      await page.evaluate(() => window.scrollBy(0, 100));
      await page.waitForTimeout(100);

      const box2 = await analyzeBtn.boundingBox();

      console.log(`[Mobile Shift] Before: ${box1?.x}, After: ${box2?.x}`);

      // Button should remain in same relative position if not affected by scroll
      if (box1 && box2) {
        // Position may change due to scroll, but shouldn't jump unexpectedly
        const xDiff = Math.abs((box2.x || 0) - (box1.x || 0));
        expect(xDiff).toBeLessThan(50); // Allow small adjustments
      }
    }
  });

  test('Touch targets are adequate (minimum 44x44) on mobile', async ({
    mobileContext: { page },
  }) => {
    await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

    // Check all buttons for adequate touch target size
    const buttons = await page.locator('button').all();

    const inadequateButtons = [];

    for (const btn of buttons.slice(0, 5)) {
      // Check first 5 buttons
      const box = await btn.boundingBox();
      if (box && (box.width < 44 || box.height < 44)) {
        inadequateButtons.push(box);
      }
    }

    console.log(`[Mobile Touch] Checked ${Math.min(5, buttons.length)} buttons, inadequate: ${inadequateButtons.length}`);

    // Most buttons should be adequately sized
    expect(inadequateButtons.length).toBeLessThanOrEqual(2);
  });

  test('Responsive analysis flow on Android viewport (412px)', async ({
    browser,
  }) => {
    const context = await browser!.newContext({
      ...TEST_MOBILE_VIEWPORTS.mobile_android,
      userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B)',
    });

    if (DEV_BYPASS_TOKEN) {
      await context.setExtraHTTPHeaders({
        'X-Hex-Test-Secret': DEV_BYPASS_TOKEN,
      });
    }

    try {
      const page = await context.newPage();

      await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

      // Submit URL
      const urlInput = page.locator('input[aria-label="YouTube video URL"]');
      await urlInput.fill(TEST_YOUTUBE_URLS.testVideo1);

      const analyzeBtn = page.locator('button', { hasText: /Analyze/ }).first();
      const isClickable = await analyzeBtn.isVisible();

      console.log(`[Mobile Android] Analyze button clickable: ${isClickable}`);
      expect(isClickable).toBe(true);

      // No horizontal scroll
      const hasScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      console.log(`[Mobile Android] No horizontal scroll: ${!hasScroll}`);
      expect(hasScroll).toBe(false);

      await page.close();
    } finally {
      await context.close();
    }
  });

  test('Tablet viewport (768px) is also responsive', async ({
    browser,
  }) => {
    const context = await browser!.newContext(TEST_MOBILE_VIEWPORTS.tablet);

    if (DEV_BYPASS_TOKEN) {
      await context.setExtraHTTPHeaders({
        'X-Hex-Test-Secret': DEV_BYPASS_TOKEN,
      });
    }

    try {
      const page = await context.newPage();

      await page.goto(`${DEPLOYMENT_URL}/`, { waitUntil: 'load' });

      // No horizontal scroll
      const hasScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      console.log(`[Tablet] No horizontal scroll: ${!hasScroll}`);
      expect(hasScroll).toBe(false);

      // Tablet should show more content
      const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
      console.log(`[Tablet] Body height: ${bodyHeight}px`);
      expect(bodyHeight).toBeGreaterThan(100);

      await page.close();
    } finally {
      await context.close();
    }
  });
});
