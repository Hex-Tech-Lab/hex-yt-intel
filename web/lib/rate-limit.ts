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
import { Redis } from '@upstash/redis';
import { getSupabaseClient } from '@/lib/supabase';
import {
  getRedisValue,
  incrementRedisValue,
  setRedisExpiration,
  executeRedisScript,
} from '@/lib/redis';
import * as Sentry from '@sentry/nextjs';

// ============================================================================
// ATOMIC QUOTA INCREMENT WITH DYNAMIC TTL (Lua Script)
// ============================================================================

/**
 * Lua script for atomically incrementing quota counter and managing TTL.
 * Ensures that expired keys get their TTL refreshed on every request,
 * preventing silent expiration leaks near month-end boundaries.
 *
 * Arguments:
 *   KEYS[1]: Redis key (e.g., "quota:user-id:analyses:2026-05")
 *   ARGV[1]: Increment amount (e.g., "1")
 *   ARGV[2]: TTL in seconds (e.g., "864000" for end-of-month)
 *
 * Returns: New counter value as a number
 */
const QUOTA_INCREMENT_LUA = `
  local key = KEYS[1]
  local increment = tonumber(ARGV[1])
  local ttl = tonumber(ARGV[2])

  local current = redis.call('INCRBY', key, increment)

  -- If this is a fresh key, or if TTL was lost (-1 = no expiration), enforce the month-end boundary
  if current == increment or redis.call('TTL', key) == -1 then
    redis.call('EXPIRE', key, ttl)
  end

  return current
`;

// ============================================================================
// TYPE-SAFE REDIS NUMBER PARSING
// ============================================================================

/**
 * Parse Redis values to numbers safely, eliminating string-to-number coercion bugs.
 * Redis stores all values as strings; this utility ensures proper type conversion.
 *
 * @param value - Raw value from Redis (string, null, or undefined)
 * @returns Parsed number, or 0 if conversion fails
 */
export function parseRedisNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

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
  const limitPerMinute = getRateLimit(tier);
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
      const status = gracefulDegradation(tier, limitPerMinute);
      status.requestTime = -1;
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
      logRateLimitEvent(userId, tier, endpoint, requestCount, limitPerMinute, 'exceeded');
    } else if (requestCount === limitPerMinute) {
      // User is at the limit (next request will be blocked)
      logRateLimitEvent(userId, tier, endpoint, requestCount, limitPerMinute, 'threshold');
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
    return { allowed: true, status: gracefulDegradation(tier, limitPerMinute) };
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
 * Centralized graceful degradation response (fail-open pattern)
 */
function gracefulDegradation(tier: Tier, limitPerMinute: number): RateLimitStatus {
  return {
    remaining: -1,
    limit: limitPerMinute,
    resetAt: Date.now() + 60000,
    retryAfter: 60,
    tier,
    requestTime: 0,
  };
}

/**
 * Unified rate limit event logger (consolidates Sentry + breadcrumb)
 */
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

/**
 * Abstracted rate limit configuration lookup
 */
function getRateLimit(tier: Tier): number {
  return RATE_LIMITS[tier].requestsPerMinute;
}

/**
 * HTTP headers assignment utility (RFC 6585 compliance)
 */
export function applyRateLimitHeaders(response: NextResponse, status: RateLimitStatus): void {
  const resetAtSeconds = Math.ceil(status.resetAt / 1000);
  response.headers.set('X-RateLimit-Limit', String(status.limit));
  response.headers.set('X-RateLimit-Remaining', String(status.remaining));
  response.headers.set('X-RateLimit-Reset', String(resetAtSeconds));
}

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
  const limitPerMinute = getRateLimit(tier);

  // Redis key: user:tier:endpoint:minute
  // Pattern allows per-endpoint limiting and hourly rollup if needed
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);
  const redisKey = `ratelimit:${userId}:${endpoint}:${minuteWindow}`;

  try {
    // Get current request count in this minute window
    const redisValue = await getRedisValue(redisKey);
    const requestCount = parseRedisNumber(redisValue);

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
    return { allowed: true, status: gracefulDegradation(tier, limitPerMinute) };
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

    // Add RFC 6585 compliant headers
    applyRateLimitHeaders(response, status);
    response.headers.set('Retry-After', String(status.retryAfter));

    return { allowed: false, response };
  }

  // For successful requests, return headers as object (caller will apply)
  const resetAtSeconds = Math.ceil(status.resetAt / 1000);
  return {
    allowed: true,
    headers: {
      'X-RateLimit-Limit': String(status.limit),
      'X-RateLimit-Remaining': String(status.remaining),
      'X-RateLimit-Reset': String(resetAtSeconds),
    },
  };
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
      .maybeSingle();

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

// ============================================================================
// MONTHLY QUOTA TRACKING (Analysis Creation)
// ============================================================================
// Separate from per-minute rate limiting
// Uses Redis counters to track analyses created per month per user
// Tier-based limits: Free=3/month, Pro=unlimited

/**
 * Monthly quota configuration per tier
 * Expressed as: analyses per calendar month
 */
export const MONTHLY_QUOTAS = {
  free: 3,
  pro: null, // null = unlimited
  enterprise: null,
} as const;

/**
 * Quota status returned when checking analysis limits
 */
export interface QuotaStatus {
  count: number; // Analyses created this month
  limit: number | null; // null = unlimited
  remaining: number | null; // null = unlimited
  reset: Date; // Last day of month at 23:59:59 UTC
  tier: string;
}

/**
 * Get the monthly quota limit for a tier
 * @param tier - User subscription tier
 * @returns Object with limit and window
 */
export function getMonthlyQuotaLimit(tier: 'free' | 'pro' | 'enterprise'): { limit: number | null; window: string } {
  const limit = MONTHLY_QUOTAS[tier];
  return { limit, window: 'month' };
}

/**
 * Generate the month key for Redis quota tracking
 * Format: YYYY-MM (e.g., "2026-05")
 * @returns Month key string
 */
function getMonthKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Calculate the end of current month (for reset time)
 * @returns Date object representing end of month at 23:59:59 UTC
 */
function getMonthEndDate(): Date {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  // Last day of month is day 0 of next month
  const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  return endOfMonth;
}

/**
 * Check quota for a user
 * Returns current count and remaining quota
 * @param userId - User ID
 * @param tier - User subscription tier
 * @returns Quota status with count, limit, remaining, and reset time
 */
export async function checkQuota(
  userId: string,
  tier: 'free' | 'pro' | 'enterprise'
): Promise<QuotaStatus> {
  try {
    const monthKey = getMonthKey();
    const redisKey = `quota:${userId}:analyses:${monthKey}`;

    // Get current count from Redis
    const redisValue = await getRedisValue(redisKey);
    const count = parseRedisNumber(redisValue);

    const limit = MONTHLY_QUOTAS[tier];
    const remaining = limit !== null ? Math.max(0, limit - count) : null;
    const reset = getMonthEndDate();

    return {
      count,
      limit,
      remaining,
      reset,
      tier,
    };
  } catch (error) {
    console.error(`[quota] Error checking quota for user ${userId}:`, error);
    Sentry.captureException(error, {
      contexts: {
        quota: {
          userId,
          tier,
        },
      },
      tags: {
        severity: 'medium',
      },
    });

    // Graceful degradation: return unknown quota status
    return {
      count: 0,
      limit: MONTHLY_QUOTAS[tier],
      remaining: MONTHLY_QUOTAS[tier],
      reset: getMonthEndDate(),
      tier,
    };
  }
}

/**
 * Increment the analysis quota counter for a user
 * Called after successful analysis creation
 * Automatically sets TTL to end of month
 * @param userId - User ID
 * @returns New counter value
 */
export async function incrementQuotaCounter(userId: string): Promise<number> {
  try {
    const monthKey = getMonthKey();
    const redisKey = `quota:${userId}:analyses:${monthKey}`;

    // Increment counter
    let newCount = await incrementRedisValue(redisKey, 1);

    // Set TTL to end of month if this is the first increment this month
    if (newCount === 1) {
      const monthEnd = getMonthEndDate();
      const secondsUntilMonthEnd = Math.floor((monthEnd.getTime() - Date.now()) / 1000);

      if (secondsUntilMonthEnd > 0) {
        await setRedisExpiration(redisKey, secondsUntilMonthEnd);
      }
    }

    return newCount;
  } catch (error) {
    console.error(`[quota] Error incrementing counter for user ${userId}:`, error);
    Sentry.captureException(error, {
      contexts: {
        quota: {
          userId,
          operation: 'increment',
        },
      },
      tags: {
        severity: 'medium',
      },
    });

    // Graceful degradation: return 1 (allow one more request)
    return 1;
  }
}

/**
 * Reset quota counter if month has changed
 * Called at start of month to clear previous month's counter
 * This is a safety check (Redis TTL handles expiration)
 * @param userId - User ID
 * @returns true if reset was needed, false if counter is current month
 */
export async function resetQuotaIfMonthChanged(userId: string): Promise<void> {
  try {
    const monthKey = getMonthKey();
    const redisKey = `quota:${userId}:analyses:${monthKey}`;

    // Get current value - if it exists, we're in the right month
    const count = await getRedisValue(redisKey);

    if (count !== null) {
      // Counter exists for current month, no reset needed
      return;
    }

    // Counter doesn't exist (expired or first request this month)
    // No explicit reset needed - incrementQuotaCounter will set TTL on next call
    console.log(`[quota] Month changed for user ${userId}, quota counter reset via TTL expiration`);
  } catch (error) {
    console.error(`[quota] Error in resetQuotaIfMonthChanged for user ${userId}:`, error);
    // Non-fatal: just log and continue
  }
}

/**
 * Atomically increment quota counter and manage TTL (Lua-backed).
 * Replaces incrementQuotaCounter() for critical paths where race conditions are unacceptable.
 *
 * Uses a Lua script to ensure:
 * - Increment and TTL refresh happen in a single atomic operation
 * - Expired keys automatically get their TTL reset near month-end boundaries
 * - No data consistency windows where concurrent requests leak through quota limits
 *
 * @param userId - User ID
 * @returns New counter value as a number
 * @throws Error if Lua execution fails (non-fatal, graceful fallback available)
 */
export async function incrementQuotaCounterAtomic(userId: string): Promise<number> {
  try {
    const monthKey = getMonthKey();
    const redisKey = `quota:${userId}:analyses:${monthKey}`;
    const monthEnd = getMonthEndDate();
    const secondsUntilMonthEnd = Math.floor((monthEnd.getTime() - Date.now()) / 1000);

    // Validate TTL boundary
    if (secondsUntilMonthEnd <= 0) {
      console.warn(`[quota] Month-end TTL is non-positive for user ${userId}, clamping to 60 seconds`);
    }
    const ttl = Math.max(60, secondsUntilMonthEnd);

    // Execute Lua script atomically via Upstash Redis
    const redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const result = await redisClient.eval(QUOTA_INCREMENT_LUA, [redisKey], [String(1), String(ttl)]);
    const newCount = parseRedisNumber(result);

    return newCount;
  } catch (error) {
    console.error(`[quota] Lua-backed increment failed for user ${userId}, falling back to standard increment:`, error);
    Sentry.captureException(error, {
      contexts: {
        quota: {
          userId,
          operation: 'increment_atomic_lua',
        },
      },
      tags: {
        severity: 'medium',
      },
    });

    // Graceful fallback: use standard increment (slightly less safe, but maintains quota count accuracy)
    return incrementQuotaCounter(userId);
  }
}

