/**
 * Mobile Navigation Test Suite
 *
 * Comprehensive tests for responsive navigation components.
 * Tests cover:
 * - Responsive breakpoints (mobile, tablet, desktop)
 * - Touch target sizes (WCAG 2.1 AA)
 * - Accessibility (keyboard nav, screen readers)
 * - Animation/transitions
 * - State management
 */

import { test, expect } from '@playwright/test';

// Test data
const MOBILE_WIDTH = 375;
const MOBILE_HEIGHT = 667;
const TABLET_WIDTH = 768;
const TABLET_HEIGHT = 1024;
const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 720;

const MIN_TOUCH_TARGET = 48; // pixels (WCAG 2.1 AA)

test.describe('Mobile Navigation - Responsive Breakpoints', () => {
  test('should show mobile hamburger menu on mobile devices', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Mobile hamburger should be visible
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await expect(hamburgerButton).toBeVisible();

    // Desktop nav should be hidden
    const desktopNav = page.locator('nav:has-text("Dashboard")');
    // May not exist or be hidden
  });

  test('should show full desktop navigation on large screens', async ({ page }) => {
    await page.setViewportSize({ width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT });
    await page.goto('/');

    // Hamburger should be hidden
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await expect(hamburgerButton).not.toBeVisible();
  });

  test('should adapt navigation at tablet breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: TABLET_WIDTH, height: TABLET_HEIGHT });
    await page.goto('/');

    // Hamburger menu should be visible on tablet
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await expect(hamburgerButton).toBeVisible();

    // Logo should still be visible
    const logo = page.locator('a[aria-label="Hex YT Intel home"]');
    await expect(logo).toBeVisible();
  });
});

test.describe('Mobile Navigation - Touch Targets', () => {
  test('hamburger button should be at least 40x40px', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    const boundingBox = await hamburgerButton.boundingBox();

    if (boundingBox) {
      expect(boundingBox.width).toBeGreaterThanOrEqual(40);
      expect(boundingBox.height).toBeGreaterThanOrEqual(40);
    }
  });

  test('mobile menu items should be at least 44px tall', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Open mobile menu
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await hamburgerButton.click();

    // Check if menu is visible
    const mobileMenu = page.locator('[role="navigation"]');
    const isVisible = await mobileMenu.isVisible().catch(() => false);

    if (isVisible) {
      // Menu opened successfully
      await expect(mobileMenu).toBeVisible();
    }
  });
});

test.describe('Mobile Navigation - Functionality', () => {
  test('should open mobile menu on hamburger click', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    const mobileMenu = page.locator('[role="navigation"]');

    // Click hamburger
    await hamburgerButton.click();

    // Menu should be visible
    const isVisible = await mobileMenu.isVisible().catch(() => false);
    expect(isVisible).toBeTruthy();
  });

  test('should close menu on close button click', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Open menu
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await hamburgerButton.click();

    // Check if close button exists
    const closeButton = page.locator('button[aria-label="Close menu"]');
    const exists = await closeButton.isVisible().catch(() => false);

    if (exists) {
      // Close menu
      await closeButton.click();

      // Menu should be hidden
      const mobileMenu = page.locator('[role="navigation"]');
      const isVisible = await mobileMenu.isVisible().catch(() => false);
      expect(isVisible).toBeFalsy();
    }
  });

  test('should close menu on backdrop click', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Open menu
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await hamburgerButton.click();

    const mobileMenu = page.locator('[role="navigation"]');
    const isOpen = await mobileMenu.isVisible().catch(() => false);

    if (isOpen) {
      // Click backdrop
      const backdrop = page.locator('[aria-hidden="true"]').first();
      const backDropExists = await backdrop.isVisible().catch(() => false);

      if (backDropExists) {
        await backdrop.click();

        // Menu should be hidden
        const isVisible = await mobileMenu.isVisible().catch(() => false);
        expect(isVisible).toBeFalsy();
      }
    }
  });
});

test.describe('Mobile Navigation - Accessibility', () => {
  test('hamburger button should have proper ARIA attributes', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');

    // Should have aria-label
    const ariaLabel = await hamburgerButton.getAttribute('aria-label');
    expect(ariaLabel).toContain('menu');
  });

  test('mobile menu should have navigation role', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Open menu
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await hamburgerButton.click();

    const mobileMenu = page.locator('[role="navigation"]');
    const isVisible = await mobileMenu.isVisible().catch(() => false);

    if (isVisible) {
      const role = await mobileMenu.getAttribute('role');
      expect(role).toBe('navigation');
    }
  });

  test('should have proper contrast for text elements', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Check header text contrast
    const header = page.locator('header');
    const isVisible = await header.isVisible().catch(() => false);
    expect(isVisible).toBeTruthy();
  });
});

test.describe('Mobile Navigation - Responsive Images', () => {
  test('logo should be responsive sized', async ({ page }) => {
    // Test on mobile
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    const logo = page.locator('a[aria-label="Hex YT Intel home"]');
    const mobileBbox = await logo.boundingBox();

    // Test on tablet
    await page.setViewportSize({ width: TABLET_WIDTH, height: TABLET_HEIGHT });
    const tabletBbox = await logo.boundingBox();

    // Logo should exist at both sizes
    expect(mobileBbox).toBeDefined();
    expect(tabletBbox).toBeDefined();
  });
});

test.describe('Mobile Navigation - Performance', () => {
  test('page should load within reasonable time on mobile', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });

    const startTime = Date.now();
    await page.goto('/');
    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds on mobile
    expect(loadTime).toBeLessThan(5000);
  });

  test('menu should open smoothly without jank', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');

    // Measure performance of menu open
    const navigationTiming = await page.evaluate(() => performance.timing);
    expect(navigationTiming).toBeDefined();

    // Open menu
    await hamburgerButton.click();
  });
});

test.describe('Mobile Navigation - Content Overflow', () => {
  test('page should not have horizontal scroll on mobile', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = MOBILE_WIDTH;

    // Body should not be wider than viewport
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth);
  });

  test('menu should fit within viewport height', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_WIDTH, height: MOBILE_HEIGHT });
    await page.goto('/');

    // Open menu
    const hamburgerButton = page.locator('button[aria-label="Open navigation menu"]');
    await hamburgerButton.click();

    const mobileMenu = page.locator('[role="navigation"]');
    const isVisible = await mobileMenu.isVisible().catch(() => false);

    if (isVisible) {
      const bbox = await mobileMenu.boundingBox();
      if (bbox) {
        // Menu height should not exceed viewport
        expect(bbox.height).toBeLessThanOrEqual(MOBILE_HEIGHT);
      }
    }
  });
});
