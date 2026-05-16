/**
 * Rate Limiting Middleware (Upstash Redis + Token Bucket Algorithm)
 *
 * Enforces per-user rate limits based on subscription tier:
 * - Free: 3 requests per minute (strict)
 * - Pro: 30 requests per minute
 *
 * Implementation: Token bucket algorithm with sliding window counter
 * - Each user gets X tokens per minute based on tier
 * - Tokens are consumed on request, refilled every minute
 * - Requests denied if no tokens available (429 Too Many Requests)
 *
 * Features:
 * - Per-endpoint rate limiting (analyses creation, search)
 * - Automatic token refill on window reset
 * - Logging of rate-limit hits to usage_logs (abuse detection)
 * - Graceful degradation if Redis unavailable
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import {
  getRedisValue,
  incrementRedisValue,
  setRedisExpiration,
  executeRedisScript,
} from '@/lib/redis';
import * as Sentry from '@sentry/nextjs';

/**
 * Lua script for sliding window counter using Redis Sorted Set (ZSET)
 * Atomically:
 * 1. Remove timestamps older than 60 seconds (millisecond window)
 * 2. Count remaining requests in window
 * 3. If under limit, add unique request identifier
 * 4. Refresh key TTL to 90 seconds
 * 5. Return { allowed, count } tuple
 *
 * KEYS[1]: Redis key (e.g., ratelimit:user-123:analyses:sliding)
 * ARGV[1]: Current timestamp in milliseconds
 * ARGV[2]: Window size in milliseconds (60000)
 * ARGV[3]: Request limit (e.g., 3 for free tier)
 * ARGV[4]: TTL in seconds (90)
 * ARGV[5]: Unique request member (UUID)
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
 * Check rate limit using sliding window counter (atomic Lua execution)
 *
 * Algorithm: Redis Sorted Set with millisecond-precision timestamps and unique members
 * - Removes entries older than 60 seconds (ZREMRANGEBYSCORE)
 * - Counts remaining entries (ZCARD)
 * - If under limit, adds unique request member (ZADD)
 * - Refreshes key TTL to 90 seconds (EXPIRE)
 * - Atomic execution guarantees no race conditions or burst leaks
 *
 * Returns: { allowed, status } tuple with accurate remaining count
 */
export async function checkRateLimitSlidingWindow(
  userId: string,
  tier: Tier,
  endpoint: 'analyses' | 'search'
): Promise<{ allowed: boolean; status: RateLimitStatus }> {
  const limit = RATE_LIMITS[tier];
  const limitPerMinute = limit.requestsPerMinute;
  const now = Date.now(); // Milliseconds for high-precision timing
  const uniqueMember = `${now}:${randomUUID()}`; // Unique identifier per request
  const redisKey = `ratelimit:${userId}:${endpoint}:sliding`;

  try {
    // Execute Lua script atomically
    const luaResult = await executeRedisScript(SLIDING_WINDOW_SCRIPT, [redisKey], [
      now,
      60000, // 60-second window in milliseconds
      limitPerMinute,
      90, // TTL in seconds
      uniqueMember, // Unique request identifier
    ]);

    // Sentinel guard: if Redis unavailable, luaResult is -1
    if (luaResult === -1) {
      // Graceful degradation path
      const status: RateLimitStatus = {
        remaining: -1,
        limit: limitPerMinute,
        resetAt: Date.now() + 60000,
        retryAfter: 60,
        tier,
        requestTime: -1,
      };
      return { allowed: true, status };
    }

    // Parse Lua response: [allowed, count]
    if (!Array.isArray(luaResult) || luaResult.length !== 2) {
      throw new Error(`Unexpected Redis Lua response array format: ${JSON.stringify(luaResult)}`);
    }
    const [allowedFlag, requestCount] = luaResult;
    const allowed = allowedFlag === 1;

    if (!allowed) {
      await logRateLimitHit(userId, endpoint, tier, requestCount, limitPerMinute);
      Sentry.captureMessage(`Rate limit exceeded: ${tier} tier on ${endpoint}`, 'warning');
      Sentry.addBreadcrumb({
        category: 'rate-limit',
        message: 'Rate limit exceeded',
        level: 'warning',
        data: {
          userId,
          tier,
          endpoint,
          requestCount,
          limit: limitPerMinute,
        },
      });
    } else if (requestCount === limitPerMinute) {
      // User is at the limit (next request will be blocked)
      Sentry.addBreadcrumb({
        category: 'rate-limit',
        message: `User at rate limit threshold`,
        level: 'warning',
        data: {
          userId,
          tier,
          endpoint,
          current: requestCount,
          limit: limitPerMinute,
        },
      });
    }

    // Calculate next reset time (60 seconds from now)
    const resetAt = now + 60000; // Already in milliseconds
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
    console.error(`[rate-limit] Sliding window execution failed for user ${userId}:`, error);
    Sentry.captureException(error, {
      level: 'error',
      contexts: {
        rateLimit: {
          userId,
          endpoint,
          tier,
          algorithm: 'sliding-window',
          window: '60s',
        },
      },
      tags: {
        component: 'rate-limiter',
        severity: 'high',
        failureMode: 'redis-unavailable',
      },
    });

    // Graceful degradation: Allow request if Redis fails
    // Log this incident for operational awareness
    const status: RateLimitStatus = {
      remaining: -1,
      limit: limitPerMinute,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
      tier,
      requestTime: 0,
    };

    return { allowed: true, status };
  }
}

/**
 * Rate limit configuration per tier
 * Expressed as: requests per minute
 */
export const RATE_LIMITS = {
  free: {
    requestsPerMinute: 3,
    requestsPerHour: 50,
    description: 'Free tier: 3 requests/minute, 50/hour',
  },
  pro: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    description: 'Pro tier: 30 requests/minute, 500/hour',
  },
  enterprise: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    description: 'Enterprise tier: unlimited (300 req/min soft limit)',
  },
} as const;

type Tier = keyof typeof RATE_LIMITS;

/**
 * Rate limit status returned to client
 */
export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: number; // Unix timestamp in milliseconds
  retryAfter: number; // Seconds to wait before next request
  tier: string;
  requestTime: number; // Current request count in window
}

/**
 * Check rate limit for a user
 * Returns status and boolean indicating if request should be allowed
 */
export async function checkRateLimit(
  userId: string,
  tier: Tier,
  endpoint: 'analyses' | 'search'
): Promise<{ allowed: boolean; status: RateLimitStatus }> {
  const limit = RATE_LIMITS[tier];
  const limitPerMinute = limit.requestsPerMinute;

  // Redis key: user:tier:endpoint:minute
  // Pattern allows per-endpoint limiting and hourly rollup if needed
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);
  const redisKey = `ratelimit:${userId}:${endpoint}:${minuteWindow}`;

  try {
    // Get current request count in this minute window
    let requestCount = await getRedisValue(redisKey);
    requestCount = requestCount || 0;

    // Check if limit exceeded
    const allowed = requestCount < limitPerMinute;

    if (!allowed) {
      // Log rate limit hit for abuse detection
      await logRateLimitHit(userId, endpoint, tier, requestCount, limitPerMinute);
    }

    // Increment counter (regardless of allow/deny, for tracking)
    if (allowed) {
      await incrementRedisValue(redisKey, 1);
    }

    // Set expiration on first request in window (60 second TTL)
    if (requestCount === 0) {
      await setRedisExpiration(redisKey, 60);
    }

    // Calculate next reset time
    const nextMinute = (minuteWindow + 1) * 60;
    const resetAt = nextMinute * 1000; // Convert to milliseconds
    const retryAfter = Math.max(1, nextMinute - now);

    const status: RateLimitStatus = {
      remaining: Math.max(0, limitPerMinute - (requestCount + 1)),
      limit: limitPerMinute,
      resetAt,
      retryAfter,
      tier,
      requestTime: requestCount + 1,
    };

    return { allowed, status };
  } catch (error) {
    console.error(`[rate-limit] Error checking rate limit for user ${userId}:`, error);
    Sentry.captureException(error, {
      contexts: {
        rateLimit: {
          userId,
          endpoint,
          tier,
        },
      },
      tags: {
        severity: 'medium',
      },
    });

    // Graceful degradation: Allow request if Redis fails
    // Log the incident for debugging
    const status: RateLimitStatus = {
      remaining: -1, // Indicate unknown state
      limit: limitPerMinute,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
      tier,
      requestTime: 0,
    };

    return { allowed: true, status };
  }
}

/**
 * Rate limit middleware for Next.js API routes
 * Uses sliding window counter for per-minute enforcement (no burst leaks)
 * Usage: Apply before main route handler
 *
 * @param request - Next.js request
 * @param endpoint - Endpoint identifier (analyses, search)
 * @param userId - User ID (from session)
 * @param tier - User's subscription tier
 * @returns { allowed, response?, headers }
 */
export async function applyRateLimit(
  _request: NextRequest,
  endpoint: 'analyses' | 'search',
  userId: string,
  tier: Tier
): Promise<{
  allowed: boolean;
  response?: NextResponse;
  headers?: { [key: string]: string };
}> {
  const { allowed, status } = await checkRateLimitSlidingWindow(userId, tier, endpoint);

  // Headers to attach to response (HTTP standard: Unix timestamp in seconds)
  const resetAtSeconds = Math.ceil(status.resetAt / 1000);
  const headers: { [key: string]: string } = {
    'X-RateLimit-Limit': String(status.limit),
    'X-RateLimit-Remaining': String(status.remaining),
    'X-RateLimit-Reset': String(resetAtSeconds),
  };

  if (!allowed) {
    // Return 429 Too Many Requests with Retry-After header
    const response = NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Too many requests. Current tier: ${tier}. ${RATE_LIMITS[tier].description}`,
        retryAfter: status.retryAfter,
        resetAt: new Date(status.resetAt).toISOString(),
      },
      { status: 429 }
    );

    // Add standard rate limit headers
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }

    // Add Retry-After header (HTTP standard)
    response.headers.set('Retry-After', String(status.retryAfter));

    return { allowed: false, response };
  }

  return { allowed: true, headers };
}

/**
 * Get current rate limit status for a user
 * Used by /api/rate-limit-status endpoint
 */
export async function getRateLimitStatus(
  userId: string,
  tier: Tier,
  endpoint: 'analyses' | 'search'
): Promise<RateLimitStatus> {
  const { status } = await checkRateLimit(userId, tier, endpoint);
  return status;
}

/**
 * Log rate limit hit to usage_logs table for abuse detection
 * Non-blocking: errors are logged but don't interrupt request
 */
async function logRateLimitHit(
  userId: string,
  endpoint: string,
  tier: string,
  requestCount: number,
  limit: number
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'rate_limit_exceeded',
      metadata: {
        endpoint,
        tier,
        requestCount,
        limit,
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[rate-limit] Failed to log rate limit hit:', error);
    // Non-fatal: don't interrupt request
  }
}

/**
 * Get user tier from database
 * Helper function for middleware
 */
export async function getUserTier(userId: string): Promise<Tier> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('users')
      .select('tier')
      .eq('id', userId)
      .single();

    if (error || !data) {
      console.warn(`[rate-limit] Failed to get tier for user ${userId}:`, error);
      return 'free'; // Default to free tier
    }

    const tier = data.tier as Tier;

    // Validate tier against known values
    if (!RATE_LIMITS[tier]) {
      console.warn(`[rate-limit] Unknown tier for user ${userId}: ${tier}, defaulting to free`);
      return 'free';
    }

    return tier;
  } catch (error) {
    console.warn(`[rate-limit] Error fetching user tier:`, error);
    return 'free'; // Default to free tier on error
  }
}

