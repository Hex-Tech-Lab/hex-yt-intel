import { test, expect } from '@playwright/test';

test.describe('Authenticated Dashboard Route', () => {
  // Inject the middleware bypass header for all tests in this block
  test.use({
    extraHTTPHeaders: {
      'X-Hex-Test-Secret': 'hex_secure_local_wsl_validation_token_string',
    },
  });

  test('should bypass authentication and load the dashboard successfully', async ({ page }) => {
    // 1. Navigate to the protected route
    await page.goto('/dashboard');

    // 2. Verify the middleware allowed us through and did NOT redirect to sign-in
    await expect(page).not.toHaveURL(/.*\/auth\/signin.*/);

    // 3. Verify the core dashboard UI loads
    // Note: Adjust this locator to match a specific element on your actual dashboard
    await expect(page.locator('text=Dashboard').first()).toBeVisible();
    
    // Add any additional interactions or assertions for your dashboard here
  });
});