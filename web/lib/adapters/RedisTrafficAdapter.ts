import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { executeRedisScript } from '@/lib/redis';
import type { QuotaGateResult, TrafficGuardPort, RateLimitStatus } from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';
import { RATE_LIMITS } from '@/lib/constants/rate-limits';
import { SupabasePersistenceAdapter } from './SupabasePersistenceAdapter';

/**
 * Sliding-window counter via Redis Sorted Set (atomic Lua).
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]

-- Remove timestamps older than window
local cutoff = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count remaining requests in window
local count = redis.call('ZCARD', key)

-- Determine if request is allowed
local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end

-- Refresh TTL
redis.call('EXPIRE', key, ttl)

-- Return { allowed, count } tuple
return { allowed, count }
`;

/**
 * Non-incrementing sliding-window status check.
 */
const SLIDING_WINDOW_STATUS_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

-- Remove timestamps older than window
local cutoff = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count remaining requests in window
local count = redis.call('ZCARD', key)

return count
`;

function gracefulDegradation(tier: UserTier, limitPerMinute: number): RateLimitStatus {
  return {
    remaining: -1,
    limit: limitPerMinute,
    resetAt: Date.now() + 60000,
    retryAfter: 60,
    tier,
    requestTime: 0,
  };
}

function logRateLimitEvent(
  userId: string,
  tier: string,
  endpoint: string,
  requestCount: number,
  limit: number,
  eventType: 'exceeded' | 'threshold'
): void {
  const message = eventType === 'exceeded'
    ? `Rate limit exceeded: ${tier} tier on ${endpoint}`
    : `User at rate limit threshold`;

  Sentry.captureMessage(message, 'warning');
  Sentry.addBreadcrumb({
    category: 'rate-limit',
    message,
    level: 'warning',
    data: { userId, tier, endpoint, requestCount, limit },
  });
}

export class RedisTrafficAdapter implements TrafficGuardPort {
  private persistence = new SupabasePersistenceAdapter();

  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: 'analyses' | 'search' | 'checkout';
    clientIp?: string;
    userAgent?: string;
  }): Promise<QuotaGateResult & { status?: RateLimitStatus }> {
    const { userId, tier, endpoint } = params;
    const limitPerMinute = RATE_LIMITS[tier as keyof typeof RATE_LIMITS]?.requestsPerMinute || 3;
    const now = Date.now();
    const uniqueMember = `${now}:${randomUUID()}`;
    const redisKey = `ratelimit:${userId}:${endpoint}:sliding`;

    try {
      const luaResult = await executeRedisScript(SLIDING_WINDOW_SCRIPT, [redisKey], [
        now,
        60000, // 60-second window in milliseconds
        limitPerMinute,
        90, // TTL in seconds
        uniqueMember,
      ]);

      // Sentinel guard: if Redis unavailable, luaResult is -1
      if (luaResult === -1) {
        const status = gracefulDegradation(tier, limitPerMinute);
        status.requestTime = -1;
        return { allowed: true, status };
      }

      if (!Array.isArray(luaResult) || luaResult.length !== 2) {
        throw new Error(`Unexpected Redis Lua response array format: ${JSON.stringify(luaResult)}`);
      }
      const [allowedFlag, requestCount] = luaResult;
      const allowed = allowedFlag === 1;

      if (!allowed) {
        try {
          await this.persistence.logUsageEvent({
            userId,
            action: 'rate_limit_exceeded',
            metadata: { endpoint, tier, requestCount, limit: limitPerMinute, timestamp: new Date().toISOString() },
          });
        } catch (dbErr) {
          console.warn('[RedisTrafficAdapter] Failed to log rate limit hit:', dbErr);
        }
        logRateLimitEvent(userId, tier, endpoint, requestCount, limitPerMinute, 'exceeded');
      } else if (requestCount === limitPerMinute) {
        logRateLimitEvent(userId, tier, endpoint, requestCount, limitPerMinute, 'threshold');
      }

      const resetAt = now + 60000;
      const retryAfter = 60;

      const status: RateLimitStatus = {
        remaining: Math.max(0, limitPerMinute - requestCount),
        limit: limitPerMinute,
        resetAt,
        retryAfter,
        tier,
        requestTime: requestCount,
      };

      return { allowed, status };
    } catch (error) {
      console.error(`[RedisTrafficAdapter] Sliding window check failed for user ${userId}:`, error);
      Sentry.captureException(error, {
        level: 'error',
        contexts: { rateLimit: { userId, endpoint, tier, algorithm: 'sliding-window', window: '60s' } },
        tags: { component: 'rate-limiter', severity: 'high', failureMode: 'redis-unavailable' },
      });
      return { allowed: true, status: gracefulDegradation(tier, limitPerMinute) };
    }
  }

  async getRateLimitStatus(params: {
    userId: string;
    tier: UserTier;
    endpoint: 'analyses' | 'search' | 'checkout';
  }): Promise<RateLimitStatus> {
    const { userId, tier, endpoint } = params;
    const limitPerMinute = RATE_LIMITS[tier as keyof typeof RATE_LIMITS]?.requestsPerMinute || 3;
    const now = Date.now();
    const redisKey = `ratelimit:${userId}:${endpoint}:sliding`;

    try {
      const requestCount = await executeRedisScript(SLIDING_WINDOW_STATUS_SCRIPT, [redisKey], [
        now,
        60000,
      ]);

      if (requestCount === -1) {
        return gracefulDegradation(tier, limitPerMinute);
      }

      const count = typeof requestCount === 'number' ? requestCount : 0;
      const resetAt = now + 60000;
      const retryAfter = 60;

      return {
        remaining: Math.max(0, limitPerMinute - count),
        limit: limitPerMinute,
        resetAt,
        retryAfter,
        tier,
        requestTime: count,
      };
    } catch (error) {
      console.error(`[RedisTrafficAdapter] getRateLimitStatus failed for user ${userId}:`, error);
      Sentry.captureException(error, {
        contexts: { rateLimitStatus: { userId, endpoint, tier } },
        tags: { component: 'rate-limiter-status', severity: 'medium' },
      });
      return gracefulDegradation(tier, limitPerMinute);
    }
  }
}