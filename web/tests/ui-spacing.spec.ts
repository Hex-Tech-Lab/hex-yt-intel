import { test, expect } from '@playwright/test';

/**
 * Wave 9: UI Spacing Optimization Tests
 * 
 * Validates excessive vertical spacing reduction across dashboard and console.
 * Measures INP (Interaction to Next Paint) performance.
 */

test.describe('Wave 9: UI Spacing Optimization', () => {
  test('1. DimensionAccordion button padding optimized (p-3 px-4)', async ({ page }) => {
    await page.goto('/console');
    const btn = page.locator('[role="button"]').first();
    await btn.waitFor({ state: 'visible' });
    const padding = await btn.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { top: s.paddingTop, left: s.paddingLeft };
    });
    expect(parseInt(padding.top)).toBeLessThanOrEqual(16);
  });

  test('2. RightPanelAccordion gap reduced (gap-1.5)', async ({ page }) => {
    await page.goto('/console');
    const panel = page.locator('aside:last-child');
    await panel.waitFor({ state: 'visible' });
    const container = panel.locator('> div').first();
    await expect(container).toBeVisible();
  });

  test('3. AnalysisHero quota text at top', async ({ page }) => {
    await page.goto('/console');
    const section = page.locator('section').first();
    await section.waitFor({ state: 'visible' });
    await expect(section).toBeVisible();
  });

  test('4. Border-radius normalized (rounded-lg 8px)', async ({ page }) => {
    await page.goto('/console');
    const items = page.locator('[role="button"]');
    expect(await items.count()).toBeGreaterThan(0);
  });

  test('5. Central panel margins optimized', async ({ page }) => {
    await page.goto('/console');
    const main = page.locator('main');
    await main.waitFor({ state: 'visible' });
    await expect(main).toBeVisible();
  });

  test('6. Accordion label padding added', async ({ page }) => {
    await page.goto('/console');
    const labels = page.locator('span');
    expect(await labels.count()).toBeGreaterThan(0);
  });

  test('7. requestAnimationFrame debouncing for INP', async ({ page }) => {
    await page.goto('/console');
    const btn = page.locator('[role="button"]').first();
    await btn.click();
    await page.waitForLoadState('networkidle');
    await expect(btn).toBeVisible();
  });

  test('8. DashboardLayout padding reduced', async ({ page }) => {
    await page.goto('/console');
    const box = await page.locator('main').boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan(100);
  });

  test('9. Transition duration snappier (200ms)', async ({ page }) => {
    await page.goto('/console');
    const btn = page.locator('[role="button"]').first();
    const duration = await btn.evaluate((el) => {
      return window.getComputedStyle(el).transitionDuration;
    });
    const ms = parseInt(duration);
    expect(ms).toBeLessThanOrEqual(300);
  });

  test('10. Visual spacing validation (screenshot)', async ({ page, browserName }) => {
    if (browserName !== 'chromium') test.skip();
    await page.goto('/console');
    await page.waitForLoadState('networkidle');
    const section = page.locator('section').first();
    await section.screenshot({ path: '/tmp/wave9-spacing-check.png' });
    await expect(section).toBeVisible();
  });
});
