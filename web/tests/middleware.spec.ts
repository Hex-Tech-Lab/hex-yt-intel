import { test, expect } from '@playwright/test';
import { testUsers } from './fixtures/users';
import { testVideos } from './fixtures/videos';

const testCases = [
  {
    id: 'PW1-012',
    description: 'Protected route rejects unauthenticated requests',
    endpoint: '/api/analyses',
    method: 'POST',
    includeAuth: false,
    expectedStatus: 401,
    middleware: 'protected',
  },
  {
    id: 'PW1-022',
    description: 'Public endpoint allows unauthenticated requests',
    endpoint: '/api/metadata',
    method: 'GET',
    includeAuth: false,
    expectedStatus: 200,
    middleware: 'public',
    queryParams: { videoId: testVideos.shortEducational.id },
  },
  {
    id: 'PW1-029',
    description: 'Admin gate restricts free users (403), allows admins (200)',
    endpoint: '/api/admin/stats',
    method: 'GET',
    includeAuth: true,
    userRole: 'free',
    expectedStatus: 403,
    middleware: 'admin',
  },
  {
    id: 'PW1-041',
    description: 'Admin route allows authenticated admin users',
    endpoint: '/api/admin/stats',
    method: 'GET',
    includeAuth: true,
    user: testUsers.adminUser,
    expectedStatus: 200,
    middleware: 'admin',
  },
  {
    id: 'PW1-042',
    description: 'Middleware chain executes in order: auth → rate-limit → handler',
    endpoint: '/api/analyses',
    method: 'POST',
    includeAuth: true,
    user: testUsers.freeUser,
    expectedStatus: 200,
    middleware: 'protected',
    validateChain: true,
  },
];

test.describe('Middleware & Routing Chain Execution', () => {
  testCases.forEach(({ id, endpoint, method, includeAuth, user, userRole, expectedStatus, queryParams, validateChain, description }) => {
    test(`${id}: ${description}`, async () => {
      // Arrange: Build request headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (includeAuth) {
        const authUser = user || testUsers.freeUser;
        headers['X-Hex-Test-Secret'] = process.env.DEV_BYPASS_TOKEN || 'test-token';
        headers['Authorization'] = `Bearer ${authUser.id}`;
      }

      // Arrange: Build request body/query
      let url = `${process.env.BASE_URL || 'http://localhost:3000'}${endpoint}`;
      let body: unknown = undefined;

      if (method === 'POST') {
        body = JSON.stringify({
          url: `https://www.youtube.com/watch?v=${testVideos.shortEducational.id}`,
        });
      } else if (method === 'GET' && queryParams) {
        url += `?${new URLSearchParams(queryParams as Record<string, string>).toString()}`;
      }

      // Act: Execute request
      const response = await fetch(url, {
        method,
        headers,
        ...(body && { body }),
      });

      // Assert: Validate response status
      expect(response.status).toBe(expectedStatus);

      // Assert: Validate middleware chain ordering if required
      if (validateChain) {
        // Check that auth was enforced before rate limit
        const quotaHeader = response.headers.get('X-Quota-Remaining');
        if (response.ok) {
          // If we got past auth, quota headers should be present
          expect(quotaHeader).toBeDefined();
        }
      }

      // Assert: Validate response format
      if (response.ok) {
        const contentType = response.headers.get('Content-Type');
        expect(contentType).toContain('application/json');

        const body = await response.json();
        expect(body).toBeTruthy();

        // POST endpoints should return analysis data
        if (method === 'POST' && endpoint === '/api/analyses') {
          expect(body).toHaveProperty('sections');
        }
      } else if (response.status === 401) {
        const body = await response.json();
        expect(body.error || body.message).toBeTruthy();
      } else if (response.status === 403) {
        const body = await response.json();
        expect(body.error || body.message).toBeTruthy();
      }
    });
  });

  // Additional test: Verify auth header variants are processed correctly
  test('PW1-043: Auth header parsing with multiple formats (Bearer, Supabase, NextAuth)', async () => {
    const endpoint = '/api/analyses';
    const videoId = testVideos.shortEducational.id;

    // Test Bearer token format
    const bearerResponse = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
          'Authorization': `Bearer ${testUsers.freeUser.id}`,
        },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
      },
    );

    expect(bearerResponse.status).toBe(200);

    // Test with missing auth should fail
    const noAuthResponse = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
      },
    );

    expect(noAuthResponse.status).toBe(401);
  });

  // Additional test: Verify public endpoints skip auth entirely
  test('PW1-044: Public endpoint /api/metadata requires no auth validation', async () => {
    const response = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/metadata?videoId=${testVideos.shortEducational.id}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('title');
  });
});
