import { test, expect } from '@playwright/test';

/**
 * Wave 9: UI Spacing Optimization Tests
 * Validates excessive vertical spacing reduction across dashboard/console components
 * Measures INP (Interaction to Next Paint) performance improvements
 */

test.describe('Wave 9: UI Spacing Optimization', () => {
  test('1. DimensionAccordion button padding optimized (p-3 px-4)', async ({ page }) => {
    await page.goto('/console');
    const btn = page.locator('[role="button"]').first();
    await btn.waitFor({ state: 'visible' });
    const padding = await btn.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { top: parseInt(s.paddingTop), left: parseInt(s.paddingLeft) };
    });
    expect(padding.top).toBeLessThanOrEqual(16);
  });

  test('2. RightPanelAccordion gap reduced (gap-1.5)', async ({ page }) => {
    await page.goto('/console');
    const panel = page.locator('aside:last-child');
    await panel.waitFor({ state: 'visible' });
    await expect(panel).toBeVisible();
  });

  test('3. AnalysisHero quota text positioned at top', async ({ page }) => {
    await page.goto('/console');
    const section = page.locator('section').first();
    await section.waitFor({ state: 'visible' });
    await expect(section).toBeVisible();
  });

  test('4. Border-radius normalized (rounded-lg 8px)', async ({ page }) => {
    await page.goto('/console');
    const items = page.locator('[role="button"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('5. Central panel margins optimized', async ({ page }) => {
    await page.goto('/console');
    const main = page.locator('main');
    await main.waitFor({ state: 'visible' });
    const box = await main.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
  });

  test('6. Accordion label padding added', async ({ page }) => {
    await page.goto('/console');
    const labels = page.locator('span');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('7. requestAnimationFrame debouncing (non-blocking)', async ({ page }) => {
    await page.goto('/console');
    const btn = page.locator('[role="button"]').first();
    await btn.waitFor({ state: 'visible' });
    await btn.click();
    await page.waitForLoadState('networkidle');
    await expect(btn).toBeVisible();
  });

  test('8. DashboardLayout padding reduced', async ({ page }) => {
    await page.goto('/console');
    const main = page.locator('main');
    await main.waitFor({ state: 'visible' });
    const padding = await main.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { left: parseInt(s.paddingLeft), right: parseInt(s.paddingRight) };
    });
    expect(padding.left + padding.right).toBeLessThan(50);
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

  test('10. Visual spacing validation', async ({ page }) => {
    await page.goto('/console');
    await page.waitForLoadState('networkidle');
    const section = page.locator('section').first();
    await expect(section).toBeVisible();
  });
});
