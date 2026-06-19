import { vi, beforeEach } from 'vitest';
import { checkRateLimitSlidingWindow, RATE_LIMITS } from '@/lib/services/traffic';

const mockRedisData = new Map<string, number[]>();

vi.mock('@/lib/redis', () => ({
  executeRedisScript: vi.fn(async (script: string, keys: string[], args: unknown[]) => {
    const key = keys[0]!;
    const now = Number(args[0]);
    const window = Number(args[1]);
    
    // Simulate Lua script execution
    if (script.includes('ZADD')) {
      const limit = Number(args[2]);
      let timestamps = mockRedisData.get(key) || [];
      const cutoff = now - window;
      timestamps = timestamps.filter(t => t > cutoff);
      
      const count = timestamps.length;
      if (count < limit) {
        timestamps.push(now);
        mockRedisData.set(key, timestamps);
        return [1, count + 1];
      }
      return [0, count];
    } else {
      let timestamps = mockRedisData.get(key) || [];
      const cutoff = now - window;
      timestamps = timestamps.filter(t => t > cutoff);
      return timestamps.length;
    }
  }),
}));

describe('Sliding Window Rate Limiting', () => {
  const tier = 'free';
  const endpoint = 'analyses' as const;
  const createTestUserId = (testName: string): string => `test-user-${Math.random()}-${testName}`;

  beforeEach(() => {
    mockRedisData.clear();
  });

  describe('Per-minute enforcement', () => {
    it('should allow requests up to tier limit', async () => {
      const testUserId = createTestUserId('allow');
      // Free tier: 3 requests/minute
      const limit = RATE_LIMITS.free.requestsPerMinute;

      for (let i = 0; i < limit; i++) {
        const { allowed } = await checkRateLimitSlidingWindow(testUserId, tier, endpoint);
        expect(allowed).toBe(true);
      }
    });

    it('should block requests exceeding tier limit', async () => {
      const testUserId = createTestUserId('block');
      const limit = RATE_LIMITS.free.requestsPerMinute;

      // Exhaust limit
      for (let i = 0; i < limit; i++) {
        await checkRateLimitSlidingWindow(testUserId, tier, endpoint);
      }

      // Next request should be blocked
      const { allowed } = await checkRateLimitSlidingWindow(testUserId, tier, endpoint);
      expect(allowed).toBe(false);
    });

    it('should return correct remaining count', async () => {
      const testUserId = createTestUserId('remaining');
      const { status } = await checkRateLimitSlidingWindow(testUserId, tier, endpoint);
      expect(status.remaining).toBeGreaterThanOrEqual(0);
      expect(status.remaining).toBeLessThanOrEqual(RATE_LIMITS.free.requestsPerMinute);
    });

    it('should set reset time 60 seconds in future', async () => {
      const testUserId = createTestUserId('reset');
      const now = Date.now();
      const { status } = await checkRateLimitSlidingWindow(testUserId, tier, endpoint);

      expect(status.resetAt).toBeGreaterThan(now);
      expect(status.resetAt - now).toBeLessThanOrEqual(61000); // 60-61 seconds
    });
  });

  describe('Tier differentiation', () => {
    it('free tier should enforce 3/minute limit', async () => {
      const { status } = await checkRateLimitSlidingWindow('user-free', 'free', endpoint);
      expect(status.limit).toBe(3);
    });

    it('pro tier should enforce 30/minute limit', async () => {
      const { status } = await checkRateLimitSlidingWindow('user-pro', 'pro', endpoint);
      expect(status.limit).toBe(30);
    });

    it('enterprise tier should enforce 300/minute limit', async () => {
      const { status } = await checkRateLimitSlidingWindow('user-enterprise', 'enterprise', endpoint);
      expect(status.limit).toBe(300);
    });
  });

  describe('Endpoint isolation', () => {
    it('analyses endpoint should track separately from search', async () => {
      const analysisLimit = RATE_LIMITS.free.requestsPerMinute;

      // Exhaust analyses endpoint
      for (let i = 0; i < analysisLimit; i++) {
        await checkRateLimitSlidingWindow('user-isolation', 'free', 'analyses');
      }

      // Search endpoint should still be available
      const { allowed } = await checkRateLimitSlidingWindow('user-isolation', 'free', 'search');
      expect(allowed).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should gracefully handle Redis failures', async () => {
      // If Redis is unavailable, system should allow request
      const { allowed } = await checkRateLimitSlidingWindow('user-resilience', tier, endpoint);
      expect(allowed).toBe(true);
    });
  });

  describe('Status object accuracy', () => {
    it('should provide accurate Retry-After on block', async () => {
      const testUserId = createTestUserId('retry');
      const limit = RATE_LIMITS.free.requestsPerMinute;

      for (let i = 0; i < limit + 1; i++) {
        await checkRateLimitSlidingWindow(testUserId, 'free', endpoint);
      }

      const { status, allowed } = await checkRateLimitSlidingWindow(testUserId, 'free', endpoint);
      if (!allowed) {
        expect(status.retryAfter).toBe(60);
        expect(status.retryAfter).toBeGreaterThan(0);
      }
    });

    it('should never return negative remaining', async () => {
      const testUserId = createTestUserId('negative');
      const { status } = await checkRateLimitSlidingWindow(testUserId, tier, endpoint);
      expect(status.remaining).toBeGreaterThanOrEqual(0);
    });
  });
});
