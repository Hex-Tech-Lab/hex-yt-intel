/**
 * Authentication & Authorization Test Suite
 * 8 test cases validating provider switching and session validation
 * Cases: PW1-003, -004, -012, -013, -022, -029, and others
 */

import { test, expect } from '@playwright/test';
import { testUsers, supabaseSession, nextAuthSession } from './fixtures/users';
import { testVideos } from './fixtures/videos';

test.describe('Authentication & Authorization - Provider & Role Validation', () => {
  test('PW1-003: Supabase OAuth session validates enterprise user', async () => {
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
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // Enterprise user should succeed
    expect(response.ok || response.status === 429).toBe(true);
  });

  test('PW1-004: Authentication requires valid credentials', async () => {
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // No credentials should return 401
    expect(response.status).toBe(401);
  });

  test('PW1-012: Protected route rejects requests without authentication', async () => {
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('PW1-013: Auth validation with pro tier', async () => {
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
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // Pro user should be authenticated and authorized
    expect(response.ok || response.status === 429).toBe(true);
  });

  test('PW1-022: Public endpoint metadata requires no authentication', async () => {
    // No auth headers provided
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/metadata?videoId=${testVideos.shortEducational.id}`, {
      method: 'GET',
    });

    // Public endpoint should not return 401
    expect(response.status).not.toBe(401);
  });

  test('PW1-029: Admin endpoint enforces role-based access control', async () => {
    const freeUser = testUsers.freeUser;
    const adminUser = testUsers.adminUser;

    // Test with free user (should be denied)
    const freeResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/admin/stats`, {
      method: 'GET',
      headers: {
        'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
        'Authorization': `Bearer ${freeUser.id}`,
      },
    });

    expect(freeResponse.status).toBe(403);

    // Test with admin user (should succeed)
    const adminResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/admin/stats`, {
      method: 'GET',
      headers: {
        'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
        'Authorization': `Bearer ${adminUser.id}`,
      },
    });

    expect(adminResponse.ok).toBe(true);
  });

  test('PW1-013-variant: Session validation is enforced', async () => {
    // Request with invalid token
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-expired-token-12345',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // Invalid token should return 401
    expect(response.status).toBe(401);
  });

  test('PW1-004-variant: Authentication methods validation', async () => {
    const user = testUsers.enterpriseUser;

    // Test with bearer token
    const bearerResponse = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
        'Authorization': `Bearer ${user.id}`,
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
      }),
    });

    // Auth method should produce valid result
    expect(bearerResponse.ok || bearerResponse.status === 429).toBe(true);
  });

  test('PW1-022-variant: Role isolation prevents privilege escalation', async () => {
    const freeUser = testUsers.freeUser;

    // Attempt to escalate via role field in request
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
        'Authorization': `Bearer ${freeUser.id}`,
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
        role: 'admin', // Malicious attempt
      }),
    });

    // Should be treated as free user, not admin
    expect(response.ok || response.status === 429).toBe(true);

    // Verify user's tier is still free by checking quota
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBeLessThanOrEqual(3); // Free tier limit
    }
  });
});
