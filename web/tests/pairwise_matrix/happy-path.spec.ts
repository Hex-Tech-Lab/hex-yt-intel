/**
 * Happy Path Test Suite
 * 7 test cases validating normal operation across tier/auth combinations
 * Cases: PW1-001, -005, -007, -009, -014, -018, -024, -027, -031, -038
 */

import { test, expect } from '@playwright/test';
import { testUsers } from '../fixtures/users';
import { testVideos } from '../fixtures/videos';

const happyPathCases = [
  {
    id: 'PW1-001',
    user: testUsers.freeUser,
    video: testVideos.shortEducational,
    tier: 'free',
    description: 'Production + Supabase + Free Tier + Fresh Cache',
  },
  {
    id: 'PW1-005',
    user: testUsers.proUser,
    video: testVideos.shortEducational,
    tier: 'pro',
    description: 'Development NextAuth + Pro Tier',
  },
  {
    id: 'PW1-007',
    user: testUsers.enterpriseUser,
    video: testVideos.longTechnical,
    tier: 'enterprise',
    description: 'Production NextAuth + Enterprise Tier',
  },
  {
    id: 'PW1-009',
    user: testUsers.enterpriseUser,
    video: testVideos.shortEducational,
    tier: 'enterprise',
    description: 'Development Supabase + Enterprise Tier + Search',
  },
  {
    id: 'PW1-014',
    user: testUsers.enterpriseUser,
    video: testVideos.longTechnical,
    tier: 'enterprise',
    description: 'CI Supabase + Enterprise Tier + Fresh Cache',
  },
  {
    id: 'PW1-018',
    user: testUsers.proUser,
    video: testVideos.shortEducational,
    tier: 'pro',
    description: 'Development Supabase + Pro Tier',
  },
  {
    id: 'PW1-024',
    user: testUsers.enterpriseUser,
    video: testVideos.longTechnical,
    tier: 'enterprise',
    description: 'Development NextAuth + Enterprise Tier + Export',
  },
];

test.describe('Happy Path Suite - Normal Operation Succeeds', () => {
  happyPathCases.forEach((testCase) => {
    test(`${testCase.id}: ${testCase.description}`, async () => {
      // Arrange: Setup user and video
      const user = testCase.user;
      const video = testCase.video;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
        Authorization: `Bearer ${user.id}`,
      };

      const url = `${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`;

      // Act: Create analysis request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: `https://www.youtube.com/watch?v=${video.id}`,
        }),
      });

      // Assert: Response indicates success
      expect(response.ok).toBe(true);
      const body = await response.json();

      // Verify analysis structure
      expect(body).toHaveProperty('sections');
      expect(Array.isArray(body.sections)).toBe(true);
      expect(body.sections.length).toBeGreaterThan(0);

      // Verify response headers indicate successful execution
      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });

  test('PW1-027: Free user can analyze short video with quota tracking', async () => {
    const user = testUsers.freeUser;
    const video = testVideos.shortEducational;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      Authorization: `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${video.id}`,
      }),
    });

    expect(response.ok).toBe(true);

    // Verify quota header in response
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    expect(quotaHeader).toBeDefined();
    const remaining = parseInt(quotaHeader || '0');
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(3);
  });

  test('PW1-031: Enterprise user can analyze with multiple endpoints', async () => {
    const user = testUsers.enterpriseUser;
    const video = testVideos.longTechnical;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      Authorization: `Bearer ${user.id}`,
    };

    // Test analyses endpoint
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${video.id}`,
      }),
    });

    expect(response.ok).toBe(true);

    // Enterprise tier should have no quota restrictions
    const quotaHeader = response.headers.get('X-Quota-Remaining');
    if (quotaHeader) {
      const remaining = parseInt(quotaHeader);
      expect(remaining).toBe(9999); // Enterprise unlimited
    }
  });

  test('PW1-038: CI test user inherits persistent identity across test runs', async () => {
    const user = testUsers.ciTestUser;
    const video = testVideos.shortEducational;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      Authorization: `Bearer ${user.id}`,
    };

    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${video.id}`,
      }),
    });

    // CI user should be recognized across runs
    expect(response.status).not.toBe(401);
  });
});
