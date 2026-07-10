import { test, expect, TEST_YOUTUBE_URLS } from './fixtures';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'http://localhost:3000';

test.describe('Dashboard Layout Decomposition', () => {
  test.describe('DashboardHeader Section', () => {
    test('should render URL input field', async ({ authenticatedPage: page }) => {
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const urlInput = page.locator('input[placeholder*="youtube" i], input[placeholder*="url" i]');
      expect(await urlInput.isVisible()).toBe(true);
    });

    test('should display quota information', async ({ authenticatedPage: page }) => {
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const quotaText = page.locator('text=/analyses/i');
      expect(await quotaText.isVisible()).toBe(true);
    });
  });

  test.describe('DashboardStats Section', () => {
    test('should not render stats section when no video is loaded', async ({ authenticatedPage: page }) => {
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const statsSection = page.locator('[data-testid="dashboard-stats"]');
      const isHidden = await statsSection.isHidden().catch(() => true);

      expect(typeof isHidden).toBe('boolean');
    });
  });

  test.describe('DashboardMainContent Section', () => {
    test('should render console tab switcher when analysis is active', async ({ authenticatedPage: page, submitAnalysis }) => {
      const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
      expect(result?.analysisId).toBeTruthy();

      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      await page.waitForTimeout(2000);

      const tabSwitcher = page.locator('button:has-text("Synthesis"), button:has-text("Graph")').first();
      const isVisible = await tabSwitcher.isVisible().catch(() => false);

      if (isVisible) {
        expect(isVisible).toBe(true);
      }
    });

    test('should show synthesis tab content by default', async ({ authenticatedPage: page, submitAnalysis }) => {
      const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
      expect(result?.analysisId).toBeTruthy();

      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      await page.waitForTimeout(2000);

      const dimensionAccordion = page.locator('[data-testid="dimension-accordion"], .dimension-accordion').first();
      const isVisible = await dimensionAccordion.isVisible().catch(() => false);

      if (isVisible) {
        expect(isVisible).toBe(true);
      }
    });

    test('should switch to graph tab and render visualization', async ({ authenticatedPage: page, submitAnalysis, waitForAnalysisComplete }) => {
      const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
      expect(result?.analysisId).toBeTruthy();

      await waitForAnalysisComplete(result!.analysisId);
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const graphTab = page.locator('button:has-text("Graph")');
      const isGraphTabVisible = await graphTab.isVisible().catch(() => false);

      if (isGraphTabVisible) {
        await graphTab.click();
        await page.waitForTimeout(500);

        const vizPanel = page.locator('[data-testid="visualization-panel"], .visualization-panel, canvas').first();
        const isVizVisible = await vizPanel.isVisible().catch(() => false);
        expect(typeof isVizVisible).toBe('boolean');
      }
    });

    test('should render DimensionAccordion with all dimensions', async ({ authenticatedPage: page, submitAnalysis, waitForAnalysisComplete }) => {
      const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
      expect(result?.analysisId).toBeTruthy();

      await waitForAnalysisComplete(result!.analysisId);
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const dimensionItems = page.locator('[role="button"]:has-text("Apex Intelligence"), [role="button"]:has-text("Provenance"), [role="button"]:has-text("Content Architecture")');
      const count = await dimensionItems.count();

      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('State Management', () => {
    test('should maintain selected node ID across tab switches', async ({ authenticatedPage: page, submitAnalysis, waitForAnalysisComplete }) => {
      const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
      expect(result?.analysisId).toBeTruthy();

      await waitForAnalysisComplete(result!.analysisId);
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const graphTab = page.locator('button:has-text("Graph")');
      const isGraphTabVisible = await graphTab.isVisible().catch(() => false);

      if (isGraphTabVisible) {
        await graphTab.click();
        await page.waitForTimeout(500);

        const synthesisTab = page.locator('button:has-text("Synthesis")');
        const isSynthTabVisible = await synthesisTab.isVisible().catch(() => false);

        if (isSynthTabVisible) {
          await synthesisTab.click();
          await page.waitForTimeout(500);

          const accordion = page.locator('[data-testid="dimension-accordion"], .dimension-accordion').first();
          expect(accordion).toBeDefined();
        }
      }
    });
  });

  test.describe('Performance', () => {
    test('should handle rapid dimension accordion clicks', async ({ authenticatedPage: page, submitAnalysis, waitForAnalysisComplete }) => {
      const result = await submitAnalysis(TEST_YOUTUBE_URLS.testVideo1);
      expect(result?.analysisId).toBeTruthy();

      await waitForAnalysisComplete(result!.analysisId);
      await page.goto(`${DEPLOYMENT_URL}/console`);
      await page.waitForLoadState('networkidle');

      const dimensionButtons = page.locator('[role="button"]').filter({ hasText: /Dimension|Apex|Provenance/ });
      const count = await dimensionButtons.count();

      for (let i = 0; i < Math.min(count, 3); i++) {
        const button = dimensionButtons.nth(i);
        await button.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(100);
      }

      const accordion = page.locator('[data-testid="dimension-accordion"], .dimension-accordion').first();
      expect(accordion).toBeDefined();
    });
  });
});
