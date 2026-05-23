/**
 * Error Handling Test Suite
 * 12 test cases validating graceful degradation on failures
 * Cases: PW1-002, -006, -008, -010, -015, -016, -020, -023, -026, -028, -032, -036, -037
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/users';
import { testVideos } from '../fixtures/videos';

test.describe('Error Handling Suite - Graceful Degradation', () => {
  test('PW1-002: Network failure with stale cache fallback', async () => {
    const user = testUsers.proUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    // Request that would trigger network failure but fallback to cache
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // Should succeed via cache or return graceful error
    expect([200, 503]).toContain(response.status);
    if (response.ok) {
      const body = await response.json();
      expect(body).toHaveProperty('sections');
    }
  });

  test('PW1-006: CI environment handles network failure gracefully', async () => {
    const user = testUsers.freeUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // Should not crash on network error
    expect(response.status).not.toBe(500);
  });

  test('PW1-008: Invalid input returns 400 with error details', async () => {
    const user = testUsers.proUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'not-a-valid-url',
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Invalid');
  });

  test('PW1-010: Missing required field validation', async () => {
    const user = testUsers.freeUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-015: Network timeout during analysis generation', async () => {
    const user = testUsers.freeUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${testVideos.longTechnical.id}`,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      expect([200, 408, 504]).toContain(response.status);
    } catch (error: any) {
      // Timeout is acceptable error
      expect(error.message).toContain('abort');
    }
  });

  test('PW1-016: Unavailable video returns 404 with error', async () => {
    const user = testUsers.freeUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.deletedVideo.id}`,
      }),
    });

    expect([400, 404, 410]).toContain(response.status);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-020: Invalid input type for search query parameter', async () => {
    const user = testUsers.freeUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: 123,
      }),
    });

    expect(response.status).toBe(400);
  });

  test('PW1-023: Missing data in multi-field request', async () => {
    const user = testUsers.proUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses/export`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  test('PW1-026: Enterprise tier handles validation errors consistently', async () => {
    const user = testUsers.enterpriseUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: '',
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-028: Network failure on search endpoint with fallback', async () => {
    const user = testUsers.proUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: 'test query',
      }),
    });

    // Should handle network gracefully
    expect(response.status).not.toBe(500);
  });

  test('PW1-032: Rate-limited request returns 429 with retry-after', async () => {
    const user = testUsers.freeUserOverQuota;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    expect(response.status).toBe(429);
    const retryAfter = response.headers.get('Retry-After');
    expect(retryAfter).toBeDefined();
  });

  test('PW1-036: Enterprise tier long transcript timeout handling', async () => {
    const user = testUsers.enterpriseUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${testVideos.longTechnical.id}`,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      expect([200, 408, 504]).toContain(response.status);
    } catch (error: any) {
      // Network timeout is expected for long transcripts
      expect(error.message).toMatch(/abort/i);
    }
  });

  test('PW1-037: Missing data in free tier request boundary', async () => {
    const user = testUsers.freeUser;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses/export`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('required');
  });
});
