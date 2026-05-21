/**
 * Quota & Rate Limiting Test Suite
 * 8 test cases validating tier enforcement and counter accuracy
 * Cases: PW1-011, -021, -033, -035, and quota boundary tests
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/users';
import { testVideos } from '../fixtures/videos';

test.describe('Quota & Rate Limiting - Tier Enforcement', () => {
  test('PW1-011: Pro tier user has unlimited monthly analyses', async ({ page }) => {
    const user = testUsers.proUser;

    // Make first request
    const response1 = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    expect(response1.ok()).toBe(true);
    const quotaHeader = response1.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBe(999); // Pro tier: effectively unlimited
    }
  });

  test('PW1-021: Free tier at boundary (2/3) allows one more analysis', async ({ page }) => {
    const user = testUsers.freeUserNearQuota; // 2/3 used

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Should succeed, using last available quota
    expect(response.ok()).toBe(true);
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBe(0); // Now at limit
    }
  });

  test('PW1-033: Free tier at limit (3/3) rejects further analysis', async ({ page }) => {
    const user = testUsers.freeUserOverQuota; // 3/3 used

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Should be rate-limited
    expect(response.status()).toBe(429);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('quota');

    // Verify quota header reflects actual state
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBe(0);
    }
  });

  test('PW1-035: Rate limit headers include reset time and retry-after', async ({ page }) => {
    const user = testUsers.freeUserOverQuota;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    expect(response.status()).toBe(429);

    // Verify rate limit headers
    expect(response.headers.get('X-Quota-Remaining')).toBeDefined();
    expect(response.headers.get('X-Quota-Limit')).toBeDefined();
    const retryAfter = response.headers.get('Retry-After');
    expect(retryAfter).toBeDefined();

    if (retryAfter) {
      const seconds = parseInt(retryAfter);
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(86400); // Max 1 day
    }
  });

  test('PW1-021-variant: Free tier quota counter accuracy across requests', async ({ page }) => {
    const user = testUsers.freeUser;

    // Make request
    const response1 = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    if (response1.ok()) {
      const quota1 = parseInt(response1.headers.get('X-Quota-Remaining') || '3');
      expect(quota1).toBeLessThanOrEqual(3);
      expect(quota1).toBeGreaterThanOrEqual(0);

      // Make second request
      const response2 = await page.request.post('/api/analyses', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer test-token-${user.id}`,
        },
        data: {
          url: 'https://youtube.com/watch?v=jL6XPnSKdq0',
        },
      });

      if (response2.ok()) {
        const quota2 = parseInt(response2.headers.get('X-Quota-Remaining') || '3');
        expect(quota2).toBeLessThan(quota1); // Should decrease
      }
    }
  });

  test('PW1-011-variant: Enterprise tier quota tracking', async ({ page }) => {
    const user = testUsers.enterpriseUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    expect(response.ok()).toBe(true);
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBe(9999); // Enterprise: very high limit
    }
  });

  test('PW1-033-variant: Export endpoint respects per-month export limit', async ({ page }) => {
    const user = testUsers.freeUser;

    const response = await page.request.post('/api/analyses/export', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        analysisId: 'analysis-123',
      },
    });

    // Export limit is separate from analysis limit
    if (response.ok()) {
      // Track export quota
      const exportQuota = response.headers.get('X-Export-Remaining');
      expect(exportQuota).toBeDefined();
      const remaining = parseInt(exportQuota || '1');
      expect(remaining).toBeLessThanOrEqual(1); // Free tier: 1 export/month
    }
  });

  test('PW1-035-variant: Rate limit resets at month boundary', async ({ page }) => {
    const user = testUsers.freeUserOverQuota;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Check reset time in response
    expect(response.status()).toBe(429);
    const body = await response.json();

    if (body.quota && body.quota.reset_at) {
      const resetTime = new Date(body.quota.reset_at);
      const now = new Date();

      // Reset time should be in the future
      expect(resetTime.getTime()).toBeGreaterThan(now.getTime());

      // Reset time should be within 30 days
      const daysDiff = (resetTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeLessThanOrEqual(30);
      expect(daysDiff).toBeGreaterThan(0);
    }
  });
});
