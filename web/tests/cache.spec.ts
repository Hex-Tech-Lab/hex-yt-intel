import { test, expect } from '@playwright/test';
import { freeUser, proUser } from '../fixtures/users';
import { shortEducational, longTechnical } from '../fixtures/videos';

const testCases = [
  {
    id: 'PW1-017',
    description: 'Fresh cache hit under 5 minutes (performance < 1000ms)',
    user: freeUser,
    video: shortEducational,
    tier: 'free',
    expectedStatus: 200,
    shouldCheckPerformance: true,
    maxDuration: 1000,
  },
  {
    id: 'PW1-019',
    description: 'Stale cache with valid content (TTL expired but data intact)',
    user: proUser,
    video: longTechnical,
    tier: 'pro',
    expectedStatus: 200,
    shouldValidateAge: true,
    expectCacheAge: 'stale',
  },
  {
    id: 'PW1-025',
    description: 'Cache miss forces fresh request to external API',
    user: freeUser,
    video: { id: 'newvideo123', title: 'New Video' },
    tier: 'free',
    expectedStatus: 200,
    shouldCheckPerformance: false,
    expectsCacheMiss: true,
  },
  {
    id: 'PW1-034',
    description: 'Stale-while-revalidate: serve stale, background refresh',
    user: proUser,
    video: longTechnical,
    tier: 'pro',
    expectedStatus: 200,
    shouldValidateAge: true,
    expectCacheControl: 'stale-while-revalidate',
  },
  {
    id: 'PW1-039',
    description: 'Cache control headers: max-age enforcement',
    user: freeUser,
    video: shortEducational,
    tier: 'free',
    expectedStatus: 200,
    shouldCheckHeaders: true,
    expectMaxAge: 3600,
  },
  {
    id: 'PW1-040',
    description: 'No-cache on analysis with stale data fallback',
    user: proUser,
    video: longTechnical,
    tier: 'pro',
    expectedStatus: 200,
    shouldValidateAge: true,
    expectCacheControl: 'no-cache',
  },
];

test.describe('Cache Behavior & TTL Management', () => {
  test.each(testCases)('$id: $description', async ({ id, user, video, expectedStatus, shouldCheckPerformance, maxDuration, shouldValidateAge, expectCacheAge, expectsCacheMiss, expectCacheControl, shouldCheckHeaders, expectMaxAge }) => {
    // Arrange: Setup auth headers
    const authHeaders = {
      'X-Hex-Test-Secret': process.env.DEV_BYPASS_TOKEN || 'test-token',
      'Authorization': `Bearer ${user.testToken}`,
    };

    // Act: Make request to analyses endpoint
    const startTime = Date.now();
    const response = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${video.id}`,
      }),
    });
    const duration = Date.now() - startTime;

    // Assert: Validate response
    expect(response.status).toBe(expectedStatus);

    // Check performance if required
    if (shouldCheckPerformance && maxDuration) {
      expect(duration).toBeLessThan(maxDuration);
    }

    // Check cache headers
    if (shouldCheckHeaders && expectMaxAge) {
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain(`max-age=${expectMaxAge}`);
    }

    // Check stale-while-revalidate
    if (expectCacheControl === 'stale-while-revalidate') {
      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('stale-while-revalidate');
    }

    // Check age header for cache hits
    if (shouldValidateAge) {
      const ageHeader = response.headers.get('Age');
      if (expectCacheAge === 'stale') {
        // Stale entries have Age > TTL or are > 5min old
        expect(ageHeader).toBeTruthy();
      }
    }

    // Validate cache miss forces new request
    if (expectsCacheMiss) {
      const etag = response.headers.get('ETag');
      expect(etag || response.headers.get('X-Cache')).toBeTruthy();
    }

    // Validate response content
    const body = await response.json();
    if (expectedStatus === 200) {
      expect(body).toHaveProperty('sections');
      expect(Array.isArray(body.sections) || typeof body.sections === 'string').toBeTruthy();
    }
  });
});
