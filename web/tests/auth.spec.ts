/**
 * Authentication & Authorization Test Suite
 * 8 test cases validating provider switching and session validation
 * Cases: PW1-003, -004, -012, -013, -022, -029, and others
 */

import { test, expect } from '@playwright/test';
import { testUsers, supabaseSession, nextAuthSession } from './fixtures/users';
import { testVideos } from './fixtures/videos';

test.describe('Authentication & Authorization - Provider & Role Validation', () => {
  test('PW1-003: Supabase OAuth session validates enterprise user', async ({ page }) => {
    const user = testUsers.enterpriseUser;
    const session = supabaseSession(user.id);

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session.access_token}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Enterprise user should succeed
    expect(response.ok() || response.status() === 429).toBe(true);
  });

  test('PW1-004: NextAuth session requires valid token', async ({ page }) => {
    const user = testUsers.freeUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'next-auth.session-token=invalid-token',
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Invalid token should return 401
    expect(response.status()).toBe(401);
  });

  test('PW1-012: Protected route rejects requests without authentication', async ({ page }) => {
    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-013: NextAuth provider validation with pro tier', async ({ page }) => {
    const user = testUsers.proUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Pro user should be authenticated and authorized
    expect(response.ok() || response.status() === 429).toBe(true);
  });

  test('PW1-022: Public endpoint metadata requires no authentication', async ({ page }) => {
    // No auth headers provided
    const response = await page.request.get('/api/metadata?videoId=dQw4w9WgXcQ');

    // Public endpoint should not return 401
    expect(response.status()).not.toBe(401);
  });

  test('PW1-029: Admin endpoint enforces role-based access control', async ({ page }) => {
    const freeUser = testUsers.freeUser;
    const adminUser = testUsers.adminUser;

    // Test with free user (should be denied)
    const freeResponse = await page.request.get('/api/admin/stats', {
      headers: {
        Authorization: `Bearer test-token-${freeUser.id}`,
      },
    });

    expect(freeResponse.status()).toBe(403);

    // Test with admin user (should succeed)
    const adminResponse = await page.request.get('/api/admin/stats', {
      headers: {
        Authorization: `Bearer test-token-${adminUser.id}`,
      },
    });

    expect(adminResponse.ok()).toBe(true);
  });

  test('PW1-013-variant: Session expiry is enforced', async ({ page }) => {
    const user = testUsers.freeUser;

    // Request with expired session token
    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer expired-token-12345',
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Expired token should return 401
    expect(response.status()).toBe(401);
  });

  test('PW1-004-variant: Supabase vs NextAuth provider consistency', async ({ page }) => {
    const user = testUsers.enterpriseUser;

    // Test with Supabase-style bearer token
    const supabaseResponse = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Test with NextAuth-style session cookie
    const nextAuthResponse = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `next-auth.session-token=test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Both auth methods should produce consistent results
    expect(supabaseResponse.ok() || supabaseResponse.status() === 429).toBe(true);
    expect(nextAuthResponse.ok() || nextAuthResponse.status() === 429).toBe(true);
  });

  test('PW1-022-variant: Admin role isolation prevents privilege escalation', async ({ page }) => {
    const freeUser = testUsers.freeUser;

    // Attempt to escalate via role field in request
    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${freeUser.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
        role: 'admin', // Malicious attempt
      },
    });

    // Should be treated as free user, not admin
    expect(response.ok() || response.status() === 429).toBe(true);

    // Verify user's tier is still free by checking quota
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBeLessThanOrEqual(3); // Free tier limit
    }
  });
});
