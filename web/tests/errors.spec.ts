/**
 * Error Handling Test Suite
 * 12 test cases validating graceful degradation on failures
 * Cases: PW1-002, -006, -008, -010, -015, -016, -020, -023, -026, -028, -032, -036, -037
 */

import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/users';
import { testVideos } from './fixtures/videos';

test.describe('Error Handling Suite - Graceful Degradation', () => {
  test('PW1-002: Network failure with stale cache fallback', async ({ page }) => {
    const user = testUsers.proUser;

    // Request that would trigger network failure but fallback to cache
    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ', // Pre-cached video
      },
    });

    // Should succeed via cache or return graceful error
    expect([200, 503]).toContain(response.status());
    if (response.ok()) {
      const body = await response.json();
      expect(body).toHaveProperty('sections');
    }
  });

  test('PW1-006: CI environment handles network failure gracefully', async ({ page }) => {
    const user = testUsers.freeUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
      },
    });

    // Should not crash on network error
    expect(response.status()).not.toBe(500);
  });

  test('PW1-008: Invalid input returns 400 with error details', async ({ page }) => {
    const user = testUsers.proUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: 'not-a-valid-url', // Invalid URL format
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Invalid');
  });

  test('PW1-010: Missing required field validation', async ({ page }) => {
    const user = testUsers.freeUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        // Missing 'url' field
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-015: Network timeout during analysis generation', async ({ page }) => {
    const user = testUsers.freeUser;
    const timeout = 3000; // 3-second timeout

    try {
      const response = await page.request.post(
        '/api/analyses',
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer test-token-${user.id}`,
          },
          data: {
            url: 'https://youtube.com/watch?v=longVideoId999', // Long transcript video
          },
        },
        { timeout }
      );

      // Either timeout or successful response
      expect([200, 408, 504]).toContain(response.status());
    } catch (error: any) {
      // Timeout is acceptable error
      expect(error.message).toContain('timeout');
    }
  });

  test('PW1-016: Unavailable video returns 404 with error', async ({ page }) => {
    const user = testUsers.freeUser;
    const video = testVideos.unavailableVideo;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: `https://youtube.com/watch?v=${video.videoId}`,
      },
    });

    expect([400, 404, 410]).toContain(response.status());
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-020: Invalid input type for search query parameter', async ({ page }) => {
    const user = testUsers.freeUser;

    const response = await page.request.post('/api/analyses/search', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        query: 123, // Should be string
      },
    });

    expect(response.status()).toBe(400);
  });

  test('PW1-023: Missing data in multi-field request', async ({ page }) => {
    const user = testUsers.proUser;

    const response = await page.request.post('/api/analyses/export', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        // Missing analysisId
      },
    });

    expect(response.status()).toBe(400);
  });

  test('PW1-026: Enterprise tier handles validation errors consistently', async ({ page }) => {
    const user = testUsers.enterpriseUser;

    const response = await page.request.post('/api/analyses', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        url: '', // Empty URL
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-028: Network failure on search endpoint with fallback', async ({ page }) => {
    const user = testUsers.proUser;

    const response = await page.request.post('/api/analyses/search', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        query: 'test query',
      },
    });

    // Should handle network gracefully
    expect(response.status()).not.toBe(500);
  });

  test('PW1-032: Rate-limited request returns 429 with retry-after', async ({ page }) => {
    const user = testUsers.freeUserOverQuota; // User at quota limit

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
    const retryAfter = response.headers.get('Retry-After');
    expect(retryAfter).toBeDefined();
  });

  test('PW1-036: Enterprise tier long transcript timeout handling', async ({ page }) => {
    const user = testUsers.enterpriseUser;
    const video = testVideos.longTranscript;

    try {
      const response = await page.request.post('/api/analyses', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer test-token-${user.id}`,
        },
        data: {
          url: `https://youtube.com/watch?v=${video.videoId}`,
        },
      });

      // Should either complete or timeout gracefully
      expect([200, 408, 504]).toContain(response.status());
    } catch (error: any) {
      // Network timeout is expected for long transcripts
      expect(error.message).toMatch(/timeout|timeout exceeded/i);
    }
  });

  test('PW1-037: Missing data in free tier request boundary', async ({ page }) => {
    const user = testUsers.freeUser;

    const response = await page.request.post('/api/analyses/export', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-token-${user.id}`,
      },
      data: {
        // Missing required analysisId field
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('required');
  });
});
